"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const state = { data: null, area: "all", vis: "all", query: "", sort: { key: "updated", dir: -1 }, animated: false };

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
const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));
const plural = (n, word, many = word + "s") => `${fmt(n)} ${n === 1 ? word : many}`;
const monthName = (ym, short = false) => {
  const [y, m] = ym.split("-");
  return short ? `${MONTHS[+m - 1]} ’${y.slice(2)}` : `${MONTHS[+m - 1]} ${y}`;
};
const when = (s) => (!s ? "—" : s.length > 7 ? `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}, ${s.slice(0, 4)}` : monthName(s));
const dateLabel = (iso) => {
  const d = new Date(iso + "T00:00:00Z");
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 4, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function lockIcon() {
  const s = svg("svg", { viewBox: "0 0 16 16", width: 12, height: 12, "aria-hidden": "true" });
  s.append(svg("path", { fill: "currentColor", d: "M4 7V5a4 4 0 1 1 8 0v2h1v8H3V7Zm2 0h4V5a2 2 0 1 0-4 0Z" }));
  return s;
}
const privateMark = () => el("span", { class: "lock" }, [lockIcon(), "Private"]);
const areaLabel = (id) => state.data.areas.find((a) => a.id === id)?.label ?? id;

// Monotone cubic (Fritsch–Carlson): a smooth trace that never overshoots the detections.
function monotonePath(pts) {
  const n = pts.length;
  if (n < 2) return "";
  const dx = [], m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${pts[i][0] + h},${pts[i][1] + h * t[i]} ${pts[i + 1][0] - h},${pts[i + 1][1] - h * t[i + 1]} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

// ---------- tooltip ----------
const tip = document.getElementById("tooltip");
function showTip(evt, value, label) {
  tip.replaceChildren(el("div", { class: "tv", text: value }), el("div", { class: "tl", text: label }));
  tip.hidden = false;
  let x, y;
  if (evt.clientX != null && evt.type !== "focus") { x = evt.clientX; y = evt.clientY; }
  else { const b = evt.target.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = x + 16, top = y - th - 14;
  if (left + tw > innerWidth - 8) left = x - tw - 16;
  if (top < 8) top = y + 18;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top = top + "px";
}
const hideTip = () => { tip.hidden = true; };

// ---------- pitch ----------
function renderPitch(d) {
  const p = d.profile, t = d.totals;
  document.getElementById("name").textContent = p.name || p.login;
  document.getElementById("headline").textContent = p.headline.replace(" · ", ", ");
  document.getElementById("intro").textContent = p.intro;
  document.getElementById("gh-link").href = p.url;
  document.getElementById("hireable").hidden = !p.hireable;
  document.getElementById("where").textContent = [p.location, `on GitHub since ${monthName(p.created_at.slice(0, 7))}`].filter(Boolean).join(", ");
  document.getElementById("readout").replaceChildren(
    el("span", { class: "big", text: fmt(t.contributions_last_year) }),
    el("span", { class: "unit", text: `contributions in the last 12 months, ${fmt(t.contributions_all_time)} in total` }),
  );
  document.getElementById("lede").textContent =
    `${fmt(t.repos)} repositories of my own, ${fmt(t.private)} of them private, with ${fmt(t.commits_authored)} commits. ` +
    `Another ${fmt(t.team_repos)} repositories in team organizations and other developers' projects.`;
  document.getElementById("generated").textContent =
    `Data from the GitHub API, generated ${when(d.generated_at.slice(0, 10))}. Private repositories appear as summaries only.`;
}

function renderTrajectory(d) {
  const host = document.getElementById("trajectory");
  const fig = host.closest(".track");
  const data = d.monthly;
  const W = Math.max(host.clientWidth, 300);
  const wide = W > 720;
  const H = wide ? 250 : 190, m = { t: 18, r: wide ? 220 : 10, b: 28, l: 34 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const max = niceMax(Math.max(...data.map((x) => x.count)));
  const x = (i) => m.l + (pw * i) / (data.length - 1);
  const y = (v) => m.t + ph - (v / max) * ph;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Contributions per month from ${monthName(data[0].month)} to ${monthName(data.at(-1).month)}, peaking at ${fmt(Math.max(...data.map((v) => v.count)))}` });

  for (const v of [0, max / 2, max]) {
    const yy = Math.round(y(v)) + 0.5;
    s.append(svg("line", { x1: m.l, x2: m.l + pw, y1: yy, y2: yy, class: "grid" }));
    s.append(svg("text", { x: m.l - 8, y: yy + 4, "text-anchor": "end" }, fmt(v)));
  }
  const every = Math.max(1, Math.ceil(data.length / (wide ? 8 : 4)));
  data.forEach((pt, i) => {
    if ((data.length - 1 - i) % every === 0) s.append(svg("text", { x: x(i), y: H - 6, "text-anchor": "middle" }, monthName(pt.month, true)));
  });

  const pts = data.map((pt, i) => [x(i), y(pt.count)]);
  const trace = svg("path", { d: monotonePath(pts), class: "trace" });
  s.append(trace);
  pts.slice(0, -1).forEach(([px, py], i) => s.append(svg("circle", { cx: px, cy: py, r: 4, class: "det", style: `--i:${i}` })));
  const [bx, by] = pts.at(-1);
  s.append(svg("circle", { cx: bx, cy: by, r: 7, class: "ball" }));

  const cross = svg("line", { y1: m.t, y2: m.t + ph, class: "crosshair", visibility: "hidden" });
  const hit = svg("rect", { x: m.l - 10, y: 0, width: pw + 20, height: H, class: "hit" });
  hit.addEventListener("pointermove", (e) => {
    const pt = s.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const local = pt.matrixTransform(s.getScreenCTM().inverse());
    const i = Math.max(0, Math.min(data.length - 1, Math.round(((local.x - m.l) / pw) * (data.length - 1))));
    cross.setAttribute("x1", Math.round(x(i)) + 0.5); cross.setAttribute("x2", Math.round(x(i)) + 0.5);
    cross.setAttribute("visibility", "visible");
    const partial = i === data.length - 1 ? " (so far)" : "";
    showTip(e, plural(data[i].count, "contribution"), monthName(data[i].month) + partial);
  });
  hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
  s.append(cross, hit);
  host.replaceChildren(s);

  if (!state.animated) {
    state.animated = true;
    trace.style.setProperty("--len", Math.ceil(trace.getTotalLength()));
    fig.classList.add("tracking");
  } else {
    fig.classList.remove("tracking");
  }
}

// ---------- what I build ----------
function renderAreas(d) {
  const areas = d.areas.filter((a) => a.id !== "misc" && a.public + a.private > 0);
  const max = Math.max(...areas.map((a) => a.public + a.private));
  document.getElementById("areas").replaceChildren(...areas.map((a) => {
    const total = a.public + a.private;
    const bar = el("span", { class: "track-bar", style: `width:${(100 * total) / max}%` }, [
      a.public ? el("span", { class: "seg pub", style: `flex:${a.public}` }) : null,
      a.private ? el("span", { class: "seg priv", style: `flex:${a.private}` }) : null,
    ]);
    const row = el("button", { type: "button", class: "area-row", "aria-pressed": String(state.area === a.id), "data-area": a.id }, [
      el("span", { class: "label", text: a.label }),
      el("span", { class: "bar-cell" }, [bar]),
      el("span", { class: "nums" }, [el("b", { text: String(total) }), `${a.public} public, ${a.private} private`]),
    ]);
    row.addEventListener("click", () => setArea(state.area === a.id ? "all" : a.id));
    return row;
  }));
  document.getElementById("area-legend").replaceChildren(
    el("span", {}, [el("i", { style: "background:var(--pub)" }), "Public"]),
    el("span", {}, [el("i", { style: "background:var(--priv)" }), "Private"]),
  );
  const select = document.getElementById("area-filter");
  select.replaceChildren(el("option", { value: "all", text: "All areas" }),
    ...d.areas.filter((a) => d.projects.some((p) => p.area === a.id)).map((a) => el("option", { value: a.id, text: a.label })));
}
function setArea(id) {
  state.area = id;
  document.getElementById("area-filter").value = id;
  document.querySelectorAll(".area-row").forEach((r) => r.setAttribute("aria-pressed", String(r.dataset.area === id)));
  renderProjects();
}

// ---------- projects ----------
function matches(p) {
  if (state.area !== "all" && p.area !== state.area) return false;
  if (state.vis !== "all" && p.kind !== state.vis) return false;
  if (!state.query) return true;
  const hay = [p.title, p.summary, areaLabel(p.area), ...p.tags, ...p.languages].join(" ").toLowerCase();
  return state.query.split(/\s+/).every((w) => hay.includes(w));
}
function meta(p) {
  const out = [];
  if (p.languages.length) out.push(el("span", {}, [el("b", { text: p.languages.join(", ") })]));
  if (p.commits) out.push(el("span", { text: plural(p.commits, "commit") }));
  if (p.repos > 1) out.push(el("span", { text: `${p.repos} repositories` }));
  if (p.stars) out.push(el("span", { text: plural(p.stars, "star") }));
  if (p.upstream) out.push(el("span", {}, ["Fork of ", el("a", { href: p.upstream_url, text: p.upstream })]));
  out.push(el("span", { text: `Active ${when(p.last_active)}` }));
  return el("div", { class: "meta" }, out);
}
function title(p) {
  return el("h4", {}, [p.url ? el("a", { href: p.url, text: p.title }) : p.title]);
}
function feature(p) {
  return el("article", { class: "feature" }, [
    el("div", { class: "kicker" }, [el("span", { text: areaLabel(p.area) }), p.kind === "private" ? privateMark() : p.fork ? el("span", { text: "Fork" }) : null]),
    title(p),
    el("p", { class: "summary", text: p.summary }),
    p.tags.length ? el("p", { class: "tags", text: p.tags.join(", ") }) : null,
    meta(p),
  ]);
}
function entry(p) {
  return el("article", { class: "entry" }, [
    title(p),
    p.kind === "private" ? el("div", { class: "kicker" }, [privateMark()]) : p.fork ? el("div", { class: "kicker", text: "Fork" }) : null,
    el("p", { class: "summary", text: p.summary }),
    meta(p),
  ]);
}
function renderProjects() {
  const d = state.data;
  const list = d.projects.filter(matches);
  const feat = list.filter((p) => p.featured);
  const rest = list.filter((p) => !p.featured);
  document.getElementById("featured").replaceChildren(...feat.map(feature));
  document.getElementById("featured-block").hidden = !feat.length;
  const groups = d.areas.map((a) => ({ a, items: rest.filter((p) => p.area === a.id) })).filter((g) => g.items.length);
  document.getElementById("groups").replaceChildren(...groups.map(({ a, items }) => el("section", { class: "group" }, [
    el("div", { class: "group-head" }, [el("h4", { text: a.label }), el("span", { text: plural(items.length, "project") })]),
    el("div", { class: "entries" }, items.map(entry)),
  ])));
  document.getElementById("more-block").hidden = !rest.length;
  document.getElementById("empty").hidden = list.length > 0;
  const priv = list.filter((p) => p.kind === "private").length;
  document.getElementById("project-count").textContent = `${plural(list.length, "project")}, ${list.length - priv} public and ${priv} private`;
}

// ---------- activity ----------
function renderHeatmap(d) {
  const host = document.getElementById("heatmap");
  const days = d.calendar;
  const nz = days.map((x) => x.count).filter(Boolean).sort((a, b) => a - b);
  const q = (p) => (nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] : 1);
  const [t1, t2, t3] = [q(0.25), q(0.5), q(0.75)];
  const level = (c) => (c === 0 ? 0 : c <= t1 ? 1 : c <= t2 ? 2 : c <= t3 ? 3 : 4);
  const first = new Date(days[0].date + "T00:00:00Z").getUTCDay();
  const weeks = Math.ceil((days.length + first) / 7);
  const W = Math.max(host.clientWidth, 760), left = 36, top = 20;
  const step = (W - left) / weeks, cell = Math.max(6, step - 3), H = top + 7 * step;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Daily contributions heatmap, ${fmt(d.totals.contributions_last_year)} in the last 12 months` });
  ["Mon", "Wed", "Fri"].forEach((name, i) => s.append(svg("text", { x: 0, y: top + (1 + 2 * i) * step + cell * 0.78 }, name)));
  let lastMonth = -1;
  days.forEach((day, i) => {
    const pos = i + first, col = Math.floor(pos / 7), row = pos % 7;
    const dt = new Date(day.date + "T00:00:00Z");
    if (row === 0 && dt.getUTCMonth() !== lastMonth && dt.getUTCDate() <= 7 && col < weeks - 1) {
      lastMonth = dt.getUTCMonth();
      s.append(svg("text", { x: left + col * step, y: 12 }, MONTHS[lastMonth]));
    }
    s.append(svg("rect", { x: left + col * step, y: top + row * step, width: cell, height: cell, rx: 3, fill: `var(--heat-${level(day.count)})` }));
  });
  const hit = svg("rect", { x: left, y: top, width: W - left, height: 7 * step, class: "hit" });
  hit.addEventListener("pointermove", (e) => {
    const pt = s.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(s.getScreenCTM().inverse());
    const col = Math.floor((p.x - left) / step), row = Math.min(6, Math.floor((p.y - top) / step));
    const day = days[col * 7 + row - first];
    if (!day) return hideTip();
    showTip(e, plural(day.count, "contribution"), dateLabel(day.date));
  });
  hit.addEventListener("pointerleave", hideTip);
  s.append(hit);
  host.replaceChildren(s);
  document.getElementById("heat-legend").replaceChildren(el("span", { text: "Fewer" }),
    ...[0, 1, 2, 3, 4].map((l) => el("i", { style: `background:var(--heat-${l})` })), el("span", { text: "More" }));
}
function renderTables(d) {
  document.querySelector("#years-table tbody").replaceChildren(...[...d.years].reverse().filter((x) => x.total).map((x) =>
    el("tr", {}, [el("td", { text: String(x.year) }), el("td", { class: "num", text: fmt(x.total) }), el("td", { class: "num", text: fmt(x.private) }), el("td", { class: "num", text: fmt(x.repos_created) })])));
  document.querySelector("#monthly-table tbody").replaceChildren(...[...d.monthly].reverse().map((x) =>
    el("tr", {}, [el("td", { text: monthName(x.month) }), el("td", { class: "num", text: fmt(x.count) })])));
}

// ---------- toolbox ----------
function renderLanguages(d) {
  const host = document.getElementById("languages");
  const top = d.languages.slice(0, 7).map((l) => ({ label: l.name, n: l.repos }));
  const rest = d.languages.slice(7).reduce((a, b) => a + b.repos, 0);
  if (rest) top.push({ label: "Other", n: rest });
  const W = Math.max(host.clientWidth, 280), rowH = 32, barH = 14, labelW = 128, right = 36;
  const max = Math.max(...top.map((r) => r.n));
  const s = svg("svg", { viewBox: `0 0 ${W} ${top.length * rowH}`, role: "img", "aria-label": "Languages by number of repositories" });
  top.forEach((r, i) => {
    const y0 = i * rowH, by = y0 + (rowH - barH) / 2, x1 = labelW + ((W - labelW - right) * r.n) / max;
    const rr = Math.min(4, x1 - labelW);
    s.append(svg("text", { x: 0, y: by + barH - 2, class: "val" }, r.label));
    s.append(svg("path", { d: `M${labelW},${by}H${x1 - rr}Q${x1},${by} ${x1},${by + rr}V${by + barH - rr}Q${x1},${by + barH} ${x1 - rr},${by + barH}H${labelW}Z`, fill: "var(--pub)" }));
    s.append(svg("text", { x: x1 + 8, y: by + barH - 2 }, String(r.n)));
    const hit = svg("rect", { x: 0, y: y0, width: W, height: rowH, class: "hit" });
    hit.addEventListener("pointermove", (e) => showTip(e, plural(r.n, "repository", "repositories"), r.label));
    hit.addEventListener("pointerleave", hideTip);
    s.append(hit);
  });
  host.replaceChildren(s);
  document.getElementById("skills").replaceChildren(...d.skills.map((g) => el("div", {}, [el("dt", { text: g.group }), el("dd", { text: g.items.join(", ") })])));
}

// ---------- repositories ----------
function renderRepos() {
  const { key, dir } = state.sort;
  const val = (r) => (key === "name" ? r.name || "~" : key === "area" ? areaLabel(r.area) : key === "commits" ? r.commits : r[key] || "");
  const rows = [...state.data.repositories].sort((a, b) => {
    const x = val(a), y = val(b);
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
  });
  document.querySelector("#repo-table tbody").replaceChildren(...rows.map((r) => el("tr", {}, [
    el("td", { class: "name" }, r.private
      ? [el("span", { class: "lock" }, [lockIcon(), r.card ? `Private, ${r.card}` : "Private"])]
      : [el("a", { href: r.url, text: r.name }), r.fork ? el("span", { class: "fork", text: "fork" }) : null]),
    el("td", { text: areaLabel(r.area) }),
    el("td", { text: r.language || "—" }),
    el("td", { class: "num", text: fmt(r.commits) }),
    el("td", { class: "num", text: when(r.updated) }),
  ])));
  document.querySelectorAll("#repo-table th button").forEach((b) => {
    if (b.dataset.sort === key) b.setAttribute("aria-sort", dir > 0 ? "ascending" : "descending");
    else b.removeAttribute("aria-sort");
  });
}

// ---------- teams ----------
function renderTeams(d) {
  document.getElementById("team-list").replaceChildren(...d.teams.map((t) => el("article", { class: "team" }, [
    el("div", { class: "who" }, [
      el("h3", {}, [t.url ? el("a", { href: t.url, text: t.label }) : t.label]),
      t.url ? el("span", { class: "lock", text: "Public organization" }) : privateMark(),
    ]),
    el("div", {}, [
      t.blurb ? el("p", { text: t.blurb }) : null,
      t.public.length ? el("ul", {}, t.public.map((r) => el("li", {}, [el("a", { href: r.url, text: r.name }), r.description ? `, ${r.description.toLowerCase()}` : ""]))) : null,
      t.languages.length ? el("p", { class: "langs", text: t.languages.join(", ") }) : null,
    ]),
    el("div", { class: "figs" }, [
      el("div", {}, [el("b", { text: fmt(t.repos) }), "repositories"]),
      el("div", {}, [el("b", { text: fmt(t.private_repos) }), "private"]),
      el("div", {}, [el("b", { text: when(t.last_active) }), "last active"]),
    ]),
  ])));
}

// ---------- wiring ----------
function renderCharts() {
  renderTrajectory(state.data);
  renderHeatmap(state.data);
  renderLanguages(state.data);
}
function initControls() {
  document.getElementById("area-filter").addEventListener("change", (e) => setArea(e.target.value));
  document.getElementById("vis-filter").addEventListener("change", (e) => { state.vis = e.target.value; renderProjects(); });
  document.getElementById("search").addEventListener("input", (e) => { state.query = e.target.value.trim().toLowerCase(); renderProjects(); });
  document.querySelectorAll("#repo-table th button").forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.sort;
    state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : ["name", "area", "language"].includes(key) ? 1 : -1 };
    renderRepos();
  }));
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (e) {}
  });
  let timer, lastW = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth === lastW) return;
    lastW = innerWidth;
    clearTimeout(timer);
    timer = setTimeout(renderCharts, 150);
  });
}

fetch("data/portfolio.json", { cache: "no-cache" })
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then((d) => {
    state.data = d;
    renderPitch(d);
    renderAreas(d);
    renderProjects();
    renderTables(d);
    renderRepos();
    renderTeams(d);
    const go = () => { renderCharts(); initControls(); };
    document.fonts && document.fonts.ready ? document.fonts.ready.then(go) : go();
  })
  .catch((err) => {
    document.getElementById("main").prepend(el("p", { class: "wrap empty", text: `The portfolio data did not load (${err.message}). Reload the page to try again.` }));
  });
