# Smart Picker

A warehouse/retail "picking" app: a picker gets a list of products on an
order, scans each one with a phone camera (or uploads a photo), and the
app reads the barcode and label to confirm it's the right product —
line by line, until the order is complete.

It's also a small AI pipeline in its own right: barcode decoding, OCR,
and an optional local LLM fallback all work together to turn a photo of
a product into structured data (name, barcode, GSTIN, weight, MRP,
expiry, etc.).

---

## How it's built

```
frontend/   React + Vite — the picker UI, admin order builder, live scan screen
backend/    FastAPI (Python) — the API, the scan pipeline, the database
```

The frontend never talks to the backend on a different port directly —
Vite proxies `/api` and `/ws` through to the backend, so in dev the whole
app looks like one server on `http://localhost:5173`. This is also what
lets a single ngrok tunnel expose the whole thing to a phone.

---

## The image pipeline — what happens to a photo

This is the core of the app. Whether the photo comes from a live camera
frame or a single upload, it goes through the exact same steps
(`backend/services/analyzer.py`):

```
 1. Camera / photo upload
        │
        ▼
 2. (optional) "Is there even a product in this frame?"
        A small YOLO model checks for an empty shelf and skips the
        expensive steps below if there's nothing there. Off by default
        locally (needs a model file most setups won't have — see below).
        │
        ▼
 3. Barcode decode  (zxing-cpp)
        Cheap, so it always runs — looks for any 1D/2D barcode or QR
        code in the frame.
        │
        ▼
 4. OCR the whole frame  (RapidOCR)
        Reads every bit of text on the label.
        │
        ▼
 5. Regex-extract the "shaped" fields from that OCR text
        GSTIN, weight, MRP, expiry, manufacture date, batch, company —
        each has a predictable enough shape for a regex to catch
        reliably. "Name" doesn't have a fixed shape, so it's a
        best-effort guess: the single biggest text on the label that
        isn't one of the other fields.
        │
        ▼
 6. (optional) Local LLM fills in the gaps  (Ollama, e.g. qwen2.5:3b)
        Regex is good at "shaped" fields but bad at free text like
        name/company/address, and can occasionally grab the wrong
        date. A local LLM re-reads the same OCR text and its answer
        wins for those fields when it returns one. This step is
        skipped entirely if Ollama isn't running — the app works fine
        without it, just with slightly rougher label reads.
        │
        ▼
 7. One structured result comes back:
        { barcode, name, gstin, weight, mrp, expiry, company,
          address, batch, valid, hint, ... }
```

That result either just gets shown (the `/demo` and `/scan` pages), or —
when scanning against a real order — gets checked against **the one
item the order currently expects next** (`backend/controllers/
order_controller.py`):

- The scanned barcode/GSTIN must match that item's own code.
- Depending on the order's verification mode, the scanned label/name
  either also has to match ("Strict" — the default) or isn't required
  at all ("Barcode only").
- A match verifies the item and advances the order to the next one. A
  scan of a *different* item further down the list doesn't jump the
  queue — you get told what's actually expected next instead.

---

## Setup

These are the steps *before* you get into frontend- or backend-specific
commands — the things your machine needs regardless of which half
you're running.

### Prerequisites

| Needed | Why |
|---|---|
| Python 3.9+ | Runs the backend |
| Node.js 18+ | Runs the frontend |
| A database | SQLite works out of the box for local dev (zero setup). Postgres is what `auth`/signup-login expects in a real deployment — see `DATABASE_URL` below. |
| Ollama *(optional)* | Only needed for the LLM label-reading fallback. The app runs fine without it. |
| ngrok *(optional)* | Only needed to open the app on an actual phone instead of a desktop browser tab. |

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # then edit .env, see below
python dummy.py                  # seeds a demo picker account + sample orders
uvicorn app:app --reload --port 8000
```

Login the seeded account uses: `picker@example.com` / `12345`.

**`.env` — what actually matters:**
- Nothing is *required* just to try the scanner (`/demo`, `/scan`) — it
  runs with zero config.
- `DATABASE_URL` — defaults to a local SQLite file if unset. Point this
  at Postgres for anything beyond your own laptop.
- `OLLAMA_URL` / `OLLAMA_MODEL` — only matter if you're running Ollama
  locally for the LLM fallback (see below).
- `STRICT_LABEL_VERIFICATION` — the app-wide default for whether a
  scanned barcode alone is enough to verify an item, or whether the
  label has to match too. Individual orders (built via `/admin`) can
  override this per order.
- `JWT_SECRET` — set this to anything before deploying anywhere real;
  the example value is not safe to use as-is.

### 2. (optional) Ollama, for the LLM label-reading fallback

```bash
brew install ollama          # or see ollama.com
ollama serve
ollama pull qwen2.5:3b-instruct
```

If this isn't running, the backend detects that at startup and just
skips this step forever — no crash, no missing feature beyond slightly
rougher name/company reads on messy labels.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. That's the whole app — the frontend dev
server proxies API/WebSocket calls to the backend automatically, so you
don't need a second URL for anything.

### 4. (optional) Open it on your phone

```bash
./ngrok http 5173        # not 8000 — see "how it's built" above
```

Open the printed `https://*.ngrok-free.app` URL on your phone, or scan
the QR code shown on the app's `/` (Display) page.

---

## Everyday commands

```bash
# backend
cd backend && pytest                      # run the test suite
cd backend && python dummy.py             # re-seed demo data (safe to re-run)

# frontend
cd frontend && npm run lint
cd frontend && npm run build
```

---

## Project layout (short version)

```
backend/
  app.py                 entrypoint — wires up all the routes
  services/               the image pipeline itself
    analyzer.py            orchestrates the steps above
    barcode_service.py      barcode/QR decoding
    ocr_service.py           OCR + regex field extraction
    llm_service.py            the Ollama fallback
    detector_service.py        the optional empty-shelf gate
  controllers/, routes/, schemas/, models/, repositories/
                          auth, orders, and the admin order-builder API
  dummy.py                seeds a demo picker + sample orders

frontend/
  src/pages/               one file per screen (Dashboard, Admin, Scan, Demo, Display, Login/Signup)
  src/components/          the scan dialog, order dialogs, shared bits
  src/api/                 thin fetch wrappers per backend resource
```
