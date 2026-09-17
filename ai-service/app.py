"""
Smart Pick scanner — phone camera in, PC screen out.

Flow:  phone /scan --frame--> WS --> [product gate --> barcode + OCR] --> JSON --> PC /

One photo == one product now, not a shelf of many, so there's no per-product
tracker and nothing to track across frames — the YOLO gate only answers "is
there a product in this frame at all", not "where are the N products in this
shelf". Every frame (live) or upload (one-shot) is analysed independently:
first check that gate, then (only if it says "product") decode any barcode
and OCR the whole frame directly for GSTIN/weight/MRP/company/address/
batch/expiry/name, and return one flat JSON result — no per-product boxes,
no track ids, no memory carried between requests.

This file is just the FastAPI wiring (routes, websockets, static pages,
entrypoint); the actual work lives in analyzer.py and services/.
"""

import asyncio
import base64
import os
import warnings

import cv2
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

from analyzer import analyze_image
from config import HERE
from services import ocr_service
from utils import decode_image, encode_preview, frame_signature, local_ip, signatures_close

warnings.filterwarnings("ignore")
load_dotenv()   # picks up ANTHROPIC_API_KEY from a local .env, if present

print("models ready.")

app = FastAPI()

# ------------------------------------------------------------------ display fan-out
displays = set()


async def broadcast(msg):
    # Snapshot: `displays` can change while we await a slow client.
    for ws in list(displays):
        try:
            await ws.send_json(msg)
        except Exception:
            displays.discard(ws)


def page(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


# ------------------------------------------------------------------ routes
@app.get("/", response_class=HTMLResponse)
def display_page():
    url = os.environ.get("PUBLIC_URL", f"http://{local_ip()}:8000") + "/scan"
    return page("display.html").replace("__SCAN_URL__", url)


@app.get("/scan", response_class=HTMLResponse)
def scan_page():
    return page("scan.html")


@app.get("/upload", response_class=HTMLResponse)
def upload_page():
    return page("upload.html")


@app.get("/health")
def health():
    return JSONResponse({"ok": True, "displays": len(displays)})


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    """One-shot barcode/label analysis for a single uploaded photo. Kept as
    a plain request/response JSON API — separate from the /ws/scan live
    stream — so it's easy to call from anywhere (curl, another service, a
    future mobile app) without speaking the scan protocol.
    """
    data = await file.read()
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, analyze_image, data)
    except Exception as e:
        return JSONResponse(
            {"valid": False, "message": f"analysis failed: {e}",
             "codes": [], **ocr_service.label_payload(None), "hint": None},
            status_code=500)
    result.pop("image", None)   # never needed by the upload page itself
    return JSONResponse(result)


@app.websocket("/ws/display")
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


@app.websocket("/ws/scan")
async def ws_scan(ws: WebSocket):
    await ws.accept()
    loop = asyncio.get_running_loop()
    # Per-connection only (not global) — one phone holding steady on a
    # product shouldn't reuse a result some other phone found, and a fresh
    # connection shouldn't inherit a stale one either. See utils.frame_signature.
    last_sig, last_result = None, None
    try:
        while True:
            data = await ws.receive_text()
            try:
                jpg = base64.b64decode(data.split(",")[-1])
                img = decode_image(jpg)
                if img is None:
                    raise ValueError("couldn't read that as an image file")
                want_image = bool(displays)
                sig = frame_signature(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
                if last_result is not None and signatures_close(sig, last_sig):
                    # Same shot as last frame (phone held steady on one
                    # product) — skip re-running OCR/LLM and reuse what we
                    # already found for it; still refresh the display preview
                    # so the picture on screen isn't visibly frozen.
                    result = dict(last_result)
                    result["latency_ms"] = 0
                    if want_image:
                        result["image"] = encode_preview(img, img.shape[1])
                else:
                    # allow_llm=False: a live frame's round trip gates the phone's
                    # next capture (request/response pump), so a blocking LLM
                    # call here would stall the whole live feed, not just one frame.
                    result = await loop.run_in_executor(
                        None, analyze_image, jpg, want_image, False, img)
                    if result["valid"]:
                        last_sig, last_result = sig, result
            except Exception as e:
                # One bad frame must not kill the stream: ack and keep going.
                print("frame error:", type(e).__name__, e)
                result = {"valid": False, "message": f"frame error: {e}",
                          "codes": [], **ocr_service.label_payload(None), "hint": None,
                          "latency_ms": 0, "image": None, "error": str(e)}

            # The phone only needs the extracted fields — shipping the JPEG
            # back up its own uplink was pure waste and added latency.
            phone_msg = {k: v for k, v in result.items() if k != "image"}
            await ws.send_json(phone_msg)
            await broadcast(result)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print("scan socket closed:", type(e).__name__, e)


if __name__ == "__main__":
    import uvicorn

    ip = local_ip()
    print(f"\n  display : http://localhost:8000")
    print(f"  scanner : http://{ip}:8000/scan")
    print("  (phone cameras need HTTPS unless on localhost — front with ngrok "
          "and set PUBLIC_URL)\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)
