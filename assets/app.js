"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const state = { site: null, projects: [], area: "all", query: "", lit: false };

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
const plural = (n, word) => `${n} ${n === 1 ? word : word + "s"}`;
const slug = (s) => "p-" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const areaLabel = (id) => state.site.areas.find((a) => a.id === id)?.label ?? id;
function icon(name) {
  const paths = {
    mail: "M2 4h20v16H2Zm2 2v.4l8 5.1 8-5.1V6Zm16 2.8-8 5.1-8-5.1V18h16Z",
    telegram: "M21.9 4.3 18.7 19.5c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9-8.2c.4-.4-.1-.6-.6-.2L6.3 13.1l-4.8-1.5c-1-.3-1-1 .2-1.5L20.6 2.9c.9-.3 1.6.2 1.3 1.4Z",
  };
  const s = svg("svg", { viewBox: "0 0 24 24", width: 16, height: 16, "aria-hidden": "true" });
  s.append(svg("path", { fill: "currentColor", d: paths[name] }));
  return s;
}
function starPath(cx, cy, r) {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    d += `${i ? "L" : "M"}${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
  }
  return d + "Z";
}
// Seeded randomness keeps every star in the same place on every visit and resize.
function hash(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- tooltip ----------
const tip = document.getElementById("tooltip");
function showTip(evt, value, label) {
  tip.replaceChildren(el("div", { class: "tv", text: value }), el("div", { class: "tl", text: label }));
  tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = evt.clientX + 16, top = evt.clientY - th - 14;
  if (left + tw > innerWidth - 8) left = evt.clientX - tw - 16;
  if (top < 8) top = evt.clientY + 18;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top = top + "px";
}
const hideTip = () => { tip.hidden = true; };

// ---------- header ----------
function renderHeader() {
  const s = state.site, links = s.contact.links || [];
  document.getElementById("name").textContent = s.name;
  document.getElementById("headline").textContent = s.headline;
  document.getElementById("intro").textContent = s.intro;
  const email = links.find((c) => c.kind === "email"), telegram = links.find((c) => c.kind === "telegram");
  document.getElementById("hero-actions").replaceChildren(
    email ? el("a", { class: "btn primary", href: email.url }, [icon("mail"), "Email me"]) : null,
    telegram ? el("a", { class: "btn", href: telegram.url, rel: "noopener" }, [icon("telegram"), "Message on Telegram"]) : null,
    s.open_to_work ? el("span", { class: "status", text: "Open to work" }) : null,
  );
  const areas = s.areas.filter((a) => state.projects.some((p) => p.area === a.id));
  document.getElementById("lede").textContent =
    `${state.projects.length} projects across ${areas.length} areas: LLM training and agents, subnet mining, ` +
    `computer vision, and the dApps and bots around them.`;
}

function renderConstellation() {
  const host = document.getElementById("constellation");
  const areas = state.site.areas.filter((a) => state.projects.some((p) => p.area === a.id));
  const W = Math.max(host.clientWidth, 300), wide = W > 720;
  const cols = wide ? areas.length : 2, rows = Math.ceil(areas.length / cols);
  const cellW = W / cols, cellH = wide ? 250 : 180, labelH = 30, minD = wide ? 30 : 22;
  const s = svg("svg", { viewBox: `0 0 ${W} ${rows * cellH}`, role: "img", "aria-label": `${state.projects.length} projects drawn as stars in ${areas.length} constellations, one per area` });
  const lines = svg("g"), stars = svg("g"), hits = svg("g"), labels = svg("g");
  const placed = [];

  areas.forEach((a, k) => {
    const col = k % cols, row = Math.floor(k / cols);
    const cx = col * cellW + cellW / 2, cy = row * cellH + (cellH - labelH) / 2 + 4;
    const rx = cellW * 0.36, ry = (cellH - labelH) * 0.4;
    const group = [];
    for (const p of state.projects.filter((q) => q.area === a.id)) {
      const rand = rng(hash(p.title));
      let x = cx, y = cy;
      for (let tries = 0; tries < 80; tries++) {
        const ang = rand() * Math.PI * 2, rad = Math.sqrt(rand());
        x = cx + Math.cos(ang) * rx * rad;
        y = cy + Math.sin(ang) * ry * rad;
        if (group.every((g) => Math.hypot(g.x - x, g.y - y) >= minD)) break;
      }
      group.push({ p, x, y, r: p.featured ? (wide ? 12 : 9) : (wide ? 6.5 : 5) });
    }
    // Constellation figure: a nearest-neighbour walk from the leftmost star.
    const left = [...group].sort((u, v) => u.x - v.x);
    const walk = [left.shift()];
    while (left.length) {
      const last = walk.at(-1);
      left.sort((u, v) => Math.hypot(u.x - last.x, u.y - last.y) - Math.hypot(v.x - last.x, v.y - last.y));
      walk.push(left.shift());
    }
    if (walk.length > 1) lines.append(svg("path", { d: "M" + walk.map((g) => `${g.x.toFixed(1)},${g.y.toFixed(1)}`).join("L"), class: "link-line", style: `--c:${k}` }));
    placed.push(...group);

    const label = svg("text", { x: cx, y: row * cellH + cellH - 8, "text-anchor": "middle", class: "cluster-label", tabindex: 0, role: "button", "aria-label": `Show ${a.label} projects` }, a.label);
    const pick = () => { setArea(a.id); document.getElementById("work-heading").closest("section").scrollIntoView({ block: "start" }); };
    label.addEventListener("click", pick);
    label.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    labels.append(label);
  });

  [...placed].sort((u, v) => u.x - v.x).forEach((g, i) => {
    const star = svg("path", { d: starPath(g.x, g.y, g.r), class: "star", style: `--i:${i}` });
    const hit = svg("circle", { cx: g.x, cy: g.y, r: Math.max(14, g.r + 6), class: "star-hit" });
    hit.addEventListener("pointermove", (e) => { star.classList.add("on"); showTip(e, g.p.title, areaLabel(g.p.area)); });
    hit.addEventListener("pointerleave", () => { star.classList.remove("on"); hideTip(); });
    hit.addEventListener("click", () => { hideTip(); goToProject(g.p); });
    stars.append(star);
    hits.append(hit);
  });
  s.append(lines, stars, labels, hits);
  host.replaceChildren(s);

  if (!state.lit) {
    state.lit = true;
    lines.querySelectorAll("path").forEach((l) => l.style.setProperty("--len", Math.ceil(l.getTotalLength())));
    host.classList.add("lighting");
  } else {
    host.classList.remove("lighting");
  }
}

// ---------- what I build ----------
function renderAreas() {
  const counts = state.site.areas.map((a) => ({ ...a, n: state.projects.filter((p) => p.area === a.id).length })).filter((a) => a.n);
  const max = Math.max(...counts.map((a) => a.n));
  document.getElementById("areas").replaceChildren(...counts.map((a) => {
    const row = el("button", { type: "button", class: "area-row", "aria-pressed": "false", "data-area": a.id }, [
      el("span", { class: "label", text: a.label }),
      el("span", { class: "bar-cell" }, [el("span", { class: "bar-fill", style: `width:${(100 * a.n) / max}%` })]),
      el("span", { class: "nums" }, [el("b", { text: String(a.n) }), a.n === 1 ? "project" : "projects"]),
    ]);
    row.addEventListener("click", () => setArea(state.area === a.id ? "all" : a.id));
    return row;
  }));
  document.getElementById("area-filter").replaceChildren(el("option", { value: "all", text: "All areas" }),
    ...counts.map((a) => el("option", { value: a.id, text: a.label })));
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
  if (!state.query) return true;
  const hay = [p.title, p.summary, areaLabel(p.area), ...p.tags].join(" ").toLowerCase();
  return state.query.split(/\s+/).every((w) => hay.includes(w));
}
function feature(p) {
  return el("article", { class: "feature", id: p.id, tabindex: "-1" }, [
    el("span", { class: "area-name", text: areaLabel(p.area) }),
    el("h4", { text: p.title }),
    el("p", { class: "summary", text: p.summary }),
    p.tags.length ? el("p", { class: "tags", text: p.tags.join(", ") }) : null,
  ]);
}
function entry(p) {
  return el("article", { class: "entry", id: p.id, tabindex: "-1" }, [
    el("h4", { text: p.title }),
    el("p", { class: "summary", text: p.summary }),
    p.tags.length ? el("p", { class: "tags", text: p.tags.join(", ") }) : null,
  ]);
}
function renderProjects() {
  const list = state.projects.filter(matches);
  const feat = list.filter((p) => p.featured), rest = list.filter((p) => !p.featured);
  document.getElementById("featured").replaceChildren(...feat.map(feature));
  document.getElementById("featured-block").hidden = !feat.length;
  const groups = state.site.areas.map((a) => ({ a, items: rest.filter((p) => p.area === a.id) })).filter((g) => g.items.length);
  document.getElementById("groups").replaceChildren(...groups.map(({ a, items }) => el("section", { class: "group" }, [
    el("div", { class: "group-head" }, [el("h4", { text: a.label }), el("span", { text: plural(items.length, "project") })]),
    el("div", { class: "entries" }, items.map(entry)),
  ])));
  document.getElementById("more-block").hidden = !rest.length;
  document.getElementById("empty").hidden = list.length > 0;
  document.getElementById("project-count").textContent =
    list.length === state.projects.length ? plural(list.length, "project") : `${list.length} of ${plural(state.projects.length, "project")}`;
}
function goToProject(p) {
  state.query = "";
  document.getElementById("search").value = "";
  setArea(p.area);
  const card = document.getElementById(p.id);
  if (!card) return;
  card.scrollIntoView({ block: "center" });
  card.focus({ preventScroll: true });
  card.classList.remove("flash");
  void card.offsetWidth;
  card.classList.add("flash");
}

// ---------- toolbox & contact ----------
function renderSkills() {
  document.getElementById("skills").replaceChildren(...state.site.skills.map((g) =>
    el("div", {}, [el("dt", { text: g.group }), el("dd", { text: g.items.join(", ") })])));
}
function renderContact() {
  const c = state.site.contact;
  document.getElementById("pitch").textContent = c.pitch;
  document.getElementById("channels").replaceChildren(...c.links.map((l) => el("li", {}, [
    el("span", { class: "label" }, [icon(l.kind === "email" ? "mail" : "telegram"), l.label]),
    el("a", { href: l.url, rel: l.kind === "email" ? null : "noopener" }, [l.value]),
  ])));
  document.getElementById("copyright").textContent = `© ${new Date().getFullYear()} ${state.site.name}`;
}

// ---------- wiring ----------
function initControls() {
  document.getElementById("area-filter").addEventListener("change", (e) => setArea(e.target.value));
  document.getElementById("search").addEventListener("input", (e) => { state.query = e.target.value.trim().toLowerCase(); renderProjects(); });
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
    timer = setTimeout(renderConstellation, 150);
  });
}

const load = (path) => fetch(path, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.json(); });
Promise.all([load("content/site.json"), load("content/projects.json")])
  .then(([site, projects]) => {
    state.site = site;
    state.projects = projects.map((p) => ({ ...p, id: slug(p.title) }));
    renderHeader();
    renderAreas();
    renderProjects();
    renderSkills();
    renderContact();
    initControls();
    const draw = () => renderConstellation();
    document.fonts && document.fonts.ready ? document.fonts.ready.then(draw) : draw();
  })
  .catch((err) => {
    document.getElementById("main").prepend(el("p", { class: "wrap empty", text: `The portfolio content did not load (${err.message}). Reload the page to try again.` }));
  });
