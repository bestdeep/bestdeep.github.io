#!/usr/bin/env python3
"""Regenerate data/portfolio.json from the GitHub API.

Run from the repo root with an authenticated `gh` CLI (scopes: repo, read:org):

    python3 scripts/build_data.py

Only public repositories are published. Work without public code appears as
ideas from content/ideas.json, with no repository data attached. Private
repository names, private organization logins and collaborator owners are
read only to check that none of them appears in the output; the script refuses
to write the file if one does.
"""
import datetime as dt
import json
import pathlib
import re
import subprocess
import sys
from collections import Counter, defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
OUT = ROOT / "data" / "portfolio.json"

REPO_FIELDS = """
  name isPrivate isFork description url createdAt pushedAt stargazerCount forkCount
  parent { nameWithOwner url }
  primaryLanguage { name }
  languages(first: 15, orderBy: {field: SIZE, direction: DESC}) { totalSize edges { size node { name } } }
  defaultBranchRef { target { ... on Commit { mine: history(author: {id: $uid}) { totalCount } } } }
"""


def gh_json(*args):
    out = subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def graphql(query, **variables):
    args = ["api", "graphql", "-f", f"query={query}"]
    for key, value in variables.items():
        if value is not None:
            args += ["-f", f"{key}={value}"]
    data = gh_json(*args)
    if "errors" in data:
        sys.exit(f"GraphQL error: {data['errors']}")
    return data["data"]


def paged(query, path, **variables):
    nodes, cursor = [], None
    while True:
        conn = graphql(query, cursor=cursor, **variables)
        for key in path:
            conn = conn[key]
        nodes += conn["nodes"]
        if not conn["pageInfo"]["hasNextPage"]:
            return nodes
        cursor = conn["pageInfo"]["endCursor"]


def load(name, default=None):
    path = CONTENT / name
    if not path.exists():
        if default is None:
            sys.exit(f"missing {path}")
        return default
    return json.loads(path.read_text())


def entries(obj):
    return {k: v for k, v in obj.items() if not k.startswith("_")}


def commits(repo):
    target = (repo.get("defaultBranchRef") or {}).get("target") or {}
    return (target.get("mine") or {}).get("totalCount", 0)


def lang_bytes(repo):
    return {e["node"]["name"]: e["size"] for e in repo["languages"]["edges"]}


def top_langs(byte_map, n=4, floor=0.03):
    total = sum(byte_map.values()) or 1
    return [name for name, size in sorted(byte_map.items(), key=lambda kv: -kv[1]) if size / total >= floor][:n]


def main():
    site = load("site.json")
    curated = entries(load("projects.json"))
    ideas = entries(load("ideas.json"))
    generic_names = set(load("private.local.json", default={}).get("generic_names", []))

    viewer = graphql("""query { viewer { id login name location url createdAt isHireable } }""")["viewer"]
    repos = paged(f"""query($cursor: String, $uid: ID!) {{ viewer {{
        repositories(first: 50, after: $cursor, ownerAffiliations: OWNER) {{
          pageInfo {{ hasNextPage endCursor }} nodes {{ {REPO_FIELDS} }} }} }} }}""",
                  ["viewer", "repositories"], uid=viewer["id"])

    # Contributions: one calendar per year since the account was created, plus the rolling year.
    now = dt.datetime.now(dt.timezone.utc)
    years, days = [], {}
    for year in range(int(viewer["createdAt"][:4]), now.year + 1):
        c = graphql(f"""query {{ viewer {{ contributionsCollection(from: "{year}-01-01T00:00:00Z", to: "{year}-12-31T23:59:59Z") {{
            contributionCalendar {{ totalContributions weeks {{ contributionDays {{ date contributionCount }} }} }} }} }} }}""")
        cal = c["viewer"]["contributionsCollection"]["contributionCalendar"]
        years.append({"year": year, "total": cal["totalContributions"]})
        for week in cal["weeks"]:
            for d in week["contributionDays"]:
                days[d["date"]] = d["contributionCount"]
    rolling = graphql("""query { viewer { contributionsCollection { contributionCalendar {
        totalContributions weeks { contributionDays { date contributionCount } } } } } }""")
    rolling = rolling["viewer"]["contributionsCollection"]["contributionCalendar"]
    calendar = [{"date": d["date"], "count": d["contributionCount"]} for w in rolling["weeks"] for d in w["contributionDays"]]

    monthly = defaultdict(int)
    for date, count in days.items():
        if date <= now.date().isoformat():
            monthly[date[:7]] += count
    first_month = min((m for m, c in monthly.items() if c), default=now.strftime("%Y-%m"))
    monthly = [{"month": m, "count": c} for m, c in sorted(monthly.items()) if m >= first_month]

    # Names that must never appear in the output.
    private_names = {r["name"] for r in repos if r["isPrivate"]}
    hidden_logins = set()
    public_orgs = {o["login"] for o in gh_json("api", f"users/{viewer['login']}/orgs")}
    orgs = paged("""query($cursor: String) { viewer { organizations(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor } nodes { login url } } } }""", ["viewer", "organizations"])
    organizations = []
    for org in orgs:
        org_repos = paged("""query($cursor: String, $login: String!) { organization(login: $login) {
            repositories(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor }
              nodes { name isPrivate url description } } } }""", ["organization", "repositories"], login=org["login"])
        private_names |= {r["name"] for r in org_repos if r["isPrivate"]}
        if org["login"] not in public_orgs:
            hidden_logins.add(org["login"])
            continue
        organizations.append({
            "name": org["login"], "url": org["url"], "blurb": site.get("org_blurbs", {}).get(org["login"], ""),
            "repos": [{"name": r["name"], "url": r["url"], "description": r["description"] or ""}
                      for r in org_repos if not r["isPrivate"] and not r["name"].startswith(".")],
        })
    org_logins = {o["login"] for o in orgs}
    for r in gh_json("api", "user/repos?affiliation=collaborator&per_page=100", "--paginate"):
        if r["owner"]["login"] not in org_logins and r["owner"]["login"] != viewer["login"]:
            hidden_logins.add(r["owner"]["login"])
            if r["private"]:
                private_names.add(r["name"])

    # Public repositories become cards and table rows; private ones are used for nothing but the check above.
    shown = [r for r in repos if not r["isPrivate"] and not curated.get(r["name"], {}).get("hide")]
    cards, rows, lang_repos = [], [], Counter()
    for r in shown:
        cur, mine, langs = curated.get(r["name"], {}), commits(r), lang_bytes(r)
        if mine:
            lang_repos.update(top_langs(langs, n=None, floor=0.05))
        area = cur.get("area", "misc")
        rows.append({"name": r["name"], "url": r["url"], "area": area, "fork": r["isFork"],
                     "language": (r["primaryLanguage"] or {}).get("name"), "commits": mine,
                     "stars": r["stargazerCount"], "updated": r["pushedAt"][:10]})
        cards.append({"kind": "public", "title": r["name"], "url": r["url"], "area": area,
                      "summary": cur.get("blurb") or r["description"] or "", "tags": cur.get("tags", []),
                      "featured": bool(cur.get("featured")), "languages": top_langs(langs),
                      "fork": r["isFork"], "upstream": (r["parent"] or {}).get("nameWithOwner"),
                      "upstream_url": (r["parent"] or {}).get("url"), "stars": r["stargazerCount"],
                      "commits": mine, "last_active": r["pushedAt"][:10]})
    for idea in ideas.values():
        cards.append({"kind": "idea", "title": idea["title"], "url": None, "area": idea["area"],
                      "summary": idea["summary"], "tags": idea.get("tags", []), "featured": bool(idea.get("featured"))})
    cards.sort(key=lambda c: (not c["featured"], c["kind"] != "idea", -(c.get("commits") or 0)))
    rows.sort(key=lambda r: r["updated"], reverse=True)

    area_counts = Counter(c["area"] for c in cards)
    data = {
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "profile": {"login": viewer["login"], "name": site.get("name") or viewer["name"], "location": viewer["location"],
                    "url": viewer["url"], "created_at": viewer["createdAt"][:10], "hireable": viewer["isHireable"],
                    "headline": site["headline"], "intro": site["intro"]},
        "contact": site.get("contact", {}),
        "skills": site["skills"],
        "totals": {
            "public_repos": len(shown),
            "commits_authored": sum(commits(r) for r in shown),
            "projects": len(cards),
            "ideas": sum(c["kind"] == "idea" for c in cards),
            "contributions_last_year": rolling["totalContributions"],
            "contributions_all_time": sum(y["total"] for y in years),
            "languages": len(lang_repos),
        },
        "years": years,
        "calendar": calendar,
        "monthly": monthly,
        "languages": [{"name": n, "repos": c} for n, c in lang_repos.most_common()],
        "areas": [{"id": a["id"], "label": a["label"], "projects": area_counts.get(a["id"], 0)} for a in site["areas"]],
        "projects": cards,
        "repositories": rows,
        "organizations": organizations,
    }

    text = json.dumps(data, indent=1, ensure_ascii=False)
    leaks = sorted(n for n in (private_names - generic_names) | hidden_logins
                   if re.search(rf"(?<![\w.-]){re.escape(n)}(?![\w.-])", text))
    if leaks:
        sys.exit(f"refusing to write {OUT}: private names found in output: {leaks}")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(text + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(shown)} public repos, {data['totals']['ideas']} ideas, {len(organizations)} public orgs")


if __name__ == "__main__":
    main()
