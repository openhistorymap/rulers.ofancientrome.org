/* app.js — rulers.ofancientrome.org
 *
 * Loads data/manifest.json + data/rulers.json, renders the margin filters, the
 * proportional timeline ribbon, and the roster (period -> dynasty -> cards) in
 * the canonical infoplease order. Card click lazy-loads the full per-ruler
 * detail file into the drawer. Detail panel cross-links succession and opens
 * the avatar (chat.js). A porphyry handoff card closes the roster at 476,
 * pointing on to rulers.ofthepast.org.
 *
 * Relative paths only, so the custom domain and any /staging/ subpath work.
 */

const PERIODS = ["kingdom", "republic", "empire"];
const PERIOD_LABEL = { kingdom: "The Kingdom", republic: "The Republic", empire: "The Empire" };

const state = {
  manifest: null,
  rulers: [],
  byId: {},
  detailCache: {},
  activePeriods: new Set(PERIODS),
  query: "",
  current: null,
};

/* ---------- year helpers ---------- */
function fmtYear(y) {
  if (y === null || y === undefined) return null;
  return y < 0 ? `${-y} BC` : `AD ${y}`;
}
function fmtRange(a, b) {
  const fa = fmtYear(a), fb = fmtYear(b);
  if (fa && fb) return fa === fb ? fa : `${fa} – ${fb}`;
  return fa || fb || "—";
}
function rulerYears(r) {
  // empire/kingdom -> reign; else lifespan; fall back to display_*
  if (r.period === "empire" && (r.reign_from || r.reign_to)) return "r. " + fmtRange(r.reign_from, r.reign_to);
  if (r.period === "kingdom" && (r.reign_from || r.reign_to)) return "r. " + fmtRange(r.reign_from, r.reign_to);
  if (r.birth_year || r.death_year) return fmtRange(r.birth_year, r.death_year);
  return fmtRange(r.display_from, r.display_to);
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function slugDyn(period, dyn) {
  return "g-" + period + "-" + (dyn || "all").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/* ---------- boot ---------- */
async function boot() {
  try {
    const [manifest, rulers] = await Promise.all([
      fetch("data/manifest.json").then((r) => r.json()),
      fetch("data/rulers.json").then((r) => r.json()),
    ]);
    state.manifest = manifest;
    state.rulers = rulers.slice().sort((a, b) => a.order - b.order);
    state.rulers.forEach((r) => (state.byId[r.id] = r));
  } catch (e) {
    document.getElementById("roster").innerHTML =
      '<p class="empty-note">The roster could not be loaded. Run the harvester to generate <code>data/</code>.</p>';
    return;
  }
  renderLede();
  renderPeriodFilters();
  renderDynastyNav();
  renderRibbon();
  renderRoster();
  wireChrome();
}

function renderLede() {
  const m = state.manifest;
  const lede = document.getElementById("m-lede");
  lede.innerHTML =
    `<strong>${m.totals.rulers}</strong> rulers, from the founding kings to the fall of the West in ` +
    `<strong>AD ${m.handoff.year}</strong> — each with a life drawn from Wikipedia and the record of Wikidata.`;
}

function periodCounts() {
  const c = { kingdom: 0, republic: 0, empire: 0 };
  state.rulers.forEach((r) => (c[r.period] = (c[r.period] || 0) + 1));
  return c;
}

function renderPeriodFilters() {
  const wrap = document.getElementById("period-list");
  const counts = periodCounts();
  wrap.innerHTML = "";
  PERIODS.forEach((p) => {
    const row = el("div", "period-row");
    row.dataset.period = p;
    row.innerHTML =
      `<span class="period-swatch"></span>` +
      `<span class="period-name">${PERIOD_LABEL[p]}</span>` +
      `<span class="period-count">${counts[p] || 0}</span>`;
    row.addEventListener("click", () => {
      if (state.activePeriods.has(p) && state.activePeriods.size === PERIODS.length) {
        // first click on an "all on" state -> solo this period
        state.activePeriods = new Set([p]);
      } else if (state.activePeriods.has(p)) {
        state.activePeriods.delete(p);
        if (state.activePeriods.size === 0) state.activePeriods = new Set(PERIODS);
      } else {
        state.activePeriods.add(p);
      }
      syncFilters();
    });
    wrap.appendChild(row);
  });
  document.getElementById("period-all").addEventListener("click", () => {
    state.activePeriods = new Set(PERIODS);
    syncFilters();
  });
}

function syncFilters() {
  document.querySelectorAll(".period-row").forEach((row) => {
    row.classList.toggle("is-off", !state.activePeriods.has(row.dataset.period));
  });
  document.querySelectorAll(".ribbon-band").forEach((b) => {
    b.classList.toggle("is-dim", !state.activePeriods.has(b.dataset.period));
  });
  renderRoster();
  renderDynastyNav();
}

/* dynasty nav, grouped by period in roster order */
function dynastyGroups() {
  const groups = [];
  const seen = new Map();
  state.rulers.forEach((r) => {
    const key = r.period + "|" + (r.dynasty || "");
    if (!seen.has(key)) {
      const g = { period: r.period, dynasty: r.dynasty, items: [] };
      seen.set(key, g);
      groups.push(g);
    }
    seen.get(key).items.push(r);
  });
  return groups;
}

function renderDynastyNav() {
  const nav = document.getElementById("dyn-list");
  nav.innerHTML = "";
  dynastyGroups()
    .filter((g) => state.activePeriods.has(g.period))
    .forEach((g) => {
      const name = g.dynasty ? g.dynasty.replace(/^The /, "") : PERIOD_LABEL[g.period];
      const link = el("a", "dyn-link");
      link.innerHTML = `<span>${name}</span><span class="dl-count">${g.items.length}</span>`;
      link.addEventListener("click", () => {
        const target = document.getElementById(slugDyn(g.period, g.dynasty));
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      nav.appendChild(link);
    });
}

/* proportional period bands across the full span */
function renderRibbon() {
  const track = document.getElementById("ribbon-track");
  const b = state.manifest.bounds;
  const min = b.min_year, max = b.max_year, span = max - min || 1;
  // period extents from the data
  const ext = {};
  state.rulers.forEach((r) => {
    const lo = r.display_from, hi = r.display_to;
    if (lo == null && hi == null) return;
    const e = (ext[r.period] = ext[r.period] || { lo: Infinity, hi: -Infinity });
    [lo, hi].forEach((y) => { if (y != null) { e.lo = Math.min(e.lo, y); e.hi = Math.max(e.hi, y); } });
  });
  track.innerHTML = "";
  PERIODS.forEach((p) => {
    const e = ext[p];
    if (!e) return;
    const w = ((e.hi - e.lo) / span) * 100;
    const band = el("div", "ribbon-band");
    band.dataset.period = p;
    band.style.flexBasis = Math.max(w, 6) + "%";
    band.style.flexGrow = w;
    band.title = `${PERIOD_LABEL[p]} · ${fmtRange(e.lo, e.hi)}`;
    band.textContent = PERIOD_LABEL[p].replace("The ", "");
    band.addEventListener("click", () => {
      state.activePeriods = new Set([p]);
      syncFilters();
      const first = document.querySelector(`.period-group[data-period="${p}"]`);
      if (first) first.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    track.appendChild(band);
  });
}

/* ---------- roster ---------- */
function matchQuery(r) {
  if (!state.query) return true;
  const hay = (r.name + " " + (r.dynasty || "") + " " + (r.wp_description || "") + " " + (r.blurb || "")).toLowerCase();
  return hay.includes(state.query);
}

function cardEl(r) {
  const card = el("button", "card");
  card.type = "button";
  card.dataset.id = r.id;
  const img = r.thumbnail;
  const portrait = el("div", "card-portrait" + (img ? "" : " no-img"));
  if (img) portrait.style.setProperty("--bust", `url("${img}")`);
  else portrait.textContent = r.name[0] || "·";
  if (r.chat_ready) {
    const badge = el("span", "card-chat");
    badge.title = "Speak with them";
    badge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z" fill="currentColor"/></svg>';
    portrait.appendChild(badge);
  }
  card.appendChild(portrait);
  card.appendChild(el("div", "card-accent"));
  const body = el("div", "card-body");
  body.appendChild(el("div", "card-name", r.name));
  body.appendChild(el("div", "card-years", rulerYears(r)));
  if (r.wp_description) body.appendChild(el("div", "card-gloss", r.wp_description));
  else if (r.blurb) body.appendChild(el("div", "card-gloss", r.blurb));
  card.appendChild(body);
  card.addEventListener("click", () => openDetail(r.id));
  return card;
}

function renderRoster() {
  const root = document.getElementById("roster");
  root.innerHTML = "";
  let shown = 0;

  PERIODS.filter((p) => state.activePeriods.has(p)).forEach((period) => {
    const inPeriod = state.rulers.filter((r) => r.period === period && matchQuery(r));
    if (!inPeriod.length) return;
    const pg = el("div", "period-group");
    pg.dataset.period = period;
    pg.id = "period-" + period;
    const span = (() => {
      const ys = inPeriod.flatMap((r) => [r.display_from, r.display_to]).filter((y) => y != null);
      return ys.length ? fmtRange(Math.min(...ys), Math.max(...ys)) : "";
    })();
    pg.appendChild(el("div", "period-banner",
      `<h2>${PERIOD_LABEL[period]}</h2><span class="pb-meta">${inPeriod.length} rulers · ${span}</span>`));

    // group by dynasty preserving order
    const order = [];
    const map = new Map();
    inPeriod.forEach((r) => {
      const key = r.dynasty || "";
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key).push(r);
    });
    order.forEach((dyn) => {
      const dg = el("div", "dyn-group");
      dg.id = slugDyn(period, dyn);
      if (dyn) dg.appendChild(el("div", "dyn-head", `<h3>${dyn.replace(/^The /, "")}</h3><span class="dh-line"></span>`));
      const cards = el("div", "cards");
      map.get(dyn).forEach((r) => { cards.appendChild(cardEl(r)); shown++; });
      dg.appendChild(cards);
      pg.appendChild(dg);
    });
    root.appendChild(pg);
  });

  if (!shown) {
    root.appendChild(el("p", "empty-note", state.query
      ? `No ruler matches “${state.query}”.`
      : "No rulers in the selected periods."));
  }

  // handoff card only when the empire (and its end) is in view and unfiltered
  if (state.activePeriods.has("empire") && !state.query) root.appendChild(handoffEl());
}

function handoffEl() {
  const h = state.manifest.handoff;
  const card = el("div", "handoff");
  card.innerHTML =
    `<h2>The Western Empire falls — AD ${h.year}</h2>` +
    `<p>${h.note}</p>` +
    `<a class="handoff-cta" href="${h.url}" target="_blank" rel="noopener">` +
    `Continue with ${h.label} <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`;
  return card;
}

/* ---------- detail drawer ---------- */
async function getDetail(id) {
  if (state.detailCache[id]) return state.detailCache[id];
  const d = await fetch(`data/rulers/${id}.json`).then((r) => r.json());
  state.detailCache[id] = d;
  return d;
}

async function openDetail(id) {
  const r = await getDetail(id);
  state.current = r;
  const body = document.getElementById("detail-body");
  body.innerHTML = renderDetail(r);
  wireDetail(r);
  const drawer = document.getElementById("detail");
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  const scrim = document.getElementById("scrim");
  scrim.hidden = false;
  requestAnimationFrame(() => scrim.classList.add("show"));
  document.getElementById("detail").scrollTop = 0;
  history.replaceState(null, "", "#" + id);
}

function closeDetail() {
  const drawer = document.getElementById("detail");
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  const scrim = document.getElementById("scrim");
  scrim.classList.remove("show");
  setTimeout(() => (scrim.hidden = true), 220);
  state.current = null;
  history.replaceState(null, "", "#");
}

function esc(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function bioParas(extract) {
  return esc(extract).split(/\n+/).filter(Boolean).map((p) => `<p>${p}</p>`).join("");
}

function renderDetail(r) {
  const img = r.image || r.thumbnail;
  const aka = r.wd_label && r.wd_label !== r.name ? `<p class="d-aka">also known as ${esc(r.wd_label)}</p>` : "";
  const hero = img
    ? `<img class="d-portrait" src="${img}" alt="${esc(r.name)}" loading="lazy"/>`
    : `<div class="d-portrait no-img">${esc(r.name[0] || "·")}</div>`;

  // facts
  const facts = [];
  const life = fmtRange(r.birth_year, r.death_year);
  if (life !== "—") facts.push(["Lived", life]);
  if (r.reign_from || r.reign_to) facts.push(["Reigned", fmtRange(r.reign_from, r.reign_to)]);
  if (r.dynasty) facts.push(["House", esc(r.dynasty.replace(/^The /, ""))]);
  if (r.birthplace) facts.push(["Born at", esc(r.birthplace)]);
  if (r.deathplace) facts.push(["Died at", esc(r.deathplace)]);
  const fam = [r.father, r.mother].filter(Boolean).map(esc).join(" &amp; ");
  if (fam) facts.push(["Parents", fam]);
  if (r.children && r.children.length) facts.push(["Children", r.children.slice(0, 8).map(esc).join(", ")]);
  const factsHtml = facts.length
    ? `<dl class="d-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`
    : "";

  // titles
  const titles = (r.positions || []).filter(Boolean);
  const titlesHtml = titles.length
    ? `<div class="d-section"><h3 class="m-subtitle" style="margin-bottom:10px">Titles &amp; offices</h3>
       <div class="d-titles">${titles.slice(0, 16).map((t) => `<span class="d-chip">${esc(t)}</span>`).join("")}</div></div>`
    : "";

  // succession — prefer wikidata links, else roster neighbours
  const idx = state.rulers.findIndex((x) => x.id === r.id);
  const prevR = r.predecessor_id ? state.byId[r.predecessor_id] : state.rulers[idx - 1];
  const nextR = r.successor_id ? state.byId[r.successor_id] : state.rulers[idx + 1];
  const prevName = r.predecessor || (prevR && prevR.name);
  const nextName = r.successor || (nextR && nextR.name);
  const succ =
    `<div class="d-section"><div class="succession">` +
    succBtn("prev", "Preceded by", prevName, prevR && prevR.id) +
    succBtn("next", "Succeeded by", nextName, nextR && nextR.id) +
    `</div></div>`;

  // links
  const links = [];
  if (r.wikipedia_url) links.push(linkBtn(r.wikipedia_url, "Wikipedia"));
  if (r.wikidata_url) links.push(linkBtn(r.wikidata_url, "Wikidata"));
  if (r.infoplease_href) links.push(linkBtn(r.infoplease_href, "infoplease"));
  const linksHtml = `<div class="d-section"><div class="d-actions">${links.join("")}</div>
    <p class="d-source-note">Biography &amp; portrait via Wikipedia / Wikimedia Commons; dates &amp; relations via Wikidata. Roster from infoplease.</p></div>`;

  const speak = r.chat_ready
    ? `<div class="d-section"><button class="speak-btn" id="speak-btn">
         <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/></svg>
         Speak with ${esc(r.name)}</button></div>`
    : "";

  const bio = r.extract
    ? `<div class="d-section"><div class="d-bio">${bioParas(r.extract)}</div></div>`
    : (r.blurb ? `<div class="d-section"><div class="d-bio"><p>${esc(r.blurb)}.</p></div></div>` : "");

  return (
    `<div class="d-hero">${hero}<div class="d-hero-grad"></div></div>` +
    `<div class="d-titleblock">` +
    `<span class="d-eyebrow" data-period="${r.period}">${esc(r.period_label || "")}</span>` +
    `<h1 class="d-name">${esc(r.name)}</h1>${aka}` +
    `<p class="d-dates">${esc(r.wp_description || rulerYears(r))}</p>` +
    `</div>` +
    (factsHtml ? `<div class="d-section">${factsHtml}</div>` : "") +
    speak +
    bio +
    succ +
    titlesHtml +
    linksHtml
  );
}

function succBtn(dir, label, name, id) {
  if (!name) return `<button class="succ-btn ${dir}" disabled><span class="sb-dir">${label}</span><span class="sb-name">—</span></button>`;
  return `<button class="succ-btn ${dir}" data-goto="${id || ""}"><span class="sb-dir">${label}</span><span class="sb-name">${esc(name)}</span></button>`;
}
function linkBtn(href, label) {
  return `<a class="d-link" href="${href}" target="_blank" rel="noopener">${label}
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 L17 7 M9 7h8v8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`;
}

function wireDetail(r) {
  const sb = document.getElementById("speak-btn");
  if (sb) sb.addEventListener("click", () => window.RoarChat.open(r));
  document.querySelectorAll(".succ-btn[data-goto]").forEach((b) => {
    const id = b.dataset.goto;
    if (id) b.addEventListener("click", () => openDetail(id));
  });
}

/* ---------- chrome ---------- */
function wireChrome() {
  document.getElementById("detail-close").addEventListener("click", closeDetail);
  document.getElementById("scrim").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.current) closeDetail();
  });

  const search = document.getElementById("search");
  let t;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.query = search.value.trim().toLowerCase();
      renderRoster();
    }, 120);
  });

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("roar-theme", next); } catch (e) {}
  });

  // deep link
  const hash = location.hash.replace(/^#/, "");
  if (hash && state.byId[hash]) openDetail(hash);
}

boot();
