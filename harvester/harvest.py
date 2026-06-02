"""Orchestrator for rulers.ofancientrome.org.

Loads the spine (the infoplease roster, seed.json), runs each enricher in
`sources.REGISTRY` in isolation (a failing enricher is marked `stale`; the
spine and the other enrichers survive), derives timeline years, then writes:

  - data/rulers.json        compact index for the gallery + timeline
  - data/rulers/<id>.json   full per-ruler detail (bio, relations, links)
  - data/manifest.json      generated_at, totals, per-source status, bounds,
                            and the handoff to rulers.ofthepast.org

Scope ends at the fall of the Western Empire (476). Everyone after that lives
on the sibling site rulers.ofthepast.org — the manifest records the handoff so
the frontend can show the "continue with the rulers of the past" card.

Environment:
  ROAR_DISABLE=wikipedia     skip these enrichers (comma-separated)
"""

import datetime
import json
import os
import sys
import time
import traceback
from pathlib import Path

from . import sources
from .sources import seed

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RULER_DIR = DATA_DIR / "rulers"

HANDOFF = {
    "year": 476,
    "site": "rulers.ofthepast.org",
    "url": "https://rulers.ofthepast.org",
    "label": "The rulers of the past",
    "note": "When Rome falls in 476, the story continues — the same system, "
            "carried forward through the centuries that follow.",
}

# Fields promoted into the compact index (data/rulers.json). Everything else
# stays in the per-ruler detail file.
INDEX_FIELDS = [
    "id", "order", "name", "period", "period_label", "dynasty",
    "wp_description", "blurb", "thumbnail",
    "display_from", "display_to", "reign_from", "reign_to",
    "birth_year", "death_year", "chat_ready",
]


def _disabled():
    raw = os.environ.get("ROAR_DISABLE", "").strip()
    return {s.strip() for s in raw.split(",") if s.strip()}


def _pick(*vals):
    for v in vals:
        if v is not None:
            return v
    return None


def _derive_timeline(r):
    """Best (display_from, display_to) signed years for placing a ruler on the
    timeline. Reign for monarchs, lifespan for Republic figures, seed dates as
    fallback."""
    if r.get("period") in ("empire", "kingdom"):
        df = _pick(r.get("reign_from"), r.get("year_from"), r.get("birth_year"))
        dt = _pick(r.get("reign_to"), r.get("year_to"), r.get("death_year"))
    else:
        df = _pick(r.get("birth_year"), r.get("year_from"))
        dt = _pick(r.get("death_year"), r.get("year_to"))
    r["display_from"] = df
    r["display_to"] = dt


def _write_json(path, obj, pretty=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        if pretty:
            json.dump(obj, fh, ensure_ascii=False, indent=2)
        else:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    rulers = seed.load()
    print(f"rulers.ofancientrome.org harvest · spine: {len(rulers)} rulers", flush=True)

    disabled = _disabled()
    enabled = [s for s in sources.REGISTRY if s.name not in disabled]
    ctx = {}
    source_status = {}
    started = datetime.datetime.now(datetime.timezone.utc)

    for src in enabled:
        print(f"\n[{src.name}] {src.title}", flush=True)
        t0 = time.monotonic()
        try:
            status = src.run(rulers, ctx)
        except Exception as e:
            elapsed = time.monotonic() - t0
            print(f"  !! failed after {elapsed:.1f}s: {e!r}", flush=True)
            traceback.print_exc()
            source_status[src.name] = {"status": "stale", "error": repr(e)}
            continue
        elapsed = time.monotonic() - t0
        status = {**status, "elapsed_seconds": round(elapsed, 1)}
        source_status[src.name] = status
        print(f"  -> {status}", flush=True)
        time.sleep(1)

    for src in sources.REGISTRY:
        if src.name not in source_status:
            source_status[src.name] = {"status": "disabled"}

    # derive timeline years + clean per-ruler detail
    for r in rulers:
        _derive_timeline(r)

    # write per-ruler detail files + compact index. Clear stale detail files
    # first so a renamed/removed ruler id never leaves an orphan behind.
    RULER_DIR.mkdir(parents=True, exist_ok=True)
    current_ids = {r["id"] for r in rulers}
    for f in RULER_DIR.glob("*.json"):
        if f.stem not in current_ids:
            f.unlink()
    index = []
    for r in rulers:
        _write_json(RULER_DIR / f"{r['id']}.json", r)
        index.append({k: r.get(k) for k in INDEX_FIELDS})
    _write_json(DATA_DIR / "rulers.json", index)

    # bounds for the timeline scale
    years = [y for r in rulers for y in (r.get("display_from"), r.get("display_to")) if y is not None]
    bounds = {"min_year": min(years), "max_year": max(years)} if years else {}

    period_counts = {}
    for r in rulers:
        period_counts[r["period"]] = period_counts.get(r["period"], 0) + 1

    finished = datetime.datetime.now(datetime.timezone.utc)
    manifest = {
        "generated_at": finished.isoformat(timespec="seconds"),
        "title": "Rulers of Ancient Rome",
        "totals": {
            "rulers": len(rulers),
            "with_image": sum(1 for r in rulers if r.get("thumbnail") or r.get("image")),
            "with_extract": sum(1 for r in rulers if r.get("extract")),
            "chat_ready": sum(1 for r in rulers if r.get("chat_ready")),
        },
        "periods": period_counts,
        "bounds": bounds,
        "handoff": HANDOFF,
        "sources": source_status,
    }
    _write_json(DATA_DIR / "manifest.json", manifest, pretty=True)

    elapsed = (finished - started).total_seconds()
    print(f"\ndone in {elapsed:.0f}s. totals: {manifest['totals']}", flush=True)
    stale = [n for n, s in source_status.items() if s.get("status") == "stale"]
    if stale:
        print(f"  stale sources: {stale}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
