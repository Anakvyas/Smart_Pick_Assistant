"""Thin orchestration layer between the scan routes and the service-level
work (services/analyzer.py, services/ocr_service.py) — the scanner's
equivalent of auth_controller.py. Framework-shaped (returns a FastAPI
JSONResponse, since that's what the routes need) but carries no
route-decorator or websocket-connection-lifecycle concerns of its own —
those stay in routes/scan.py, since a websocket's per-connection state
doesn't fit a stateless controller-function model the way a plain POST does.
"""
import asyncio

import cv2
from fastapi import UploadFile

from services import ocr_service
from services.analyzer import analyze_image
from utils import encode_preview, frame_signature, signatures_close


async def analyze_photo(file: UploadFile, want_image: bool = False) -> tuple[int, dict]:
    """One-shot barcode/label analysis for a single uploaded photo. Kept as
    a plain request/response JSON API — separate from the /ws/scan live
    stream — so it's easy to call from anywhere (curl, another service, a
    future mobile app) without speaking the scan protocol.

    Returns (status_code, result) rather than a Response — routes/scan.py
    both builds the HTTP response (image stripped) *and*, when this photo
    is tied to an order, broadcasts the full result (image included) to
    that order's live display channel; a plain dict lets it do both
    without re-deriving anything or this module reaching into routes/scan.py
    (which would be a circular import — that module already imports this
    one). want_image defaults to False so a caller with no PC watching
    (the global /scan page, /demo) doesn't pay for an encode nobody sees.
    """
    data = await file.read()
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, analyze_image, data, want_image)
        return 200, result
    except Exception as e:
        return 500, {"valid": False, "message": f"analysis failed: {e}",
                      "codes": [], "barcode": None, "barcode_type": None,
                      **ocr_service.label_payload(None), "hint": None, "hint_kind": None}


async def process_frame(jpg: bytes, img, want_image: bool, last_sig, last_result):
    """One live /ws/scan frame: reuse the previous result on a
    near-identical frame (phone held steady on one product), otherwise run
    the full analyze_image pipeline. A pure function — the caller (the
    websocket route, which owns the per-connection loop) is responsible for
    actually remembering `sig`/`result` between calls; this just computes
    what the next remembered values should be.

    Returns (result, next_sig, next_result).
    """
    sig = frame_signature(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    if last_result is not None and signatures_close(sig, last_sig):
        result = dict(last_result)
        result["latency_ms"] = 0
        if want_image:
            result["image"] = encode_preview(img, img.shape[1])
        return result, last_sig, last_result

    # allow_llm=False: a live frame's round trip gates the phone's next
    # capture (request/response pump), so a blocking LLM call here would
    # stall the whole live feed, not just one frame.
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, analyze_image, jpg, want_image, False, img)
    if result["valid"]:
        return result, sig, result
    return result, last_sig, last_result


def frame_error_payload(exc: Exception) -> dict:
    """One bad frame must not kill the /ws/scan stream: this is what gets
    sent back (ack and keep going) instead of the socket dying.
    """
    return {"valid": False, "message": f"frame error: {exc}",
            "codes": [], "barcode": None, "barcode_type": None,
            **ocr_service.label_payload(None), "hint": None, "hint_kind": None,
            "latency_ms": 0, "image": None, "error": str(exc)}
