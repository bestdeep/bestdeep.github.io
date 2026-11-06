# bestdeep.github.io

Portfolio of **Lucky Star** ([github.com/bestdeep](https://github.com/bestdeep)), published with GitHub Pages at **https://bestdeep.github.io/**.

It is a static page with no build step: `index.html`, `assets/`, and a single data file, `data/portfolio.json`, generated from the GitHub API.

## What it shows

- A header that plots contributions per month as a shooting star's trail, with the 12-month total beside it
- Projects by area; the area bars double as the project filter
- Selected work and all other projects grouped by area: public repositories with their stats, and ideas written up from work whose code isn't public
- A 12-month contribution heatmap and yearly totals
- Languages and skills, a table of public repositories, and contact links (email, Telegram, GitHub)

The visual identity is a twilight sky: ultramarine header and contact block, chalk lines, and one gold star marking the current month. Type is Archivo (Google Fonts), used across its width axis.

## Privacy

- Only public repositories are published. Private repositories contribute nothing to the data: no rows, counts, commits or languages.
- Ideas in `content/ideas.json` are plain text written for the site; no repository data is attached to them.
- Organizations are named only when the membership is public.
- `scripts/build_data.py` reads private repo names, hidden org logins and collaborator owners only to check that none of them appears in the output, and refuses to write `data/portfolio.json` if one does. Private names that are ordinary words (and so may appear in prose) can be listed in the gitignored `content/private.local.json` under `generic_names`.

## Updating the data

Requires an authenticated [GitHub CLI](https://cli.github.com/) with `repo` and `read:org` scopes:

```bash
python3 scripts/build_data.py   # rewrites data/portfolio.json
git commit -am "Refresh portfolio data" && git push
```

Edit the content without touching code:

| File | Purpose |
|---|---|
| `content/site.json` | name, headline, intro, contact links, skills, areas, public-org blurbs |
| `content/projects.json` | public repos: area, tags, blurb, featured, hide |
| `content/ideas.json` | ideas and write-ups without public code |

## Local preview

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
