"""
Smart Pick backend — composition root only. Wires together two features as
one FastAPI app / one running process:

- Scanner (phone camera in, PC screen out): routes/scan.py + routes/demo.py,
  built on controllers/scan_controller.py and services/ (analyzer.py,
  ocr_service.py, barcode_service.py, detector_service.py, llm_service.py).
  Stateless per request/frame — no database, no auth required.

- Auth (picker signup/login): routes/auth.py, built on
  controllers/auth_controller.py, services/auth_service.py,
  repositories/user_repository.py and models/user.py — needs a real
  Postgres database (DATABASE_URL in .env) to actually work.

Both features share the same layered layout (controllers/, services/,
routes/, plus auth's own db/, models/, repositories/, schemas/, core/,
exceptions/) so there's one consistent structure to read, not "auth is
organized, the scanner is three flat files" — see each folder for its own
piece. This file itself does no request handling of its own: just startup
(env, CORS, exception handlers), mounting every route module, and the
uvicorn entrypoint.
"""
import os
import warnings

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import DEMO_DIR
from core.config import get_settings
from exceptions.handlers import register_exception_handlers
from routes.auth import router as auth_router
from routes.demo import router as demo_router
from routes.orders import router as orders_router
from routes.scan import router as scan_router
from utils import local_ip

warnings.filterwarnings("ignore")
load_dotenv()   # picks up OLLAMA_URL, DATABASE_URL, JWT_SECRET etc. from a local .env, if present

print("models ready.")

app = FastAPI()

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.client_origins,
    # Dev convenience only, never enabled in production (there this must
    # come from an explicit CLIENT_ORIGIN): covers the two ways this app
    # gets opened from somewhere other than plain localhost —
    #  - an ngrok URL, which changes every time the tunnel restarts
    #  - the dashboard itself opened via its LAN IP (Vite's `host: true`
    #    exposes it there) rather than localhost, e.g. from a phone
    # Without this, either one silently breaks every fetch with no error
    # message beyond "the backend isn't responding".
    allow_origin_regex=None if settings.is_production else (
        r"https://.*\.ngrok(-free)?\.(app|dev)"
        r"|https://.*\.ngrok\.io"
        r"|http://(192\.168|10\.\d{1,3}|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(:\d+)?"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
register_exception_handlers(app)

app.include_router(auth_router)
app.include_router(orders_router)
app.include_router(scan_router)
app.include_router(demo_router)

# Serves backend/demo/images/*.png at /demo/images/* — the /api/demo payload
# points at these paths directly, same-origin through Vite's proxy just
# like every other route here, so the demo gallery needs no separate image
# host or CORS setup.
if os.path.isdir(os.path.join(DEMO_DIR, "images")):
    app.mount("/demo/images", StaticFiles(directory=os.path.join(DEMO_DIR, "images")), name="demo-images")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    ip = local_ip()
    print(f"\n  API      : http://localhost:{port}")
    print(f"  from phone: http://{ip}:{port}  (via the frontend dev server's proxy, not this port directly)")
    print("  (phone cameras need HTTPS unless on localhost — front the frontend with ngrok)\n")
    uvicorn.run(app, host="0.0.0.0", port=port)
