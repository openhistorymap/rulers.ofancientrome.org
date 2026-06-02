# rulers.ofancientrome.org

A portrait gallery of the rulers of Rome — every king, Republican strongman, and
emperor from Romulus to the fall of the Western Empire in **AD 476** — built on
Wikipedia + Wikidata, and (soon) able to let you **speak with an avatar** of
those whose lives are recorded fully enough to ground one.

Sibling, in machinery, to the OHM map atlases (`map.ofww1.org`): same
*harvester → static-data → GitHub-Pages* shape. But this is **not a map** — the
hero is the face and the line of succession, not a basemap.

## Scope (decided up front)

- **Roster = the infoplease list, mirrored exactly** ("Roman Republic and Roman
  Empire Rulers"), in its original order and grouping (Kingdom → Republic →
  Empire-by-dynasty), enriched from Wikidata + Wikipedia. 112 figures.
- **Ends at 476.** After the last Western/Eastern emperors of the 470s, the
  roster hands off to the sibling site **`rulers.ofthepast.org`** — same system,
  carried forward through the centuries after Rome. The handoff is data
  (`manifest.handoff`), rendered as the porphyry card at the end of the roster.
- **Avatar chat is served by the shared API.** `web/chat.js` POSTs to
  `chat.people.ofthepast.org` (repo `openfantasymap/avatars`), the one chat
  service behind all the ruler galleries — it fetches this site's published
  per-ruler JSON, grounds the persona, and answers via an OpenAI-compatible
  model. If that backend is unreachable the avatar stays in character with a
  holding reply. It must never fabricate history.

## Layout

```
harvester/        Python pipeline (no map deps). `python -m harvester`.
  build_seed.py   one-off: infoplease roster (raw parse) -> data/seed.json
  data/
    infoplease_roster.json   DOM-faithful parse of the source page (input)
    seed.json                the canonical spine the harvester reads
  wikidata.py     wbgetentities + SPARQL client (+ claim helpers)
  wikipedia.py    MediaWiki API: title->QID resolve, lead extracts + images
  sources/
    base.py       the Enricher contract
    seed.py       loads the spine (not an enricher)
    wikidata_enrich.py   dates, reign, image, family, succession, birthplace
    wikipedia_enrich.py  lead biography + image + chat-readiness
  harvest.py      orchestrator -> data/
web/              static frontend (no build step, relative paths only)
  index.html  style.css  app.js  chat.js  (chat.js calls the shared avatars API)
data/             GENERATED, machine-owned. Committed; published by Deploy.
  rulers.json            compact index for the gallery + ribbon
  rulers/<id>.json       full per-ruler detail (bio, relations, links)
  manifest.json          totals, period counts, bounds, handoff, source status
.github/workflows/  harvest.yml + deploy.yml (two independent manual workflows)
CNAME             rulers.ofancientrome.org
```

## The harvester

Spine-then-enrich, not merge-of-sources. The orchestrator loads the **spine**
(`seed.json`, the infoplease roster) and runs each **Enricher** in
`sources.REGISTRY` over the shared ruler list, in isolation: a failing enricher
is marked `stale` in the manifest and the spine + other enrichers survive.

- **Resolution path**: each seed entry carries a curated en.wikipedia title
  (`wp`). `wikipedia.resolve()` maps it to a Wikidata QID; `wikidata.entities()`
  pulls the facts; `wikipedia.extracts()` pulls the biography. All batched.
- **Succession** for emperors lives in the *qualifiers* of the "Roman emperor"
  position (P1365/P1366), not at entity level — `wikidata.reign_succession()`
  reads it there, and the enricher cross-links predecessor/successor to our own
  roster ids.
- Run it: `python -m harvester` (≈ 60 s, ~20 batched API calls). Disable an
  enricher with `ROAR_DISABLE=wikipedia`. Re-run `build_seed.py` only if the
  curated roster itself changes.

Editing the roster = edit the `WP_TITLE` map / disambiguations in
`build_seed.py`, re-run it, then re-harvest. The harvester never touches the
(Cloudflare-walled) infoplease page — `seed.json` is vendored.

## Frontend

Plain HTML/CSS/JS, **no build step**, **relative paths only** (custom domain +
any `/staging/` subpath both work). Loads `data/manifest.json` + `data/rulers.json`,
lazy-loads `data/rulers/<id>.json` on card click. Timeline ribbon is
proportional period bands (navigation, not a data viz). Theme persists in
localStorage. Design is **lapidary epigraphic** — the page as an inscription cut
in travertine: square edges, busts in arched niches with Roman-numeral catalogue
marks, carved lintels, gold hairlines, OKLCH stone palette. Marcellus SC + Cardo;
period pigments kingdom/republic/empire = bronze/red-ochre/porphyry (pigment in
rules & tags, never a border stripe). Full design context in `.impeccable.md`.

The avatar (`chat.js`) greets in-character and shows a live "how this avatar is
grounded" preview built from the harvested facts; sending a message POSTs to the
shared avatars API (`chat.people.ofthepast.org`), which rebuilds the same
grounding from this site's published JSON and answers. If the backend is
unreachable the reply is a self-aware holding message — never invented history.

## Deploy

**GitHub Pages**, custom domain via `CNAME`. Two independent manual workflows
(same discipline as the map siblings):

- **Harvest** — re-pull `data/` from Wikidata/Wikipedia, commit to `main`.
  Does *not* publish.
- **Deploy** — stage `web/` + `data/` + `CNAME` → Pages (`actions/deploy-pages`).
  Does *not* harvest. Pages source = "GitHub Actions".

Typical: *frontend change → push → Deploy*; *data refresh → Harvest → eyeball
the manifest → Deploy*.

## House rules

- `data/` is machine-owned harvester output — never hand-edit it.
- No hard-coded credentials. This repo holds no chat key — the model key lives
  only in the shared avatars service (`openfantasymap/avatars`).
- No tests. Don't claim a change is "tested" because nothing broke at import.
- Portraits/biographies are hot-linked from Wikimedia/Wikipedia; keep the credit
  line in the detail panel and footer.
- Host runtime is old — run one-off tooling under Docker if the host Python
  chokes (`docker run --rm -v "$PWD":/w -w /w python:3-slim …`).
