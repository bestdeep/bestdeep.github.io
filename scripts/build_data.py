#!/usr/bin/env python3
"""Regenerate data/portfolio.json from the GitHub API.

Run from the repo root with an authenticated `gh` CLI that can read the
private repositories (scope: repo, read:org):

    python3 scripts/build_data.py

Private repositories and private organization memberships are published only
as anonymized cards and aggregates. Their names stay in the gitignored
content/private.local.json, and the script refuses to write the output if any
private repo name, private org login or collaborator owner appears in it.
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
  defaultBranchRef { target { ... on Commit { history { totalCount } mine: history(author: {id: $uid}) { totalCount } } } }
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
        data = graphql(query, cursor=cursor, **variables)
        conn = data
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


def month(ts):
    return ts[:7] if ts else None


def commits(repo):
    target = (repo.get("defaultBranchRef") or {}).get("target") or {}
    return (target.get("mine") or {}).get("totalCount", 0), (target.get("history") or {}).get("totalCount", 0)


def lang_bytes(repo):
    return {e["node"]["name"]: e["size"] for e in repo["languages"]["edges"]}


def top_langs(byte_map, n=4, floor=0.03):
    total = sum(byte_map.values()) or 1
    return [name for name, size in sorted(byte_map.items(), key=lambda kv: -kv[1]) if size / total >= floor][:n]


def main():
    site = load("site.json")
    curated = {k: v for k, v in load("projects.json").items() if not k.startswith("_")}
    groups = {k: v for k, v in load("private_groups.json").items() if not k.startswith("_")}
    local = load("private.local.json", default={"repos": {}, "areas": {}, "teams": {}})
    private_map, area_override, team_labels = local.get("repos", {}), local.get("areas", {}), local.get("teams", {})
    # Private names that are ordinary words and may legitimately occur in the prose.
    generic_names = set(local.get("generic_names", []))

    viewer = graphql("""query { viewer { id login name bio location avatarUrl url createdAt isHireable
        followers { totalCount } following { totalCount } } }""")["viewer"]
    uid = viewer["id"]

    repos = paged(f"""query($cursor: String, $uid: ID!) {{ viewer {{
        repositories(first: 50, after: $cursor, ownerAffiliations: OWNER) {{
          pageInfo {{ hasNextPage endCursor }} nodes {{ {REPO_FIELDS} }} }} }} }}""",
                  ["viewer", "repositories"], uid=uid)

    # Contributions: one calendar per year since the account was created, plus the rolling year.
    now = dt.datetime.now(dt.timezone.utc)
    years, days = [], {}
    for year in range(int(viewer["createdAt"][:4]), now.year + 1):
        c = graphql(f"""query {{ viewer {{ contributionsCollection(from: "{year}-01-01T00:00:00Z", to: "{year}-12-31T23:59:59Z") {{
            totalCommitContributions restrictedContributionsCount totalPullRequestContributions totalRepositoryContributions
            contributionCalendar {{ totalContributions weeks {{ contributionDays {{ date contributionCount }} }} }} }} }} }}""")
        c = c["viewer"]["contributionsCollection"]
        years.append({"year": year, "total": c["contributionCalendar"]["totalContributions"],
                      "public_commits": c["totalCommitContributions"], "private": c["restrictedContributionsCount"],
                      "pull_requests": c["totalPullRequestContributions"], "repos_created": c["totalRepositoryContributions"]})
        for week in c["contributionCalendar"]["weeks"]:
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

    # Organizations: named only when the membership is public.
    public_orgs = {o["login"] for o in gh_json("api", f"users/{viewer['login']}/orgs")}
    orgs = paged("""query($cursor: String) { viewer { organizations(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor } nodes { login url } } } }""", ["viewer", "organizations"])
    teams, private_names, hidden_logins = [], set(), set()
    for org in orgs:
        org_repos = paged("""query($cursor: String, $login: String!) { organization(login: $login) {
            repositories(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor }
              nodes { name isPrivate url description pushedAt primaryLanguage { name } } } } }""",
                          ["organization", "repositories"], login=org["login"])
        is_public = org["login"] in public_orgs
        if not is_public:
            hidden_logins.add(org["login"])
        private_names |= {r["name"] for r in org_repos if r["isPrivate"]}
        label = team_labels.get(org["login"], {})
        teams.append({
            "label": org["login"] if is_public else label.get("label", "Private organization"),
            "url": org["url"] if is_public else None,
            "blurb": label.get("blurb", ""),
            "repos": len(org_repos),
            "private_repos": sum(r["isPrivate"] for r in org_repos),
            "languages": [l for l, _ in Counter(r["primaryLanguage"]["name"] for r in org_repos if r["primaryLanguage"]).most_common(5)],
            "last_active": month(max((r["pushedAt"] for r in org_repos if r["pushedAt"]), default=None)),
            # A hidden org's public repos would reveal the org through their URLs.
            "public": [{"name": r["name"], "url": r["url"], "description": r["description"] or ""}
                       for r in org_repos if not r["isPrivate"]] if is_public else [],
        })
    org_logins = {o["login"] for o in orgs}
    collab = [r for r in gh_json("api", "user/repos?affiliation=collaborator&per_page=100", "--paginate")
              if r["owner"]["login"] not in org_logins and r["owner"]["login"] != viewer["login"]]
    if collab:
        hidden_logins |= {r["owner"]["login"] for r in collab}
        private_names |= {r["name"] for r in collab if r["private"]}
        teams.append({
            "label": "Collaborations", "url": None,
            "blurb": "Repositories owned by other developers where I am a collaborator.",
            "repos": len(collab), "private_repos": sum(r["private"] for r in collab),
            "languages": [l for l, _ in Counter(r["language"] for r in collab if r["language"]).most_common(5)],
            "last_active": month(max((r["pushed_at"] for r in collab if r["pushed_at"]), default=None)),
            "public": [],
        })
    teams.sort(key=lambda t: -t["repos"])

    # Owned repositories -> cards, table rows, aggregates.
    area_ids = [a["id"] for a in site["areas"]]
    cards, rows, group_acc = [], [], defaultdict(list)
    area_counts = {a: {"public": 0, "private": 0} for a in area_ids}
    lang_repos, lang_size = Counter(), Counter()
    for r in repos:
        mine, total = commits(r)
        langs = lang_bytes(r)
        # Languages count per repo I have committed to; a fork's upstream code is not mine.
        if mine:
            lang_repos.update(top_langs(langs, n=None, floor=0.05))
        if not r["isFork"]:
            lang_size.update(langs)
        if r["isPrivate"]:
            private_names.add(r["name"])
            gid = private_map.get(r["name"])
            area = area_override.get(r["name"]) or (groups.get(gid, {}).get("area") if gid else None) or "misc"
            if gid in groups:
                group_acc[gid].append(r)
            rows.append({"name": None, "private": True, "area": area, "card": groups.get(gid, {}).get("title"),
                         "language": (r["primaryLanguage"] or {}).get("name"), "fork": r["isFork"],
                         "commits": mine, "updated": month(r["pushedAt"]), "url": None})
        else:
            cur = curated.get(r["name"], {})
            area = cur.get("area", "misc")
            if cur.get("hide"):  # profile and scratch repos stay out of the site entirely
                area_counts.setdefault(area, {"public": 0, "private": 0})["public"] += 1
                continue
            rows.append({"name": r["name"], "private": False, "area": area, "card": None,
                         "language": (r["primaryLanguage"] or {}).get("name"), "fork": r["isFork"],
                         "commits": mine, "updated": r["pushedAt"][:10], "url": r["url"],
                         "stars": r["stargazerCount"]})
            if not cur.get("hide"):
                cards.append({"kind": "public", "title": r["name"], "url": r["url"], "area": area,
                              "summary": cur.get("blurb") or r["description"] or "", "tags": cur.get("tags", []),
                              "featured": bool(cur.get("featured")), "languages": top_langs(langs),
                              "fork": r["isFork"], "upstream": (r["parent"] or {}).get("nameWithOwner"),
                              "upstream_url": (r["parent"] or {}).get("url"),
                              "stars": r["stargazerCount"], "forks": r["forkCount"], "commits": mine,
                              "repos": 1, "first_active": month(r["createdAt"]), "last_active": r["pushedAt"][:10]})
        area_counts.setdefault(area, {"public": 0, "private": 0})["private" if r["isPrivate"] else "public"] += 1

    for gid, members in group_acc.items():
        g = groups[gid]
        merged = Counter()
        for m in members:
            merged.update(lang_bytes(m))
        cards.append({"kind": "private", "title": g["title"], "url": None, "area": g["area"],
                      "summary": g["summary"], "tags": g.get("tags", []), "featured": bool(g.get("featured")),
                      "languages": top_langs(merged), "fork": False, "upstream": None, "upstream_url": None,
                      "stars": None, "forks": None, "commits": sum(commits(m)[0] for m in members),
                      "repos": len(members), "first_active": month(min(m["createdAt"] for m in members)),
                      "last_active": month(max(m["pushedAt"] for m in members))})
    cards.sort(key=lambda c: (not c["featured"], -(c["commits"] or 0)))
    rows.sort(key=lambda r: r["updated"] or "", reverse=True)

    total_size = sum(lang_size.values()) or 1
    languages = [{"name": n, "repos": c, "share": round(lang_size.get(n, 0) / total_size, 4)}
                 for n, c in lang_repos.most_common()]
    private_count = sum(r["isPrivate"] for r in repos)
    data = {
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "profile": {"login": viewer["login"], "name": viewer["name"], "bio": viewer["bio"], "location": viewer["location"],
                    "avatar_url": viewer["avatarUrl"], "url": viewer["url"], "created_at": viewer["createdAt"][:10],
                    "followers": viewer["followers"]["totalCount"], "following": viewer["following"]["totalCount"],
                    "hireable": viewer["isHireable"], "headline": site["headline"], "intro": site["intro"]},
        "skills": site["skills"],
        "totals": {
            "repos": len(repos), "public": len(repos) - private_count, "private": private_count,
            "forks": sum(r["isFork"] for r in repos),
            "stars": sum(r["stargazerCount"] for r in repos),
            "commits_authored": sum(commits(r)[0] for r in repos),
            "contributions_last_year": rolling["totalContributions"],
            "contributions_all_time": sum(y["total"] for y in years),
            "orgs": len(orgs), "team_repos": sum(t["repos"] for t in teams),
            "languages": len(lang_size),
        },
        "years": years,
        "calendar": calendar,
        "monthly": monthly,
        "languages": languages,
        "areas": [{"id": a["id"], "label": a["label"], **area_counts.get(a["id"], {"public": 0, "private": 0})}
                  for a in site["areas"]],
        "projects": cards,
        "repositories": rows,
        "teams": teams,
    }

    text = json.dumps(data, indent=1, ensure_ascii=False)
    leaks = sorted(n for n in (private_names - generic_names) | hidden_logins
                   if re.search(rf"(?<![\w.-]){re.escape(n)}(?![\w.-])", text))
    if leaks:
        sys.exit(f"refusing to write {OUT}: private names found in output: {leaks}")
    unmapped = [r["name"] for r in repos if r["isPrivate"] and r["name"] not in private_map]
    if unmapped:
        print(f"note: {len(unmapped)} private repo(s) not mapped to a card; they appear only as anonymous rows: {unmapped}")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(text + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(repos)} repos, {len(cards)} cards, {len(teams)} teams")


if __name__ == "__main__":
    main()
