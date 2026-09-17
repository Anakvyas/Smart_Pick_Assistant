"""Scanner routes: the live phone->PC stream (/ws/scan, /ws/display) and the
one-shot photo upload (/api/analyze), plus /health. See controllers/
scan_controller.py for the per-request/per-frame work; this module owns only
the route wiring and the websocket connection lifecycles (accept, receive,
send, disconnect) — state that's inherently about the connection itself,
not something a stateless controller function should carry.
"""
from fastapi import APIRouter, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from controllers import scan_controller
from utils import decode_image

router = APIRouter()

# ------------------------------------------------------------------ display fan-out
displays = set()


async def broadcast(msg):
    # Snapshot: `displays` can change while we await a slow client.
    for ws in list(displays):
        try:
            await ws.send_json(msg)
        except Exception:
            displays.discard(ws)


@router.get("/health")
def health():
    return JSONResponse({"ok": True, "displays": len(displays)})


@router.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    return await scan_controller.analyze_photo(file)


@router.websocket("/ws/display")
async def ws_display(ws: WebSocket):
    await ws.accept()
    displays.add(ws)
    try:
        while True:
            await ws.receive_text()   # keepalive
    except Exception:
        pass
    finally:
        displays.discard(ws)          # also runs on non-disconnect errors


@router.websocket("/ws/scan")
async def ws_scan(ws: WebSocket):
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
                want_image = bool(displays)
                result, last_sig, last_result = await scan_controller.process_frame(
                    jpg, img, want_image, last_sig, last_result)
            except Exception as e:
                print("frame error:", type(e).__name__, e)
                result = scan_controller.frame_error_payload(e)

            # The phone only needs the extracted fields — shipping the JPEG
            # back up its own uplink was pure waste and added latency.
            phone_msg = {k: v for k, v in result.items() if k != "image"}
            await ws.send_json(phone_msg)
            await broadcast(result)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print("scan socket closed:", type(e).__name__, e)
