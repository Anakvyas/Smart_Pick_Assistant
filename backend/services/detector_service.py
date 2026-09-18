"""Product/empty-shelf gate, run before barcode+OCR on every frame (live and
upload alike): a YOLOv8 model fine-tuned specifically on "product" vs.
"empty" shelf crops (foduucom/product-detection-in-shelf-yolov8, exported
to ONNX so this only needs onnxruntime at runtime — already a dependency
via RapidOCR — instead of a permanent torch/ultralytics install). Its two
classes map directly to what we want to know, so there's no heuristic
stacked on top of a generic detector's boxes. Loaded once at import and
reused across every request.

Wrapped in try/except and never fatal: if the .onnx file is ever missing
or fails to load, `_session` stays None and `detect_product` below treats
every frame as containing a product (i.e. the gate just doesn't gate) — the
app should still work exactly as before this feature, just without the
compute savings on empty shelves.
"""

import cv2
import numpy as np
import onnxruntime as ort

from config import (
    USE_YOLO_GATE, PRODUCT_MODEL_PATH, PRODUCT_INPUT_SIZE,
    PRODUCT_CONF_THRESHOLD, EMPTY_CONF_THRESHOLD,
)

_CLASS_NAMES = {0: "empty", 1: "product"}

_session = None
_input_name = None
if USE_YOLO_GATE:
    try:
        _session = ort.InferenceSession(PRODUCT_MODEL_PATH, providers=["CPUExecutionProvider"])
        _input_name = _session.get_inputs()[0].name
        print(f"product gate: enabled ({PRODUCT_MODEL_PATH})")
    except Exception as e:
        print(f"product gate: disabled ({type(e).__name__}: {e})")
else:
    print("product gate: disabled (USE_YOLO_GATE = False)")


# Plain cv2.resize to a square would squash a non-square phone frame's
# aspect ratio, distorting exactly the object shapes the model was trained
# to recognise. Letterbox instead: scale to fit inside 640x640 and pad the
# rest with mid-gray, matching how ultralytics itself preprocesses for
# training/inference so the exported ONNX model sees what it expects.
def _letterbox(img, size=PRODUCT_INPUT_SIZE, pad_color=114):
    h, w = img.shape[:2]
    scale = min(size / h, size / w)
    nh, nw = int(round(h * scale)), int(round(w * scale))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), pad_color, dtype=np.uint8)
    top, left = (size - nh) // 2, (size - nw) // 2
    canvas[top:top + nh, left:left + nw] = resized
    return canvas


def detect_product(img):
    """Is there a product in this frame, or is it an empty shelf? Returns
    just enough for the caller to decide whether the rest of the pipeline
    (barcode + OCR) is worth running at all.

    Looks at `product_conf`/`empty_conf` independently (the max score either
    class reaches at any anchor) rather than only trusting whichever class
    wins the per-anchor argmax — see the threshold comments in config.py for
    why: a frame only counts as empty when the model is confidently sure of
    that *and* isn't also seeing a product, everything else defaults to
    "product" and falls through to the normal flow.

    Gate disabled (`_session` is None, see the load-time comment above):
    always reports a product present, so callers fall through to the normal
    barcode+OCR flow exactly as if this gate didn't exist.
    """
    if _session is None:
        return {"is_product": True, "product_conf": None, "empty_conf": None}
    blob = cv2.cvtColor(_letterbox(img), cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    blob = np.transpose(blob, (2, 0, 1))[None, ...]
    # (1, 4+num_classes, num_anchors) -> (num_anchors, 4+num_classes): the
    # first 4 columns are box coords we don't need for a presence-only gate
    # (no boxes are drawn from this), the rest are per-class confidences —
    # YOLOv8's detection head has no separate objectness score to fold in.
    preds = _session.run(None, {_input_name: blob})[0][0].T
    empty_conf = float(preds[:, 4].max())
    product_conf = float(preds[:, 5].max())
    is_product = not (empty_conf >= EMPTY_CONF_THRESHOLD and product_conf < PRODUCT_CONF_THRESHOLD)
    return {"is_product": is_product, "product_conf": product_conf, "empty_conf": empty_conf}
