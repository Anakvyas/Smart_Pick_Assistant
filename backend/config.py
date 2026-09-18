"""Shared paths and tunables for every service module. Nothing here does
work on its own — it's just the constants the services below are built
around, kept in one place so a threshold or model path never has to be
hunted down across files.
"""

import os

HERE = os.path.dirname(os.path.abspath(__file__))
DEMO_DIR = os.path.join(HERE, "demo")

# --------------------------------------------------------- product gate ---
# One switch for the whole product/empty-shelf gate feature: True runs it
# (skip barcode+OCR on frames it calls empty), False skips loading the
# model entirely and analyze_image runs exactly as it did before this
# feature existed — no gate call, no startup cost, no behavior change. Flip
# this first whenever the gate itself is in question, rather than fighting
# its thresholds.
USE_YOLO_GATE = True

# "weights/", not "models/" — this project also has a models/ package now
# (the SQLAlchemy User/Order classes for the auth+orders feature), and
# naming both the same thing was just confusing, not a real conflict.
PRODUCT_MODEL_PATH = os.path.join(HERE, "weights", "product_shelf_yolov8.onnx")

# 320, not 640: this gate only needs to answer yes/no, not localise anything
# precisely, and halving the input side cuts the CPU inference cost ~4x for
# a live-scan frame rate that visibly suffered at 640.
PRODUCT_INPUT_SIZE = 320

# This model was trained on wide shelf-facing photos (many small products
# across a shelf), not the close-up macro shots this app's phone camera
# actually sends it — a real single product filling most of the frame often
# doesn't score as confidently "product" as the training distribution would.
# Blocking the whole scan flow on a false "empty" read is a much worse user
# experience than occasionally running OCR on a genuinely empty frame (that
# OCR pass just comes back with nothing, same as before this gate existed) —
# so the bar for calling a frame *empty* is deliberately high, and anything
# that doesn't clear it falls through to the normal flow. Tune both against
# the "gate:" score lines detector_service prints per frame, not blind
# guesses.
PRODUCT_CONF_THRESHOLD = 0.15   # product score at or above this -> let it through
EMPTY_CONF_THRESHOLD = 0.60     # empty score must clear this AND product miss above to call it empty

# ------------------------------------------------------------ LLM fallback
# Runs against a local Ollama server (http://localhost:11434) instead of a
# hosted API — OpenRouter's free tier turned out to cap *all* ":free" models
# combined at 50 requests/day per account, shared across every model, with no
# UPI/PhonePe way to pay for more from India. A local model sidesteps all of
# that: no rate limit, no cost, no network dependency, and (measured on this
# machine, an M4 Pro) actually faster than the hosted free models were —
# ~0.6s warm per call for qwen2.5:3b-instruct vs. 2-8s on OpenRouter, with no
# hidden "reasoning" tokens eating the completion budget the way two of the
# OpenRouter free models did. Requires `ollama serve` running locally with
# OLLAMA_MODEL pulled (`ollama pull qwen2.5:3b-instruct`); llm_service
# disables this automatically if the server isn't reachable, so the app
# still works exactly as before, just without this extra pass.
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/v1/chat/completions")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b-instruct")

# Bounds worst-case call volume during live scanning (many frames a minute
# can each miss regex) without reintroducing per-connection state — a single
# global cooldown, checked right before every call. Less critical than it
# was against a rate-limited hosted API, but still worth keeping: several
# /api/analyze uploads landing close together would otherwise queue up on
# the same local model instance instead of just skipping the extra pass.
LLM_COOLDOWN_SEC = 2.0
