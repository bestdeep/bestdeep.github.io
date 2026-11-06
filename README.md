# bestdeep.github.io

Portfolio of **Lucky Star**, AI and blockchain engineer, published with GitHub Pages at **https://bestdeep.github.io/**.

A static page with no build step: `index.html`, `assets/`, and two content files the page loads at runtime.

## What it shows

- A header with a constellation of projects: each star is one project, grouped by area; selecting a star jumps to it
- Projects by area (the area bars double as a filter), selected work, and every other project grouped by area, each described as a one-line idea, with search
- Toolbox (skills) and contact links (email and Telegram)

The Lucky Star logo (`assets/logo-96.png`, favicons, `apple-touch-icon.png`, and `og.jpg` for link previews) is cut from `luckystar.png` in the resource repo, cropped to a circle for use on the pink band.

The theme is a soft pink sky with light and dark modes. Behind the page (`assets/sky.js`), a slow current of stardust flows across, a golden lucky star rides it with a glitter trail, and a shooting star passes now and then; it holds still for visitors who prefer reduced motion. Type is Archivo (Google Fonts), used across its width axis.

## Editing

| File | Purpose |
|---|---|
| `content/site.json` | name, headline, intro, open-to-work flag, contact links, skills, areas |
| `content/projects.json` | projects: title, area, a one-sentence idea, featured |

Star positions are seeded from each project's title, so the constellation looks the same on every visit.

## Local preview

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
