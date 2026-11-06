"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const state = { data: null, area: "all", vis: "all", query: "", sort: { key: "updated", dir: -1 } };

// ---------- helpers ----------
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}
function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}
const fmt = (n) => n == null ? "—" : n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "K" : n.toLocaleString("en-US");
const tick = (n) => n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + "K" : String(n);
const monthLabel = (ym, withYear = true) => {
  const [y, m] = ym.split("-");
  return MONTHS[+m - 1] + (withYear ? " " + y : "");
};
const dateLabel = (iso) => {
  const d = new Date(iso + "T00:00:00Z");
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
const when = (s) => s ? (s.length > 7 ? `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}, ${s.slice(0, 4)}` : monthLabel(s)) : "—";
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function colPath(x, y0, y1, w, r = 4) {
  const h = y0 - y1;
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
}
function barPath(x0, x1, y, h, rounded = true) {
  const w = x1 - x0;
  if (w <= 0) return "";
  const r = rounded ? Math.min(4, h / 2, w) : 0;
  return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
}

// ---------- tooltip ----------
const tip = document.getElementById("tooltip");
function showTip(evt, value, label, rows = []) {
  tip.replaceChildren(el("div", { class: "tv", text: value }), el("div", { class: "tl", text: label }));
  for (const r of rows) {
    tip.append(el("div", { class: "row" }, [el("span", { class: "key", style: `background:${r.color}` }), el("span", { text: r.text })]));
  }
  tip.hidden = false;
  let x, y;
  if (evt.clientX != null && evt.type !== "focus") { x = evt.clientX; y = evt.clientY; }
  else { const b = evt.target.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = x + 14, top = y - th - 12;
  if (left + tw > innerWidth - 8) left = x - tw - 14;
  if (top < 8) top = y + 16;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top = top + "px";
}
function hideTip() { tip.hidden = true; }
function bindTip(node, mark, fn) {
  const on = (e) => { mark && mark.classList.add("on"); fn(e); };
  const off = () => { mark && mark.classList.remove("on"); hideTip(); };
  node.addEventListener("pointermove", on);
  node.addEventListener("pointerleave", off);
  node.addEventListener("focus", on);
  node.addEventListener("blur", off);
}

// ---------- profile & tiles ----------
function renderProfile(d) {
  const p = d.profile;
  document.getElementById("avatar").src = p.avatar_url;
  document.getElementById("name").textContent = p.name || p.login;
  document.getElementById("headline").textContent = p.headline;
  document.getElementById("intro").textContent = p.intro;
  document.getElementById("location").textContent = [p.location, `on GitHub since ${when(p.created_at.slice(0, 7))}`].filter(Boolean).join(" · ");
  document.getElementById("gh-link").href = p.url;
  document.getElementById("hireable").hidden = !p.hireable;
  document.getElementById("generated").textContent =
    `Data from the GitHub API, generated ${when(d.generated_at.slice(0, 10))}. Built as a static page; private repositories appear only as summaries.`;
}

function sparkline(values) {
  const w = 200, h = 28, max = Math.max(...values, 1);
  const s = svg("svg", { class: "spark", viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  const pts = values.map((v, i) => [i * (w / (values.length - 1)), h - 3 - (v / max) * (h - 6)]);
  s.append(svg("path", { d: "M" + pts.map((p) => p.join(",")).join("L") + `L${w},${h}L0,${h}Z`, fill: "var(--series-1)", opacity: "0.1" }));
  s.append(svg("path", { d: "M" + pts.map((p) => p.join(",")).join("L"), fill: "none", stroke: "var(--series-1)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));
  return s;
}

function renderTiles(d) {
  const t = d.totals;
  const last12 = d.monthly.slice(-12).map((m) => m.count);
  const tiles = [
    { cls: "tile hero-tile", label: "Contributions in the last 12 months", value: fmt(t.contributions_last_year), sub: `${fmt(t.contributions_all_time)} all time`, spark: last12 },
    { label: "Repositories", value: fmt(t.repos), sub: `${t.public} public · ${t.private} private` },
    { label: "Commits authored", value: fmt(t.commits_authored), sub: "in my own repositories" },
    { label: "Team repositories", value: fmt(t.team_repos), sub: `${t.orgs} organizations + collaborations` },
    { label: "Languages", value: fmt(t.languages), sub: `${d.languages[0]?.name ?? ""} in ${d.languages[0]?.repos ?? 0} repos` },
  ];
  const host = document.getElementById("tiles");
  host.replaceChildren(...tiles.map((x) => el("div", { class: x.cls || "tile" }, [
    el("div", { class: "label", text: x.label }),
    el("div", { class: "value", text: x.value }),
    el("div", { class: "sub", text: x.sub }),
    x.spark ? sparkline(x.spark) : null,
  ])));
}

// ---------- heatmap ----------
function heatLevels(days) {
  const nz = days.map((d) => d.count).filter((c) => c > 0).sort((a, b) => a - b);
  const q = (p) => nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] : 1;
  return [q(0.25), q(0.5), q(0.75)];
}
function renderHeatmap(d) {
  const host = document.getElementById("heatmap");
  const days = d.calendar;
  const [t1, t2, t3] = heatLevels(days);
  const level = (c) => c === 0 ? 0 : c <= t1 ? 1 : c <= t2 ? 2 : c <= t3 ? 3 : 4;
  const first = new Date(days[0].date + "T00:00:00Z").getUTCDay();
  const weeks = Math.ceil((days.length + first) / 7);
  const W = Math.max(host.clientWidth, 720), left = 30, top = 18;
  const step = (W - left) / weeks, cell = Math.max(6, step - 3), H = top + 7 * step;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Contribution heatmap: ${fmt(d.totals.contributions_last_year)} contributions in the last 12 months` });
  ["Mon", "Wed", "Fri"].forEach((name, i) => s.append(svg("text", { x: 0, y: top + (1 + 2 * i) * step + cell * 0.8 }, name)));
  let lastMonth = -1;
  days.forEach((day, i) => {
    const pos = i + first, col = Math.floor(pos / 7), row = pos % 7;
    const dt = new Date(day.date + "T00:00:00Z");
    if (row === 0 || i === 0) {
      const m = dt.getUTCMonth();
      if (m !== lastMonth && dt.getUTCDate() <= 7 && col < weeks - 1) {
        s.append(svg("text", { x: left + col * step, y: 11 }, MONTHS[m]));
        lastMonth = m;
      }
    }
    s.append(svg("rect", { x: left + col * step, y: top + row * step, width: cell, height: cell, rx: 2, fill: `var(--heat-${level(day.count)})`, class: "mark" }));
  });
  // One pointer layer: the nearest cell answers, gaps included.
  const hit = svg("rect", { x: left, y: top, width: W - left, height: 7 * step, class: "hit" });
  hit.addEventListener("pointermove", (e) => {
    const pt = s.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(s.getScreenCTM().inverse());
    const col = Math.floor((p.x - left) / step), row = Math.min(6, Math.floor((p.y - top) / step));
    const day = days[col * 7 + row - first];
    if (!day) return hideTip();
    showTip(e, `${day.count} contribution${day.count === 1 ? "" : "s"}`, dateLabel(day.date));
  });
  hit.addEventListener("pointerleave", hideTip);
  s.append(hit);
  host.replaceChildren(s);

  const legend = document.getElementById("heat-legend");
  legend.replaceChildren(el("span", { text: "Less" }), ...[0, 1, 2, 3, 4].map((l) => el("i", { style: `background:var(--heat-${l})` })), el("span", { text: "More" }));
}

// ---------- monthly columns ----------
function renderMonthly(d) {
  const host = document.getElementById("monthly");
  const data = d.monthly;
  const W = Math.max(host.clientWidth, 300), H = 240, m = { t: 22, r: 8, b: 26, l: 36 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const max = niceMax(Math.max(...data.map((x) => x.count)));
  const band = pw / data.length, bw = Math.min(24, band * 0.7);
  const y = (v) => m.t + ph - (v / max) * ph;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Contributions per month, column chart" });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = Math.round(y(v)) + 0.5;
    s.append(svg("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: i ? "grid" : "base" }));
    s.append(svg("text", { x: m.l - 6, y: yy + 4, "text-anchor": "end" }, tick(v)));
  }
  const peak = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]);
  const labelEvery = Math.ceil(data.length / (W < 520 ? 4 : 8));
  data.forEach((x, i) => {
    const cx = m.l + band * i + band / 2;
    const g = svg("g");
    const hit = svg("rect", { x: m.l + band * i, y: m.t, width: band, height: ph, class: "hit", tabindex: 0, "aria-label": `${monthLabel(x.month)}: ${x.count} contributions` });
    const mark = svg("path", { d: colPath(cx - bw / 2, y(0), y(x.count), bw), fill: "var(--series-1)", class: "mark" });
    g.append(hit, mark);
    bindTip(hit, mark, (e) => showTip(e, `${fmt(x.count)} contributions`, monthLabel(x.month)));
    s.append(g);
    if ((data.length - 1 - i) % labelEvery === 0) s.append(svg("text", { x: cx, y: H - 8, "text-anchor": "middle" }, monthLabel(x.month).replace(/ 20(\d\d)$/, " ’$1")));
    if ((x === peak || i === data.length - 1) && x.count > 0) s.append(svg("text", { x: cx, y: y(x.count) - 6, "text-anchor": "middle", class: "val" }, fmt(x.count)));
  });
  host.replaceChildren(s);

  document.querySelector("#monthly-table tbody").replaceChildren(...[...data].reverse().map((x) =>
    el("tr", {}, [el("td", { text: monthLabel(x.month) }), el("td", { class: "num", text: fmt(x.count) })])));
  document.querySelector("#years-table tbody").replaceChildren(...[...d.years].reverse().filter((x) => x.total).map((x) =>
    el("tr", {}, [el("td", { text: String(x.year) }), el("td", { class: "num", text: fmt(x.total) }), el("td", { class: "num", text: fmt(x.private) }), el("td", { class: "num", text: fmt(x.repos_created) })])));
}

// ---------- horizontal bars ----------
function hbars(host, rows, { series, total, label }) {
  const W = Math.max(host.clientWidth, 300), rowH = 30, barH = 14, labelW = Math.min(190, W * 0.42), m = { t: 4, r: 40 };
  const H = m.t + rows.length * rowH;
  const max = Math.max(...rows.map(total), 1);
  const x = (v) => labelW + (v / max) * (W - labelW - m.r);
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label });
  s.append(svg("line", { x1: labelW + 0.5, x2: labelW + 0.5, y1: 0, y2: H, class: "base" }));
  rows.forEach((r, i) => {
    const y0 = m.t + i * rowH, by = y0 + (rowH - barH) / 2;
    s.append(svg("text", { x: labelW - 10, y: by + barH - 3, "text-anchor": "end", class: "cat" }, r.label));
    let acc = 0;
    const present = series.filter((sr) => sr.value(r) > 0);
    present.forEach((sr, j) => {
      const v = sr.value(r), last = j === present.length - 1;
      const x0 = x(acc) + (j ? 2 : 0), x1 = x(acc + v);
      acc += v;
      const mark = svg("path", { d: barPath(x0, x1, by, barH, last), fill: sr.color, class: "mark" });
      const hit = svg("rect", { x: x0, y: y0, width: Math.max(x1 - x0, 6), height: rowH, class: "hit", tabindex: 0, "aria-label": `${r.label}, ${sr.name}: ${v}` });
      bindTip(hit, mark, (e) => showTip(e, `${v} ${sr.unit(v)}`, series.length > 1 ? `${r.label} · ${sr.name}` : r.label));
      s.append(mark, hit);
    });
    s.append(svg("text", { x: x(total(r)) + 6, y: by + barH - 3, class: "val" }, String(total(r))));
  });
  host.replaceChildren(s);
}

function renderFocus(d) {
  const areas = d.areas.filter((a) => a.public + a.private > 0 && a.id !== "misc");
  const repoUnit = (v) => (v === 1 ? "repository" : "repositories");
  const series = [
    { name: "Public", color: "var(--series-1)", value: (r) => r.public, unit: (v) => `public ${repoUnit(v)}` },
    { name: "Private", color: "var(--series-2)", value: (r) => r.private, unit: (v) => `private ${repoUnit(v)}` },
  ];
  hbars(document.getElementById("areas"), areas, { series, total: (r) => r.public + r.private, label: "Repositories by area, public and private" });
  document.getElementById("area-legend").replaceChildren(...series.map((sr) => el("span", {}, [el("i", { style: `background:${sr.color}` }), sr.name])));

  const top = d.languages.slice(0, 7);
  const rest = d.languages.slice(7).reduce((a, b) => a + b.repos, 0);
  const langs = top.map((l) => ({ label: l.name, n: l.repos }));
  if (rest) langs.push({ label: "Other", n: rest });
  hbars(document.getElementById("languages"), langs, {
    series: [{ name: "Repositories", color: "var(--series-1)", value: (r) => r.n, unit: repoUnit }],
    total: (r) => r.n, label: "Languages by number of repositories",
  });

  document.getElementById("skills").replaceChildren(...d.skills.map((g) => el("div", {}, [
    el("h3", { text: g.group }),
    el("div", { class: "chips" }, g.items.map((i) => el("span", { class: "chip", text: i }))),
  ])));
}

// ---------- projects ----------
function areaLabel(id) { return state.data.areas.find((a) => a.id === id)?.label ?? id; }
function projectMatches(p) {
  if (state.area !== "all" && p.area !== state.area) return false;
  if (state.vis !== "all" && p.kind !== state.vis) return false;
  if (!state.query) return true;
  const hay = [p.title, p.summary, areaLabel(p.area), ...p.tags, ...p.languages].join(" ").toLowerCase();
  return state.query.split(/\s+/).every((w) => hay.includes(w));
}
function projectCard(p) {
  const title = p.url ? el("a", { href: p.url, text: p.title }) : document.createTextNode(p.title);
  const pills = [];
  if (p.kind === "private") pills.push(el("span", { class: "pill", title: "Source is private" }, [lockIcon(), "Private"]));
  else if (p.fork) pills.push(el("span", { class: "pill", text: "Fork" }));
  if (p.featured) pills.push(el("span", { class: "pill featured", text: "Featured" }));
  const meta = [];
  if (p.languages.length) meta.push(el("span", {}, [el("b", { text: p.languages.join(" · ") })]));
  if (p.commits) meta.push(el("span", { text: `${fmt(p.commits)} commit${p.commits === 1 ? "" : "s"}` }));
  if (p.repos > 1) meta.push(el("span", { text: `${p.repos} repositories` }));
  if (p.stars) meta.push(el("span", { text: `★ ${p.stars}` }));
  if (p.upstream) meta.push(el("span", {}, ["fork of ", el("a", { href: p.upstream_url, text: p.upstream })]));
  meta.push(el("span", { text: `active ${when(p.last_active)}` }));
  return el("article", { class: "project" }, [
    el("div", { class: "top" }, [el("div", {}, [el("h3", {}, [title]), el("div", { class: "area", text: areaLabel(p.area) })]), el("div", { class: "chips" }, pills)]),
    el("p", { class: "summary", text: p.summary }),
    p.tags.length ? el("div", { class: "tags" }, p.tags.map((t) => el("span", { class: "tag", text: t }))) : null,
    el("div", { class: "meta" }, meta),
  ]);
}
function lockIcon() {
  const s = svg("svg", { viewBox: "0 0 16 16", width: 11, height: 11, "aria-hidden": "true" });
  s.append(svg("path", { fill: "currentColor", d: "M4 7V5a4 4 0 1 1 8 0v2h1v8H3V7Zm2 0h4V5a2 2 0 1 0-4 0Z" }));
  return s;
}
function renderFilters(d) {
  const counts = {};
  for (const p of d.projects) counts[p.area] = (counts[p.area] || 0) + 1;
  const opts = [{ id: "all", label: "All", n: d.projects.length }, ...d.areas.filter((a) => counts[a.id]).map((a) => ({ id: a.id, label: a.label, n: counts[a.id] }))];
  const host = document.getElementById("area-filter");
  host.replaceChildren(...opts.map((o) => {
    const b = el("button", { type: "button", class: "chip", "aria-pressed": String(state.area === o.id) }, [o.label, el("span", { class: "n", text: String(o.n) })]);
    b.addEventListener("click", () => { state.area = o.id; renderFilters(d); renderProjects(); });
    return b;
  }));
}
function renderProjects() {
  const list = state.data.projects.filter(projectMatches);
  const grid = document.getElementById("project-grid");
  grid.replaceChildren(...(list.length ? list.map(projectCard) : [el("div", { class: "empty", text: "No projects match these filters." })]));
  const priv = list.filter((p) => p.kind === "private").length;
  document.getElementById("project-count").textContent = `${list.length} project${list.length === 1 ? "" : "s"} · ${list.length - priv} public, ${priv} private`;
}

// ---------- repository table ----------
function renderRepos() {
  const { key, dir } = state.sort;
  const val = (r) => key === "name" ? (r.name || "~") : key === "area" ? areaLabel(r.area) : key === "commits" ? r.commits : (r[key] || "");
  const rows = [...state.data.repositories].sort((a, b) => {
    const x = val(a), y = val(b);
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
  });
  document.querySelector("#repo-table tbody").replaceChildren(...rows.map((r) => {
    const name = r.private
      ? el("span", { class: "lock" }, [lockIcon(), " Private", r.card ? ` · ${r.card}` : ""])
      : el("span", {}, [el("a", { href: r.url, text: r.name }), r.fork ? el("span", { class: "muted", text: " · fork" }) : null]);
    return el("tr", {}, [
      el("td", { class: "name" }, [name]),
      el("td", { text: areaLabel(r.area) }),
      el("td", { text: r.language || "—" }),
      el("td", { class: "num", text: fmt(r.commits) }),
      el("td", { class: "num", text: when(r.updated) }),
    ]);
  }));
  document.querySelectorAll("#repo-table th button").forEach((b) => {
    if (b.dataset.sort === key) b.setAttribute("aria-sort", dir > 0 ? "ascending" : "descending");
    else b.removeAttribute("aria-sort");
  });
}

// ---------- teams ----------
function renderTeams(d) {
  document.getElementById("team-grid").replaceChildren(...d.teams.map((t) => el("article", { class: "project team" }, [
    el("div", { class: "top" }, [
      el("h3", {}, [t.url ? el("a", { href: t.url, text: t.label }) : document.createTextNode(t.label)]),
      el("span", { class: "pill" }, t.url ? ["Public org"] : [lockIcon(), "Private"]),
    ]),
    t.blurb ? el("p", { class: "summary", text: t.blurb }) : null,
    el("div", { class: "stats" }, [
      el("div", {}, [el("b", { text: fmt(t.repos) }), "repositories"]),
      el("div", {}, [el("b", { text: fmt(t.private_repos) }), "private"]),
      el("div", {}, [el("b", { text: when(t.last_active) }), "last active"]),
    ]),
    t.public.length ? el("ul", {}, t.public.map((r) => el("li", {}, [el("a", { href: r.url, text: r.name }), r.description ? ` · ${r.description}` : ""]))) : null,
    t.languages.length ? el("div", { class: "tags" }, t.languages.map((l) => el("span", { class: "tag", text: l }))) : null,
  ])));
}

// ---------- wiring ----------
function renderCharts() {
  renderHeatmap(state.data);
  renderMonthly(state.data);
  renderFocus(state.data);
}
function initControls() {
  document.getElementById("vis-filter").addEventListener("change", (e) => { state.vis = e.target.value; renderProjects(); });
  document.getElementById("search").addEventListener("input", (e) => { state.query = e.target.value.trim().toLowerCase(); renderProjects(); });
  document.querySelectorAll("#repo-table th button").forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.sort;
    state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : (key === "name" || key === "area" || key === "language" ? 1 : -1) };
    renderRepos();
  }));
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
  });
  let timer;
  let lastW = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth === lastW) return;
    lastW = innerWidth;
    clearTimeout(timer);
    timer = setTimeout(renderCharts, 150);
  });
}

fetch("data/portfolio.json", { cache: "no-cache" })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((d) => {
    state.data = d;
    renderProfile(d);
    renderTiles(d);
    renderCharts();
    renderFilters(d);
    renderProjects();
    renderRepos();
    renderTeams(d);
    initControls();
  })
  .catch((err) => {
    document.getElementById("main").prepend(el("p", { class: "card", text: `Could not load portfolio data (${err.message}).` }));
  });
