"""Small helpers shared across services and app.py — image decode/encode
and the live-scan frame-similarity hash, plus the LAN-IP lookup used to
print the scanner URL at startup. Nothing here is specific to any one
service, which is what keeps it out of services/.
"""

import base64
import socket

import cv2
import numpy as np


def decode_image(img_bytes):
    return cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)


def encode_preview(img, w):
    scale = 640 / max(w, 1)
    out = cv2.resize(img, (int(w * scale), int(img.shape[0] * scale))) if scale < 1 else img
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 60])
    return base64.b64encode(buf).decode() if ok else None


# A phone held on the same product sends a stream of near-identical frames —
# without some way to notice that, /ws/scan re-runs the full OCR pass (and,
# once regex misses, an LLM call) on every single one, for a result that's
# already been found. Not a job for a learned model (LSTM etc.) — there's no
# sequence pattern to learn here, just "is this basically the same shot as
# last time", which a cheap perceptual hash answers directly: shrink to a
# tiny grayscale thumbnail and threshold each pixel against the thumbnail's
# own mean, giving a fixed-size bit pattern that barely changes under normal
# hand shake/re-exposure but flips a lot once the camera moves to a
# different product.
def frame_signature(gray):
    small = cv2.resize(gray, (16, 16), interpolation=cv2.INTER_AREA)
    return small > small.mean()


# `max_diff_bits` is a fraction of the 16x16=256 bit signature — tight
# enough that a genuinely different label doesn't get treated as "the same
# frame".
def signatures_close(a, b, max_diff_bits=10):
    return a is not None and b is not None and int(np.count_nonzero(a != b)) <= max_diff_bits


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip
