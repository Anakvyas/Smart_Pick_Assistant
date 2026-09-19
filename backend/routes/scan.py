"""Scanner routes: the live phone->PC stream (/ws/scan, /ws/display) and the
one-shot photo upload (/api/analyze), plus /health. See controllers/
scan_controller.py for the per-request/per-frame work; this module owns only
the route wiring and the websocket connection lifecycles (accept, receive,
send, disconnect) — state that's inherently about the connection itself,
not something a stateless controller function should carry.
"""
from __future__ import annotations  # for `str | None` below, on Python 3.9

from collections import defaultdict

from fastapi import APIRouter, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from controllers import scan_controller
from utils import decode_image

router = APIRouter()

# ------------------------------------------------------------------ display fan-out
# Keyed by order id; None is the original global channel (Scan.jsx /
# Display.jsx) that every order-scoped *scan frame* also mirrors into, so
# that standalone debug page keeps seeing everything instead of losing
# traffic to whichever order it happened to belong to. Display.jsx's own
# message handler only knows how to render a raw scan-frame result — an
# item_update (see routes/orders.py) has a different shape entirely, so
# those are never mirrored to the global channel (mirror_global=False).
displays: dict[str | None, set[WebSocket]] = defaultdict(set)


async def broadcast(msg, order_id: str | None = None, mirror_global: bool = True):
    # Snapshot: `displays[key]` can change while we await a slow client.
    keys = (None,) if order_id is None else ((order_id, None) if mirror_global else (order_id,))
    for key in keys:
        for ws in list(displays.get(key, ())):
            try:
                await ws.send_json(msg)
            except Exception:
                displays[key].discard(ws)


@router.get("/health")
def health():
    return JSONResponse({"ok": True, "displays": sum(len(s) for s in displays.values())})


@router.post("/api/analyze")
async def analyze(file: UploadFile = File(...), order_id: str | None = Form(None)):
    # want_image=True only when this photo is tied to an order — that's
    # the only case anything (the order's /ws/display/{order_id}) will
    # ever look at it, so a caller with no order context (the global
    # /scan page, /demo) skips the encode entirely.
    status_code, result = await scan_controller.analyze_photo(file, want_image=bool(order_id))
    if order_id:
        # Same channel the live camera pump already feeds (see _scan_loop
        # below) — a Capture/Gallery photo now shows up in that order's
        # live "what's the phone looking at" feed too, not just continuous
        # live frames. Broadcast the full result (image included); the
        # HTTP response below strips it same as always.
        await broadcast(result, order_id)
    response = {k: v for k, v in result.items() if k != "image"}
    return JSONResponse(response, status_code=status_code)


async def _display_loop(ws: WebSocket, order_id: str | None):
    await ws.accept()
    displays[order_id].add(ws)
    try:
        while True:
            await ws.receive_text()   # keepalive
    except Exception:
        pass
    finally:
        displays[order_id].discard(ws)   # also runs on non-disconnect errors


@router.websocket("/ws/display")
async def ws_display(ws: WebSocket):
    await _display_loop(ws, None)


@router.websocket("/ws/display/{order_id}")
async def ws_display_order(ws: WebSocket, order_id: str):
    await _display_loop(ws, order_id)


async def _scan_loop(ws: WebSocket, order_id: str | None):
    await ws.accept()
    # Per-connection only (not global) — one phone holding steady on a
    # product shouldn't reuse a result some other phone found, and a fresh
    # connection shouldn't inherit a stale one either. See utils.frame_signature.
    last_sig, last_result = None, None
    try:
        while True:
            # Binary frames straight off the wire — no base64 in either
            # direction on this leg. base64 inflates payload size ~33% and
            # costs an encode on the phone plus a decode here, on every
            # single frame of a live stream; skipping it is a real latency
            # and bandwidth win where /ws/display's occasional JSON-embedded
            # preview image doesn't need to bother.
            jpg = await ws.receive_bytes()
            try:
                img = decode_image(jpg)
                if img is None:
                    raise ValueError("couldn't read that as an image file")
                want_image = bool(displays.get(order_id)) or bool(displays.get(None))
                result, last_sig, last_result = await scan_controller.process_frame(
                    jpg, img, want_image, last_sig, last_result)
            except Exception as e:
                print("frame error:", type(e).__name__, e)
                result = scan_controller.frame_error_payload(e)

            # The phone only needs the extracted fields — shipping the JPEG
            # back up its own uplink was pure waste and added latency.
            phone_msg = {k: v for k, v in result.items() if k != "image"}
            await ws.send_json(phone_msg)
            await broadcast(result, order_id)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print("scan socket closed:", type(e).__name__, e)


@router.websocket("/ws/scan")
async def ws_scan(ws: WebSocket):
    await _scan_loop(ws, None)


@router.websocket("/ws/scan/{order_id}")
async def ws_scan_order(ws: WebSocket, order_id: str):
    await _scan_loop(ws, order_id)
