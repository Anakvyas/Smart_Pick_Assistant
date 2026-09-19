import { httpUrl } from '../config'

// One-shot photo analysis (POST /api/analyze) — shared by every place that
// lets someone submit a still photo into the scan pipeline (phone capture,
// phone gallery pick, PC upload), so the multipart-encoding details only
// live in one spot. `orderId`, when given, also gets this broadcast to
// that order's /ws/display/{orderId} channel server-side (see
// routes/scan.py) — the same live "what's the phone looking at" feed the
// camera pump already writes to, so a Capture/Gallery photo shows up on
// the PC watch screen too, not just continuous live frames. Omit it for
// callers with no order context (the global /scan page, /demo).
export function analyzePhoto(blob, filename = 'pick.jpg', orderId) {
  const form = new FormData()
  form.append('file', blob, filename)
  if (orderId) form.append('order_id', orderId)
  return fetch(httpUrl('/api/analyze'), { method: 'POST', body: form })
    .then((res) => {
      if (!res.ok) throw new Error(`server returned ${res.status}`)
      return res.json()
    })
}
