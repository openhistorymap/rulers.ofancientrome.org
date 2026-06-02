"""Build the vendored seed roster for rulers.ofancientrome.org.

The seed is the *canonical list* — it mirrors the infoplease roster
("Roman Republic and Roman Empire Rulers") exactly, in its original order and
grouping (Kingdom / Republic / Empire-by-dynasty). It is the spine the
harvester enriches from Wikidata + Wikipedia.

Input:  harvester/data/infoplease_roster.json  (a DOM-faithful parse of the
        infoplease page: one record per <li> with period, dynasty, raw text,
        and the infoplease href).
Output: harvester/data/seed.json  (cleaned name, display epithet, blurb,
        raw + parsed dates, infoplease href, and a curated en.wikipedia title
        used to resolve the entity on Wikidata).

This script is reproducible documentation of how seed.json was produced — the
harvester itself only reads seed.json, never this file or the raw HTML, so CI
has no dependency on the (Cloudflare-walled) infoplease page.

Run:  python -m harvester.build_seed     (or: python harvester/build_seed.py)
"""

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"

# --- Curated en.wikipedia titles, keyed by the cleaned display name ----------
# These resolve each roster entry to the right Wikipedia article (and thence to
# its Wikidata QID). Most are identity; the ones that matter are the
# disambiguations where the infoplease short-name is ambiguous or archaic.
WP_TITLE = {
    # Kingdom
    "Romulus": "Romulus",
    "Numa Pompilius": "Numa Pompilius",
    "Tullus Hostilius": "Tullus Hostilius",
    "Ancus Marcius": "Ancus Marcius",
    "Tarquin the Elder": "Lucius Tarquinius Priscus",
    "Servius Tullius": "Servius Tullius",
    "Tarquin the Proud": "Lucius Tarquinius Superbus",
    # Republic
    "Lucius Junius Brutus": "Lucius Junius Brutus",
    "Scipio Africanus": "Scipio Africanus",
    "Cato the Elder": "Cato the Elder",
    "Gracchi": "Gracchi",
    "Gaius Marius": "Gaius Marius",
    "Lucius Cornelius Sulla": "Sulla",
    "Pompey": "Pompey",
    "Marcus Licinius Crassus": "Marcus Licinius Crassus",
    "Marcus Tullius Cicero": "Cicero",
    "Julius Caesar": "Julius Caesar",
    "Cato the Younger": "Cato the Younger",
    "Marcus Junius Brutus": "Marcus Junius Brutus",
    "Caius Cassius Longinus": "Gaius Cassius Longinus",
    "Mark Antony": "Mark Antony",
    "Marcus Agrippa": "Marcus Vipsanius Agrippa",
    "Lepidus": "Marcus Aemilius Lepidus (triumvir)",
    # Julio-Claudian
    "Augustus": "Augustus",
    "Tiberius": "Tiberius",
    "Caligula": "Caligula",
    "Claudius": "Claudius",
    "Nero": "Nero",
    # Year of the Four Emperors
    "Galba": "Galba",
    "Otho": "Otho",
    "Vitellius": "Vitellius",
    # Flavian
    "Vespasian": "Vespasian",
    "Titus": "Titus",
    "Domitian": "Domitian",
    # Nerva-Antonine
    "Nerva": "Nerva",
    "Trajan": "Trajan",
    "Hadrian": "Hadrian",
    "Antoninus Pius": "Antoninus Pius",
    "Marcus Aurelius": "Marcus Aurelius",
    "Lucius Verus": "Lucius Verus",
    "Commodus": "Commodus",
    "Pertinax": "Pertinax",
    "Didius Julianus": "Didius Julianus",
    # Severan
    "Septimius Severus": "Septimius Severus",
    "Caracalla": "Caracalla",
    "Geta": "Geta (emperor)",
    "Macrinus": "Macrinus",
    "Heliogabalus or Elagabalus": "Elagabalus",
    "Alexander Severus": "Severus Alexander",
    # Gordian
    "Gordian I": "Gordian I",
    "Gordian II": "Gordian II",
    "Balbinus": "Balbinus",
    "Pupienus Maximus": "Pupienus",
    "Gordian III": "Gordian III",
    "Philip (the Arabian)": "Philip the Arab",
    # Decian
    "Decius": "Decius",
    "Hostilianus": "Hostilian",
    "Gallus": "Trebonianus Gallus",
    "Aemilianus": "Aemilianus",
    # Valerian
    "Valerian": "Valerian (emperor)",
    "Gallienus": "Gallienus",
    "Claudius II": "Claudius Gothicus",
    "Aurelian": "Aurelian",
    "Tacitus": "Tacitus (emperor)",
    "Florianus": "Florianus",
    "Probus": "Probus (emperor)",
    # Caran
    "Carus": "Carus",
    "Carinus": "Carinus",
    "Numerianus": "Numerian",
    "Diocletian": "Diocletian",
    "Maximian": "Maximian",
    # Constantinian
    "Constantius I": "Constantius Chlorus",
    "Galerius": "Galerius",
    "Licinius": "Licinius",
    "Maxentius": "Maxentius",
    "Constantine I (the Great)": "Constantine the Great",
    "Constantine II": "Constantine II (emperor)",
    "Constans": "Constans",
    "Constantius II": "Constantius II",
    "Magnentius": "Magnentius",
    "Julian (the Apostate)": "Julian (emperor)",
    "Jovian": "Jovian (emperor)",
    # Valentinian
    "Valentinian I": "Valentinian I",
    "Valens": "Valens",
    "Gratian": "Gratian",
    "Valentinian II": "Valentinian II",
    "Eugenius": "Eugenius",
    # Theodosian
    "Theodosius I (the Great)": "Theodosius I",
    "Honorius": "Honorius (emperor)",
    "Constantius III": "Constantius III",
    "Valentinian III": "Valentinian III",
    "Arcadius": "Arcadius",
    "Theodosius II": "Theodosius II",
    "Marcian": "Marcian",
    # Emperors in the West
    "Petronius Maximus": "Petronius Maximus",
    "Avitus": "Avitus",
    "Majorian": "Majorian",
    "Libius Severus": "Libius Severus",
    "Anthemius": "Anthemius",
    "Olybrius": "Olybrius",
    "Glycerius": "Glycerius",
    "Julius Nepos": "Julius Nepos",
    "Romulus Augustulus": "Romulus Augustulus",
    # Emperors in the East
    "Leo I": "Leo I the Thracian",
    "Leo II": "Leo II (emperor)",
    "Zeno": "Zeno (emperor)",
    "Basilicus": "Basiliscus",
}

# Disambiguations that cannot key on name alone (duplicate short-names). Keyed
# on the infoplease parse `order` index, which is stable for a given snapshot.
WP_TITLE_BY_ORDER = {}  # filled in below once we know the orders


def clean_name(text):
    """Display name = text up to the first comma, minus any trailing
    date-parenthetical (one containing a digit / 'B.C.' / 'd.'). Epithet
    parentheses with no digits (e.g. '(the Great)') are kept."""
    head = text.split(",", 1)[0].strip()
    # strip a trailing parenthetical only if it looks like dates, not an epithet
    m = re.search(r"\(([^()]*)\)\s*$", head)
    if m and re.search(r"\d|B\.?C\.?|A\.?D\.?|d\.", m.group(1)):
        head = head[: m.start()].strip()
    return head


YEAR = r"(c\.?\s*)?(\d{1,4})\s*\??"


def _era_apply(num, is_bc):
    return -num if is_bc else num


def parse_dates(text):
    """Best-effort (year_from, year_to) from the trailing parenthetical.
    Negative = BC. Returns (from, to, raw). Wikidata is authoritative and will
    override these where it has data; this is only a fallback for placement."""
    parens = re.findall(r"\(([^()]*\d[^()]*)\)", text)
    if not parens:
        return None, None, None
    raw = parens[-1].strip()
    s = raw.replace("–", "-").replace("—", "-")
    bc_anywhere = bool(re.search(r"B\.?C\.?", s, re.I))
    ad_right = bool(re.search(r"A\.?D\.?", s))

    # death-only: "d. 53 B.C."
    md = re.match(r"\s*d\.\s*" + YEAR, s, re.I)
    if md and "-" not in s:
        y = int(md.group(2))
        return None, _era_apply(y, bc_anywhere), raw

    nums = re.findall(r"(\d{1,4})", s)
    if not nums:
        return None, None, raw
    if "-" in s and len(nums) >= 2:
        a, b = int(nums[0]), int(nums[1])
        # era handling: "27 B.C.-A.D. 14" spans; "236-183 B.C." both BC; "14-37" AD
        left_bc = bc_anywhere and not ad_right
        right_bc = bc_anywhere and not ad_right
        if bc_anywhere and ad_right:
            left_bc, right_bc = True, False
        yf = _era_apply(a, left_bc)
        yt = _era_apply(b, right_bc)
        # repair 2-digit tail of a range: "217-18" -> 218, "249-2251" left as-is
        if not bc_anywhere and 0 < b < 100 and a >= 100 and b < (a % 100 or 100):
            yt = (a // 100) * 100 + b
        if not bc_anywhere and 0 < b < 100 and a >= 100 and b >= (a % 100):
            yt = (a // 100) * 100 + b
        return yf, yt, raw
    y = int(nums[0])
    return _era_apply(y, bc_anywhere), _era_apply(y, bc_anywhere), raw


def blurb_of(text, name):
    """Everything after the name as an editorial note (infoplease's own gloss),
    with the trailing date-parenthetical stripped."""
    rest = text
    if "," in text:
        rest = text.split(",", 1)[1].strip()
    elif rest.startswith(name):
        rest = rest[len(name):].strip(" ,")
    rest = re.sub(r"\s*\([^()]*\d[^()]*\)\s*$", "", rest).strip(" .,")
    return rest or None


PERIOD_MAP = {
    "Kingdom of Rome": "kingdom",
    "Roman Republic": "republic",
    "Roman Empire": "empire",
}


def main():
    roster = json.loads((DATA / "infoplease_roster.json").read_text(encoding="utf-8"))
    roster = [r for r in roster if r.get("text") and "Byzantium" not in r["text"]]

    # Resolve the duplicate-name disambiguations by reign year.
    for r in roster:
        nm = clean_name(r["text"])
        yf, yt, _ = parse_dates(r["text"])
        if nm == "Maximin":
            WP_TITLE_BY_ORDER[r["order"]] = (
                "Maximinus Thrax" if (yf or 0) < 300 else "Maximinus II"
            )
        if nm == "Maximus":
            WP_TITLE_BY_ORDER[r["order"]] = (
                "Magnus Maximus" if (yf or 0) < 400 else "Maximus of Hispania"
            )

    out = []
    missing = []
    for r in roster:
        name = clean_name(r["text"])
        yf, yt, raw = parse_dates(r["text"])
        wp = WP_TITLE_BY_ORDER.get(r["order"]) or WP_TITLE.get(name)
        if not wp:
            missing.append((r["order"], name))
        period = PERIOD_MAP.get(r["period"], None)
        dynasty = r.get("dynasty")
        out.append({
            "id": None,            # assigned below (slug)
            "order": r["order"],
            "name": name,
            "period": period,
            "period_label": r["period"],
            "dynasty": dynasty,
            "blurb": blurb_of(r["text"], name),
            "date_raw": raw,
            "year_from": yf,
            "year_to": yt,
            "wp": wp,
            "infoplease_href": ("https://www.infoplease.com" + r["href"]) if r.get("href") else None,
        })

    # stable slug ids (unique). e.g. "augustus", "maximinus-thrax"
    seen = {}
    for e in out:
        base = re.sub(r"[^a-z0-9]+", "-", (e["wp"] or e["name"]).lower()).strip("-")
        slug = base
        n = seen.get(base, 0)
        if n:
            slug = f"{base}-{n+1}"
        seen[base] = n + 1
        e["id"] = slug

    (DATA / "seed.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"wrote seed.json: {len(out)} entries")
    by_period = {}
    for e in out:
        by_period[e["period"]] = by_period.get(e["period"], 0) + 1
    print("by period:", by_period)
    if missing:
        print("!! MISSING curated wp title for:")
        for o, n in missing:
            print(f"   order {o}: {n!r}")
    else:
        print("all entries have a curated wp title.")
    # spot-check a few parsed dates
    print("\nspot-check dates:")
    for e in out[:3] + out[22:25] + out[-4:]:
        print(f"   {e['name']:28} {str(e['date_raw']):20} -> {e['year_from']}..{e['year_to']}  wp={e['wp']}")


if __name__ == "__main__":
    main()
