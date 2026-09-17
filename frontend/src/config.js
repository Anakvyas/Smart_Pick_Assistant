// Same-origin by default: requests go to whatever host/port/scheme the page
// itself was loaded from, and vite.config.js proxies /ws and /upload through
// to the backend on :8000. This is what makes a single ngrok tunnel (on the
// frontend's port) work — ngrok maps one URL to one local port, so the app
// can't reach a hardcoded ":8000" through the tunnel; it has to look like
// one server from the outside. Set VITE_BACKEND_URL to point elsewhere
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
