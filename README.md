# bestdeep.github.io

Portfolio dashboard for [github.com/bestdeep](https://github.com/bestdeep), published with GitHub Pages at **https://bestdeep.github.io/**.

It is a static page with no build step: `index.html`, `assets/`, and a single data file, `data/portfolio.json`, generated from the GitHub API.

## What it shows

- Profile, headline stats and a 12-month contribution heatmap (public and private contributions)
- Contributions per month and per year
- Repositories by area (public vs private) and languages
- Project cards with area, visibility and text filters
- A table of owned repositories, plus team and collaboration summaries

## Privacy

Private work is published only as summaries:

- Private repositories appear as anonymized project cards and table rows. Their names, URLs and code are never published.
- Organizations are named only when the membership is public; others are shown under a descriptive label.
- The mapping from private repo and org names to cards lives in `content/private.local.json`, which is gitignored.
- `scripts/build_data.py` refuses to write `data/portfolio.json` if any private repo name, hidden org login or collaborator owner appears in it.

## Updating the data

Requires an authenticated [GitHub CLI](https://cli.github.com/) with `repo` and `read:org` scopes:

```bash
python3 scripts/build_data.py   # rewrites data/portfolio.json
git commit -am "Refresh portfolio data" && git push
```

Edit the content without touching code:

| File | Purpose |
|---|---|
| `content/site.json` | headline, intro, skills, area list |
| `content/projects.json` | public repos: area, tags, blurb, featured, hide |
| `content/private_groups.json` | anonymized cards for private work |
| `content/private.local.json` | gitignored: private repo → card, org → label |

A private repo missing from `private.local.json` still counts in the totals and shows up as an anonymous table row.

## Local preview

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
