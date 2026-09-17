"""Single-shot analysis of one image: run the product gate, decode any
barcode, OCR the whole frame directly for label fields, return everything
found right now.

Deliberately stateless per call — one photo (or one live frame) is one
product, not a shelf of many, so there's no tracker, no per-product crop,
and no memory carried between calls beyond the barcode->label cache below.
The live scanner (/ws/scan) and the photo upload (/api/analyze) in app.py
both call `analyze_image`; the differences are whether a display is
watching and wants a JPEG preview, and whether the (network-latency-bound)
LLM label fallback is allowed to run — see ocr_service.read_label.
"""

import time

import cv2

from config import USE_YOLO_GATE
# Import order matters for the startup log: ocr_service prints "loading
# models..." (and, once it loads, triggers llm_service's own status line)
# before detector_service prints the product-gate status.
from services import ocr_service, detector_service, barcode_service
from utils import decode_image, encode_preview


def compute_hint(brightness, sharpness, codes, w, h, has_label):
    """Turn image-quality signals into one coaching tip, in priority order —
    a dark AND blurry frame should say "too dark", not flip between tips.
    Shared by the live stream and the single-photo upload path so both give
    the same advice for the same problem.
    """
    if brightness < 60:
        return "💡 too dark — move to better light"
    if sharpness < 60:
        return "🫳 hold the camera steady"
    if codes:
        areas = [((c["box"][2] - c["box"][0]) * (c["box"][3] - c["box"][1])) / (w * h)
                  for c in codes]
        max_area = max(areas)
        if max_area < 0.01:
            return "🔍 move closer to the product"
        if max_area > 0.9:
            return "↔️ move back a little"
        return None
    if not has_label:
        return "📷 point the camera at a product label"
    return None


# _frame_signature (in utils, keyed per-websocket-connection in app.py) only
# catches "same shot as the frame right before this one" — move the phone
# away and back, or shift the angle, and it misses even though it's the same
# physical product. A barcode value is a far more reliable identity signal
# than pixel similarity, so once OCR (or the LLM) has filled in a product's
# label for a given barcode, every later frame carrying that same barcode
# reuses it instead of re-running OCR, let alone hitting the LLM again —
# this is what actually keeps that call infrequent regardless of how choppy
# or wide-ranging the camera movement is.
#
# Global on purpose (a barcode means the same product for every connection,
# not just whichever one read it first) and never evicted — a few thousand
# SKUs is a trivial amount of memory for a long process, and a product's
# label text doesn't change out from under its own barcode.
_label_cache = {}


# The three fields the LLM pass actually fills — gstin deliberately left
# out, since it's regex-only and re-running extraction can never fill it in.
# Requiring it here would mean a product whose GSTIN print is genuinely
# illegible never counts as "complete", forcing every future allow_llm=True
# lookup of that barcode to re-run OCR+LLM for no possible gain.
def _label_complete(label):
    return bool(label) and all(label.get(k) for k in ("name", "company", "expiry"))


def analyze_image(img_bytes, want_image=False, allow_llm=True, img=None):
    """`img` lets a caller that already decoded the frame (e.g. /ws/scan in
    app.py, which decodes it once up front to compute a similarity hash
    before deciding whether to bother calling this at all) skip a second
    decode.
    """
    t0 = time.time()
    if img is None:
        img = decode_image(img_bytes)
    if img is None:
        return {"valid": False, "message": "couldn't read that as an image file",
                "codes": [], **ocr_service.label_payload(None), "hint": None,
                "latency_ms": 0, "image": None}

    h, w = img.shape[:2]

    # Gate first: an empty shelf shouldn't pay for a zxing decode pass or a
    # full OCR (+ possibly LLM) pass just to come back empty anyway — this
    # is the whole point of running product detection before the rest of
    # the pipeline instead of alongside it. USE_YOLO_GATE = False skips this
    # block entirely rather than calling into a no-op detect_product, so
    # "gate off" really does mean "run exactly like before this feature".
    if USE_YOLO_GATE:
        product = detector_service.detect_product(img)
        pc = f"{product['product_conf']:.2f}" if product["product_conf"] is not None else "n/a"
        ec = f"{product['empty_conf']:.2f}" if product["empty_conf"] is not None else "n/a"
        print(f"gate: frame {w}x{h} -> product={pc} empty={ec} -> "
              f"{'product' if product['is_product'] else 'EMPTY, skipping OCR'}")
        if not product["is_product"]:
            return {"valid": False, "message": "empty shelf — no product detected",
                    "codes": [], **ocr_service.label_payload(None),
                    "hint": "🛒 empty shelf — point the camera at a product",
                    "product_detected": False,
                    "latency_ms": round((time.time() - t0) * 1000),
                    "image": encode_preview(img, w) if want_image else None}

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    brightness = float(gray.mean())
    # Laplacian variance: a sharp, in-focus frame has strong edges everywhere,
    # so its 2nd-derivative response is high-variance; motion blur / an
    # out-of-focus macro shot smears those edges flat, so variance drops.
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    codes_raw = barcode_service.read_codes(img)

    # Barcode decode is cheap (no neural net) so it always runs; whether the
    # expensive OCR pass behind it runs depends on what's already cached for
    # that exact product. A live frame (allow_llm=False) always trusts the
    # cache, complete or not — better than nothing, and free. An LLM-allowed
    # caller (photo upload) only trusts a *complete* cache entry, so an
    # earlier partial live-scan result doesn't permanently block a later,
    # fuller extraction from ever running for the same product.
    cache_key = codes_raw[0]["value"] if codes_raw else None
    cached = _label_cache.get(cache_key) if cache_key else None
    if cached and (not allow_llm or _label_complete(cached)):
        label = cached
    else:
        label = ocr_service.read_label(img, allow_llm=allow_llm)
        if cache_key and not ocr_service.label_empty(label):
            _label_cache[cache_key] = label

    codes = [{"kind": c["kind"], "value": c["value"],
              "box": {"x": round(c["box"][0] / w, 4), "y": round(c["box"][1] / h, 4),
                      "w": round((c["box"][2] - c["box"][0]) / w, 4),
                      "h": round((c["box"][3] - c["box"][1]) / h, 4)}}
             for c in codes_raw]

    hint = compute_hint(brightness, sharpness, codes_raw, w, h, not ocr_service.label_empty(label))
    valid = bool(codes) or not ocr_service.label_empty(label)

    if valid:
        parts = []
        if codes:
            parts.append(f"{len(codes)} barcode{'s' if len(codes) != 1 else ''}")
        if not ocr_service.label_empty(label):
            parts.append("label text read")
        message = " + ".join(parts) + " found"
    else:
        message = "no barcode or readable label text in this image"

    image_b64 = encode_preview(img, w) if want_image else None

    return {"valid": valid, "message": message, "codes": codes,
            **ocr_service.label_payload(label), "hint": hint,
            "product_detected": True if USE_YOLO_GATE else None,
            "latency_ms": round((time.time() - t0) * 1000), "image": image_b64}
