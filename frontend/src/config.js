// Same-origin by default: requests go to whatever host/port/scheme the page
// itself was loaded from, and vite.config.js proxies /ws and /api through to
// the FastAPI backend on :8000. This is what makes a single ngrok tunnel (on
// the frontend's port) work — ngrok maps one URL to one local port, so the
// app can't reach a hardcoded ":8000" through the tunnel; it has to look
// like one server from the outside. Set VITE_BACKEND_URL to point elsewhere
// (e.g. a separately deployed backend) when that's not the case.
const override = import.meta.env.VITE_BACKEND_URL

export const BACKEND_HTTP_BASE = override || ''
export const BACKEND_WS_BASE = override
  ? override.replace(/^http/, 'ws')
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`

export function wsUrl(path) {
  return `${BACKEND_WS_BASE}${path}`
}

export function httpUrl(path) {
  return `${BACKEND_HTTP_BASE}${path}`
}

// The Display page's QR codes need the URL a *phone* should use, which is
// only ever the same as `window.location.origin` when that's the ngrok (or
// LAN) URL — opening the Display page itself via localhost would otherwise
// bake "localhost" into the QR code, which resolves to the phone itself
// once scanned, not this computer. Set VITE_PUBLIC_URL (e.g. to the ngrok
// URL) to pin the QR target regardless of which URL you personally have
// the Display page open at.
export const PUBLIC_URL_OVERRIDE = import.meta.env.VITE_PUBLIC_URL || null

export function isLocalOrigin() {
  return ['localhost', '127.0.0.1'].includes(window.location.hostname)
}
