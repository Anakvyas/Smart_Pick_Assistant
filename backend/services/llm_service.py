"""LLM pass for turning the noisy OCR text into structured fields regex
struggles with: "name"/"company"/"address" have no fixed shape at all, and
expiry regex normally nails from its fixed shape but can still miss on a
badly garbled read (a date keyword OCR mangled beyond recognition) or grab a
manufacture date sitting closer to a mangled keyword than the real expiry.
ocr_service always calls `fill_label` whenever OCR read *something* (not
just when regex came up empty), and its answer for these fields wins over
the regex/heuristic guess when it returns one, since it reads the
surrounding text for meaning instead of pattern-matching shape alone. Its
only job is this OCR-text -> JSON extraction, nothing else (no web lookups,
no guessing beyond the text).

GSTIN is deliberately never sourced from here, not even shape-validated:
it's a tax ID, wrong is worse than missing, and a shape check only confirms
the answer *looks like* a GSTIN — it can't confirm that string was actually
printed on the label rather than a plausible-looking invention. Regex
against the raw OCR text (in ocr_service) has no such failure mode, since it
can only ever match characters that were actually read off the label.
"""

import json
import re
import time

import requests

from config import OLLAMA_URL, OLLAMA_MODEL, LLM_COOLDOWN_SEC


def _ollama_reachable():
    try:
        requests.get(OLLAMA_URL.rsplit("/v1/", 1)[0] + "/api/version", timeout=1)
        return True
    except Exception:
        return False


llm_enabled = _ollama_reachable()
print(f"LLM fallback: {'enabled (Ollama: ' + OLLAMA_MODEL + ')' if llm_enabled else 'disabled (no Ollama server at ' + OLLAMA_URL + ')'}")

_last_call_at = 0.0

_PROMPT = """Extract structured information from this noisy OCR of a retail product label.

Return ONLY valid JSON:
{{"name": "...", "company": "...", "address": "...", "expiry": "...", "mfg_date": "..."}}

Rules:
- name = product/brand name (e.g. "Saffola").
- company = manufacturer or marketer company.
- address = postal address associated with that company.
- expiry = the expiry / best-before / use-by date, NOT the manufacturing
  date and NOT a batch/lot code. Output it as ISO "YYYY-MM-DD" (use "-01"
  for the day when only a month/year is printed). Omit entirely if you
  can't tell it apart from a manufacturing date.
- mfg_date = the manufacturing / packing date (labels may print "MFG DATE",
  "MFD", "DOM" or "PKD"), NOT the expiry date. Same "YYYY-MM-DD" format.
  Omit entirely if you can't tell it apart from the expiry date.
- Correct obvious OCR errors only when the intended text is clear.
- Do not guess or hallucinate.
- Use null when a field is not clearly present.
- Ignore nutrition facts, ingredients, cooking instructions, barcode, FSSAI number, batch number, MRP and URLs.
- No markdown, explanation, or extra text.

OCR:
{text}
"""


def fill_label(raw_text):
    """Ask a local Ollama model to pick name/company/address (no reliable
    fixed shape to pattern-match on) and expiry out of the raw OCR text,
    every time this runs — not only when regex missed a field — since the
    caller trusts whatever this returns over its own regex/heuristic guess.
    Returns {} on any failure, timeout, cooldown, or disabled client —
    callers already treat a missing field as "not found", so this fails
    silently rather than breaking the request. The caller still re-validates
    expiry against its own date rules before trusting it — this is
    OCR-text-to-JSON extraction, not a second source of truth. (No gstin
    here at all — see the module docstring on why that field is regex-only.)
    """
    global _last_call_at
    if not llm_enabled or not raw_text:
        return {}
    now = time.time()
    if now - _last_call_at < LLM_COOLDOWN_SEC:
        return {}
    _last_call_at = now
    try:
        resp = requests.post(
            OLLAMA_URL,
            json={"model": OLLAMA_MODEL, "temperature": 0, "max_tokens": 300,
                  "messages": [{"role": "user", "content": _PROMPT.format(text=raw_text)}]},
            timeout=15,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        if not content:
            print("llm fallback: empty content")
            return {}
        m = re.search(r"\{.*\}", content, re.S)
        out = json.loads(m.group(0)) if m else {}
        out = {k: v for k, v in out.items()
               if k in ("name", "company", "address", "expiry", "mfg_date") and v}
        if out:
            print(f"llm fallback: {OLLAMA_MODEL} -> {out}")
        return out
    except Exception as e:
        print(f"llm fallback: EXCEPTION {type(e).__name__}: {e}")
        return {}
