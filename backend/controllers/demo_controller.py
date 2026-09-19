"""Serves the demo product gallery — see backend/demo/gen_demo.py for how
that data is generated. Demo-only: entirely separate from the live scan
pipeline and its inventory.
"""
import json
import os

from fastapi.responses import JSONResponse

from config import DEMO_DIR


def list_demo_products() -> JSONResponse:
    """A handful of real products (real barcode/name/company/weight, pulled
    once from Open Food Facts) rendered as a plain barcode graphic rather
    than product photography, plus a few plausible expiry/batch/GSTIN/MRP
    values no public database tracks per-barcode — shaped exactly like an
    /api/analyze result, so the /demo gallery page can reuse the same
    ResultPanel component a real scan uses.
    """
    path = os.path.join(DEMO_DIR, "products.json")
    if not os.path.exists(path):
        return JSONResponse([])
    with open(path) as f:
        products = json.load(f)

    results = []
    for p in products:
        codes = [{"kind": p["barcode_type"], "value": p["barcode"]}] if p.get("barcode") else []
        results.append({
            "id": p["id"], "valid": True, "message": "demo product",
            "codes": codes, "barcode": p.get("barcode"), "barcode_type": p.get("barcode_type"),
            "name": p.get("name"), "mfg_date": p.get("mfg_date"), "expiry": p.get("expiry"),
            "gstin": p.get("gstin"), "weight": p.get("weight"), "mrp": p.get("mrp"),
            "company": p.get("company"), "address": p.get("address"), "batch": p.get("batch"),
            "raw_text": None, "hint": None, "hint_kind": None, "product_detected": True,
            "latency_ms": 0, "image": p.get("image"),
        })
    return JSONResponse(results)
