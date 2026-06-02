"""The spine: load the vendored infoplease roster (seed.json).

This is not an enricher — it is the canonical list every enricher decorates.
The orchestrator calls `load()` first; the result is the ordered set of rulers
(kings, Republic figures, emperors) exactly as the infoplease page presents
them. See ../build_seed.py for how seed.json is produced from the page.
"""

import json
from pathlib import Path

SEED_PATH = Path(__file__).resolve().parent.parent / "data" / "seed.json"


def load():
    raw = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    rulers = []
    for e in raw:
        r = dict(e)
        r["sources"] = {}
        rulers.append(r)
    return rulers
