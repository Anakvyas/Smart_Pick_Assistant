"""One-off generator for the demo product dataset. Pulls *real* barcode,
product name, brand/company and weight from the Open Food Facts public API
(free, no key, ODbL-licensed) for a curated list of well known Indian retail
products, then renders a plain, clean barcode graphic for each (via
zxingcpp — the same library this app already uses to *decode* barcodes) as
the demo image. No product photography at all: the point of a demo card is
the structured fields (name/weight/expiry/mrp/company/batch), same as a real
scan result shows them, not a picture of the product itself.

The handful of fields no public product database tracks per-barcode
(expiry, mfg date, batch, GSTIN, MRP are per physical unit/batch, not per
product type) are filled in with plausible demo values.

Run once (`python gen_demo.py`) whenever the demo list itself changes — the
output (backend/demo/products.json + backend/demo/images/*.png) is checked
into the repo as static assets, not regenerated at request time.
products.json is the flat-file "DB" for now; import it into a real database
later without changing its shape.
"""
import json
import os
import re
import time

import numpy as np
import requests
import zxingcpp
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.environ.get("DEMO_OUT_DIR", HERE)
IMG_DIR = os.path.join(OUT_DIR, "images")
os.makedirs(IMG_DIR, exist_ok=True)

SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"
UA = {"User-Agent": "SmartPickAssistant-Demo/1.0"}

BARCODE_FORMATS = {8: zxingcpp.BarcodeFormat.EAN8, 12: zxingcpp.BarcodeFormat.UPCA,
                   13: zxingcpp.BarcodeFormat.EAN13}

# (search term, slug, fabricated demo-only fields not tracked by any public
# product database — expiry/mfg/batch/gstin/mrp are per physical unit or
# batch, so a real dataset keyed by barcode alone was never going to have
# them).
QUERIES = [
    ("Parle-G Biscuit", "parle-g", dict(
        mrp="₹10.00", mfg_date="2026-07-01", expiry="2027-01-01",
        batch="PG2607", gstin="27AAACP5678D1Z1")),
    ("Maggi 2 Minute Noodles", "maggi-noodles", dict(
        mrp="₹14.00", mfg_date="2026-05-01", expiry="2027-05-01",
        batch="MG2405", gstin="09AABCN1234C1Z5")),
    ("Lays India Magic Masala", "lays-magic-masala", dict(
        mrp="₹20.00", mfg_date="2026-06-15", expiry="2026-12-15",
        batch="L24A08", gstin="27AAACP1234A1Z8")),
    ("Amul Taaza Milk", "amul-taaza-milk", dict(
        mrp="₹32.00", mfg_date="2026-09-10", expiry="2026-09-13",
        batch="AM2609", gstin="24AAAAG1234B1Z2")),
    ("Colgate Toothpaste", "colgate-toothpaste", dict(
        mrp="₹95.00", mfg_date="2026-03-01", expiry="2028-03-01",
        batch="CG2603", gstin="33AAACC1234E1Z6")),
    ("Tata Salt", "tata-salt", dict(
        mrp="₹28.00", mfg_date="2026-04-01", expiry="2028-04-01",
        batch="TS2604", gstin="19AAACT2727Q1ZW")),
    ("Britannia Good Day", "britannia-good-day", dict(
        mrp="₹30.00", mfg_date="2026-08-01", expiry="2027-02-01",
        batch="BG2608", gstin="19AABCB1234F1Z9")),
    ("Kurkure Masala Munch", "kurkure-masala-munch", dict(
        mrp="₹20.00", mfg_date="2026-07-20", expiry="2027-01-20",
        batch="KK2607", gstin="27AAACP1234A1Z8")),
]


def barcode_kind(code):
    return {8: "EAN8", 12: "UPC-A", 13: "EAN13"}.get(len(code), "EAN13")


def clean_name(name):
    return re.sub(r"\s+", " ", name).strip()


def search_candidates(term, page_size=6, retries=4):
    for attempt in range(retries):
        try:
            resp = requests.get(SEARCH_URL, params={
                "search_terms": term, "search_simple": 1, "action": "process",
                "json": 1, "page_size": page_size, "countries_tags_en": "India",
            }, timeout=20, headers=UA)
            resp.raise_for_status()
            break
        except requests.exceptions.RequestException as e:
            if attempt == retries - 1:
                raise
            print(f"    (attempt {attempt + 1} failed: {e}; retrying)")
            time.sleep(4 * (attempt + 1))
    out = []
    for p in resp.json().get("products", []):
        code = p.get("code")
        name = p.get("product_name")
        if code and name and code.isdigit() and len(code) in BARCODE_FORMATS:
            out.append({"code": code, "name": name, "brands": p.get("brands"),
                        "quantity": p.get("quantity")})
    return out


def make_barcode_image(code, dest):
    bc = zxingcpp.create_barcode(code, BARCODE_FORMATS[len(code)])
    img = zxingcpp.write_barcode_to_image(bc, size_hint=600, with_hrt=True)
    # Pad onto a white canvas — write_barcode_to_image's own quiet zone is
    # thin enough that the human-readable digits under a wide code touch
    # the image edge; this keeps the graphic looking like an actual
    # printed barcode label/sticker.
    bars = Image.fromarray(np.array(img)).convert("L")
    pad = 40
    canvas = Image.new("L", (bars.width + pad * 2, bars.height + pad * 2), 255)
    canvas.paste(bars, (pad, pad))
    canvas.convert("RGB").save(dest)


def main():
    # Resumable: search.pl has been intermittently 503ing, so this often
    # needs more than one run — a slug already written on a prior run is
    # kept as-is rather than re-queried.
    products_path = os.path.join(OUT_DIR, "products.json")
    records = json.load(open(products_path)) if os.path.exists(products_path) else []
    done_slugs = {r["id"] for r in records}

    for term, slug, extra in QUERIES:
        if slug in done_slugs:
            print(f"already have {slug!r}, skipping")
            continue
        try:
            candidates = search_candidates(term)
        except Exception as e:
            print(f"skip {term!r} — search failed: {e}")
            continue
        if not candidates:
            print(f"skip {term!r} — no usable OFF result")
            continue
        c = candidates[0]

        dest = os.path.join(IMG_DIR, f"{slug}.png")
        make_barcode_image(c["code"], dest)

        record = {
            "id": slug,
            "name": clean_name(c["name"]),
            "company": (c.get("brands") or "").split(",")[0].strip() or None,
            "address": None,
            "barcode": c["code"],
            "barcode_type": barcode_kind(c["code"]),
            "weight": c.get("quantity") or None,
            "image": f"/demo/images/{slug}.png",
            **extra,
        }
        records.append(record)
        print(f"ok {term!r} -> {record['name']} ({c['code']})")
        time.sleep(0.3)  # be a polite, unhurried client of a free public API

    with open(products_path, "w") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
    print(f"\nwrote {len(records)}/{len(QUERIES)} demo products -> {products_path}")


if __name__ == "__main__":
    main()
