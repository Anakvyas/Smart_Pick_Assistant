"""OCR engine + everything needed to turn its raw text into structured
label fields: GSTIN, net weight/quantity, MRP, company/address, batch and
expiry each have a fixed-enough shape for a regex; "name" has no fixed shape
at all, so it's a best-effort guess (the biggest text on the label that
isn't one of the other recognised fields). The regex/heuristic layer only
ever runs on this module's own OCR output, so it lives here rather than in
a separate file.
"""

import datetime
import re

import cv2
from dateutil import parser as dateparser
from rapidocr_onnxruntime import RapidOCR

print("loading models...")
ocr = RapidOCR()

# Imported after the OCR engine itself loads (rather than grouped with the
# other imports above) purely so the startup log prints "loading models..."
# first — matching this module's own load order — before llm_service's own
# "LLM fallback: enabled/disabled" line.
from services import llm_service

# 12/05/26 · 2026-05-12 · 05/2026 · 12 MAY 2026
MONTHS = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC"
# Each pattern pairs with the dateutil flags its own format needs — a plain
# dayfirst=True for every pattern silently swapped month/day on the
# year-first ISO pattern below (2026-05-12 parsed as 2026-12-05).
DATE_RES = [
    (re.compile(r"\b(\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})\b"),
     dict(yearfirst=True, dayfirst=False)),
    (re.compile(r"\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\b"), dict(dayfirst=True)),
    (re.compile(rf"\b(\d{{1,2}}\s*(?:{MONTHS})[a-z]*\s*\d{{2,4}})\b", re.I),
     dict(dayfirst=True)),
    (re.compile(rf"\b((?:{MONTHS})[a-z]*\s*\d{{2,4}})\b", re.I), dict(dayfirst=True)),
    (re.compile(r"\b(\d{1,2}[/\-.]\d{4})\b"), dict(dayfirst=True)),
]

# A crop this labels itself as an expiry date, vs. a manufacture date, a
# batch/lot code, or a price — all of which are also "date-shaped" and would
# otherwise get grabbed by whichever happens to come first in reading order.
# No trailing \b, and no \w* after "EXP": OCR often runs the keyword
# straight into the date with no space ("EXP12/2026"), and \w* greedily
# swallowed those leading date digits as part of the "keyword" instead of
# leaving them for the date parser.
EXPIRY_KEYWORDS = re.compile(r"\b(EXPIRY|EXPIRES|EXP\.?|BEST\s*BEFORE|BBE?|USE\s*BY)", re.I)

# Indian GST registration number: 2-digit state code, 10-char PAN, a 1-digit
# entity code, a literal 'Z', and a checksum char — a fixed enough shape that
# a strict regex is reliable instead of guessy. BUT shape alone isn't
# actually unique: a 15-character alphanumeric run in that exact layout can
# also be a batch/lot code, a distributor code, or (concretely) the same
# alphanumeric payload a Code128 barcode on the label encodes and prints
# nearby in human-readable form — with no keyword requirement, the regex
# used to grab whichever such run appeared anywhere in the OCR text, which
# in practice meant it kept "finding" a GSTIN that was really just the
# barcode's own text. Requiring the literal "GSTIN"/"GST NO"/"GST REG NO"
# keyword immediately before the code (as real labels print it) is what
# actually makes this reliable — shape was never enough on its own. No \b
# between keyword and code: a real OCR read often runs it straight into the
# code with no space ("GSTIN22AAAAA0000A1Z5"), and \b never matches between
# two word characters (a letter and a digit both count as "word"), so
# requiring it there just made the match silently fail. Digit slots also
# accept 'O' — the single most common OCR confusion — since the fixed layout
# tells us exactly which positions must be digits regardless of what got
# printed.
GSTIN_RE = re.compile(
    r"(?:GSTIN|GST\s*NO\.?|GST\s*REG(?:N|ISTRATION)?\.?\s*NO\.?)\.?\s*[:\-]?\s*"
    r"([0-9O]{2}[A-Z]{5}[0-9O]{4}[A-Z][0-9A-Z]Z[0-9A-Z])(?![0-9A-Za-z])", re.I)
_GSTIN_DIGIT_SLOTS = (0, 1, 7, 8, 9, 10)


def _clean_gstin(raw):
    if not raw:
        return None
    chars = list(raw)
    for i in _GSTIN_DIGIT_SLOTS:
        if chars[i] == "O":
            chars[i] = "0"
    return "".join(chars)


# Net weight / quantity. Longer unit spellings must come before their own
# short prefixes in the alternation — "500gms" would otherwise match as
# "500g" with "ms" left dangling. No leading \b for the same reason as
# GSTIN above ("NetWt500gms" has no space before the digits).
_WEIGHT_UNIT = r"(kgs?|gms?|grams?|mls?|ltrs?|liters?|litres?|kg|g|ml|l)"
WEIGHT_RE = re.compile(rf"(\d+(?:\.\d+)?)\s?{_WEIGHT_UNIT}(?![a-zA-Z])", re.I)

# The numeric part accepts Indian comma-grouping (₹1,499.00 / ₹12,34,567) —
# a plain \d+(?:[.,]\d{1,2})? used to stop after only 1-2 digits past the
# first comma, silently truncating "1,234.50" down to "1,23". "Price" is
# included alongside MRP/Rs/₹ since some labels print just that.
MRP_RE = re.compile(r"(?:MRP|M\.R\.P\.?|Price|Rs\.?|₹)\s*[:\-]?\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?)", re.I)

# Non-greedy with a lookahead to the next known keyword — a plain greedy
# capture ran straight through into the batch/expiry text that followed it
# on the same line. Captures the whole "company, street, city - PIN" blob
# that follows "Mfg by"/"Mktd by" — split into company vs. address below,
# since on real packaging they're one comma-separated run, not two fields.
MFG_ADDR_RE = re.compile(
    r"(?:Manufactured\s*by|Mfg\.?\s*by|Marketed\s*by|Mktd\.?\s*by)\s*[:\-]?\s*"
    r"([A-Za-z0-9 ,.&\-]{3,150}?)"
    r"(?=\s*(?:Batch|Lot|B\.?No|EXP|Best\s*Before|MRP|GSTIN|$))", re.I)


def _split_company_address(blob):
    """"Mfg by ACME Foods Pvt Ltd, 12 Industrial Area, Pune - 411001" is one
    comma-separated run on the label, not two separate fields — the company
    name is the first segment, everything after is the address. True often
    enough on Indian retail packaging to be worth splitting; a blob with no
    comma at all (just a bare company name) is returned as company only.
    """
    if not blob:
        return None, None
    blob = blob.strip(" ,.")
    if not blob:
        return None, None
    if "," in blob:
        company, _, address = blob.partition(",")
        return company.strip(" ,.") or None, address.strip(" ,.") or None
    return blob, None


BATCH_RE = re.compile(r"(?:Batch\s*No\.?|B\.?\s*No\.?|Lot\s*No\.?)\s*[:\-]?\s*([A-Za-z0-9\-/]{2,20})", re.I)


def _prep_for_ocr(img):
    """Clean up a frame before handing it to OCR: upscale (small crops
    only) -> denoise -> grayscale -> local contrast -> sharpen. A phone held
    at arm's length puts printed text well under the character height OCR
    needs to be reliable, camera sensor noise gets worse the smaller/dimmer
    the shot, and curved/glossy packaging often lights one side brighter
    than the other — all of that silently tanks read accuracy. Every step
    here is O(pixels) on a frame already capped to a few hundred px tall, so
    the whole pipeline stays a few ms — negligible next to the OCR model
    inference itself, which is what actually gates live-scan frame rate.

    No perspective correction and no binarizing (adaptive threshold): both
    need a reliable rectangle to work from (a lit document page against a
    contrasting background), which a hand-held shot of curved/angled retail
    packaging usually doesn't have — a bad warp or a bad threshold destroys
    more text than either would fix. And RapidOCR's detector+recognizer are
    trained on grayscale images with real gradients, not flat black/white,
    so binarizing works against it rather than for it.
    """
    h, w = img.shape[:2]
    scale = max(1.0, 200 / max(h, 1))
    if scale > 1.0:
        img = cv2.resize(img, (int(w * scale), int(h * scale)),
                          interpolation=cv2.INTER_CUBIC)

    # Bilateral, not Gaussian/fastNlMeans: smooths flat regions while
    # keeping character edges crisp, and cheap enough to run every frame —
    # a full non-local-means pass is too slow for live video.
    img = cv2.bilateralFilter(img, d=5, sigmaColor=50, sigmaSpace=50)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # CLAHE: *local* contrast, not a global histogram stretch — a label lit
    # unevenly (one edge brighter than the other under a phone's flash)
    # would otherwise stay dark on one side no matter how much global
    # contrast gets added.
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)

    # Unsharp mask: recovers the edge crispness the bilateral filter and
    # upscale interpolation both soften, without the speckle a naive
    # Laplacian sharpen adds back on real camera noise.
    blur = cv2.GaussianBlur(gray, (0, 0), sigmaX=3)
    gray = cv2.addWeighted(gray, 1.5, blur, -0.5, 0)

    return gray


def _plausible_year(year):
    """A single misread digit (2026 -> 2826, or a 0 read as an 8) turns real
    OCR noise into a *confidently wrong* answer instead of no answer — and a
    wrong expiry date is worse than none. A product's shelf life is
    realistically within a handful of years of today either direction, so
    reject anything outside that and keep looking rather than trust it.
    """
    current = datetime.datetime.now().year
    return current - 3 <= year <= current + 8


def _parse_date(text, default):
    for rx, flags in DATE_RES:
        # Every occurrence, not just the first — a single garbled match
        # (bad digit -> implausible year) shouldn't stop us from finding a
        # legible one elsewhere in the same OCR text.
        for m in rx.finditer(text):
            try:
                d = dateparser.parse(m.group(1), fuzzy=True, default=default,
                                      **flags).date()
            except Exception:
                # dateparser throws ValueError/OverflowError/TypeError on junk OCR.
                continue
            if _plausible_year(d.year):
                return d.isoformat()
    return None


_EMPTY_LABEL = {"name": None, "expiry": None, "gstin": None, "weight": None,
                "mrp": None, "company": None, "address": None, "batch": None,
                "raw_text": None}


def _first_match(rx, text):
    m = rx.search(text)
    return m.group(1).strip(" .,:-") if m else None


# A line carrying one of these keywords is a label header (e.g. "GSTIN ...",
# "EXP 12/2026"), not the product name — skipped even when the field itself
# failed to extract (a keyword present but its value unparseable still marks
# the line as "not the name"). No trailing \b, for the same reason as
# GSTIN_RE above — the keyword often runs straight into its value.
_NAME_EXCLUDE_RE = re.compile(
    r"\b(EXP\w*|BEST\s*BEFORE|BBE?|USE\s*BY|GSTIN|MRP|M\.R\.P\.?|"
    r"BATCH|LOT\s*NO\.?|B\.?NO\.?|MFG\w*|MANUFACTURED|MARKETED|MKTD\w*|ADDRESS)", re.I)


def _is_other_field_shaped(txt):
    """True when a line's own shape marks it as a GSTIN/weight/MRP/batch/date
    — regardless of whether that exact value made it into the fields we
    already extracted with regex. A raw GSTIN still carrying an OCR 'O' (the
    extracted `gstin` has already had those corrected to '0') or a date in
    whatever format it was printed in (the extracted `expiry` is a
    normalised ISO string, rarely a literal match) both used to slip past a
    plain substring check and get picked as the "name" instead — matching
    the shape directly instead of the already-cleaned value closes that.
    """
    return bool(GSTIN_RE.search(txt) or WEIGHT_RE.search(txt) or
                MRP_RE.search(txt) or BATCH_RE.search(txt) or
                any(rx.search(txt) for rx, _flags in DATE_RES))


# RapidOCR's own per-line confidence, not just the detector's bounding box —
# a low-confidence read is exactly what "garbled text" looks like (curved
# label, glare, motion blur), and a short garbled fragment can still get a
# tall bounding box if the detector split it oddly. Below this, a line is
# never trusted as the product name even if it's the tallest thing on the
# label. 0.65 is stricter than RapidOCR's own 0.5 default text_score filter
# (which only keeps a line at all) — good enough to *exist* in raw_text
# isn't good enough to be trusted as *the* name.
_NAME_MIN_SCORE = 0.65


def _clean_name_line(txt):
    """Strip stray OCR-noise punctuation/symbols framing an otherwise
    legible line — a read like "*SAFOLA-" should become "SAFOLA", not get
    thrown out or kept with junk stuck to it. Only trims from the ends, so
    real internal punctuation (an ampersand, a hyphenated word) survives.
    """
    return re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", txt).strip()


def _looks_like_garbage(txt):
    """A genuine misread on glossy/curved packaging tends to come back as a
    short run of stray symbols or a single stray character, not a real
    word — neither belongs in the "name" slot just because the detector
    gave it a tall box. Require a couple of real letters and a majority-
    alphabetic line.
    """
    letters = sum(ch.isalpha() for ch in txt)
    return letters < 2 or (letters / len(txt)) < 0.5


def _largest_text_line(lines, exclude_substrings):
    """The line with the tallest bounding box, skipping any line that's just
    a field we already pulled out with a dedicated regex (GSTIN, weight,
    ...), that's shaped like one of those fields even if its exact value
    differs, that's clearly a label header, that OCR itself wasn't
    confident about, or that's too garbled/symbol-heavy to be a real
    word — otherwise "name" becomes whichever of those happens to be
    printed biggest, instead of the actual product name.
    """
    excludes = [s.lower() for s in exclude_substrings if s]
    best, best_h = None, 0
    for entry in lines:
        if len(entry) < 2:
            continue
        bbox, txt = entry[0], str(entry[1]).strip()
        score = float(entry[2]) if len(entry) > 2 else 1.0
        if not txt or any(s in txt.lower() for s in excludes):
            continue
        if _NAME_EXCLUDE_RE.search(txt) or _is_other_field_shaped(txt):
            continue
        if score < _NAME_MIN_SCORE:
            continue
        cleaned = _clean_name_line(txt)
        if not cleaned or _looks_like_garbage(cleaned):
            continue
        ys = [p[1] for p in bbox]
        height = max(ys) - min(ys)
        if height > best_h:
            best, best_h = cleaned, height
    return best


def label_empty(label):
    # raw_text excluded deliberately — OCR reading *some* text (stray
    # background text, a blur that half-parses) isn't the same as finding
    # any of the structured fields we actually care about.
    return not label or not any(label.get(k) for k in _EMPTY_LABEL if k != "raw_text")


def label_payload(lbl):
    lbl = lbl or {}
    return {k: lbl.get(k) for k in _EMPTY_LABEL}


def read_label(img, allow_llm=True):
    """One OCR pass over the whole frame, pulling out every field on retail
    packaging we can recognise reliably: GSTIN, net weight/quantity, MRP and
    company/address/batch each have a fixed-enough shape for a regex; expiry
    reuses the keyword+date-parse logic below. "name" has no fixed shape at
    all, so it's a best-effort guess: the biggest text on the label that
    isn't one of the other recognised fields — true often enough on real
    packaging to be worth returning, not true always. `raw_text` is
    everything OCR read, verbatim, so a caller can see what the regexes had
    to work with and judge a miss for themselves.

    `allow_llm=False` skips the llm_service fallback below even when regex
    misses name/company — used for live /ws/scan frames, where that call's
    network latency (up to its request timeout) would otherwise stall that
    frame's round trip and, since the phone only sends its next frame after
    this one acks, the whole live feed with it. The single-photo upload path
    has no such constraint and keeps the fallback.
    """
    h, w = img.shape[:2]
    try:
        result, _elapsed = ocr(_prep_for_ocr(img))
    except Exception as e:
        print(f"ocr: frame {w}x{h} -> EXCEPTION {type(e).__name__}: {e}")
        return dict(_EMPTY_LABEL)
    lines = result or []
    if not lines:
        # This is the single most useful line for telling "OCR never ran"
        # apart from "OCR ran and genuinely found no text" — a frame too
        # small, too blurry, or pointed at plain packaging will land here.
        print(f"ocr: frame {w}x{h} -> no text detected")
        return dict(_EMPTY_LABEL)
    text = " ".join(str(t[1]) for t in lines if len(t) > 1)
    print(f"ocr: frame {w}x{h} -> read: {text!r}")
    # dateutil defaults *missing* fields to today's date, not day 1 — so a
    # bare month/year like "12/2026" parsed on the 16th silently became the
    # 16th of December. Force day 1 explicitly so a bare month/year reads as
    # the conservative (start-of-month) expiry.
    default = datetime.datetime.now().replace(day=1, hour=0, minute=0,
                                                second=0, microsecond=0)

    # Prefer whichever date sits right after an "EXP"/"BEST BEFORE"/"USE BY"
    # label — a frame often carries both a manufacture date and an expiry
    # date, and reading left-to-right would silently pick whichever came
    # first regardless of which one it actually was.
    expiry = None
    for km in EXPIRY_KEYWORDS.finditer(text):
        expiry = _parse_date(text[km.end():km.end() + 20], default)
        if expiry:
            break
    if not expiry:
        expiry = _parse_date(text, default)

    gstin = _clean_gstin(_first_match(GSTIN_RE, text))
    company, address = _split_company_address(_first_match(MFG_ADDR_RE, text))
    batch = _first_match(BATCH_RE, text)
    mrp_val = _first_match(MRP_RE, text)
    mrp = f"₹{mrp_val}" if mrp_val else None
    wm = WEIGHT_RE.search(text)
    weight = f"{wm.group(1)}{wm.group(2).lower()}" if wm else None

    name = _largest_text_line(
        lines, exclude_substrings=[gstin, weight, mrp_val, company, address, batch, expiry])

    # Always run the LLM fallback (subject only to llm_service.llm_enabled/
    # allow_llm/its own cooldown) rather than only when regex missed
    # something — and once it returns something, its answer for
    # name/company/address/expiry wins over the regex/heuristic guess rather
    # than only filling a gap left empty. name/company/address have no fixed
    # shape at all (nothing for a regex to reliably match), and even
    # expiry's fixed-shape regex can be fooled by a manufacture date sitting
    # closer to a mangled "EXP" keyword than the real one — the LLM reads
    # the surrounding text for meaning, so it's trusted as the
    # higher-precision source for these fields whenever it actually returns
    # one. (gstin is still never touched here — see llm_service's docstring
    # on why it's regex-only, unconditionally.)
    if llm_service.llm_enabled and allow_llm:
        filled = llm_service.fill_label(text)
        if filled:
            name = filled.get("name") or name
            company = filled.get("company") or company
            address = filled.get("address") or address
            # Re-parsed (and re-checked for a plausible year) the same way a
            # regex-found date would be, rather than trusted as already-
            # normalised ISO text.
            llm_expiry = _parse_date(str(filled.get("expiry") or ""), default)
            expiry = llm_expiry or expiry

    label = {"name": name, "expiry": expiry, "gstin": gstin, "weight": weight,
             "mrp": mrp, "company": company, "address": address, "batch": batch,
             "raw_text": text}
    print(f"ocr: frame {w}x{h} -> {label}" if any(v for k, v in label.items() if k != "raw_text") else
          f"ocr: frame {w}x{h} -> text read, but no recognised field in it")
    return label
