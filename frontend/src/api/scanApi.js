import { httpUrl } from '../config'

// One-shot photo analysis (POST /api/analyze) — shared by every place that
// lets someone submit a still photo into the scan pipeline (phone capture,
// phone gallery pick, PC upload), so the multipart-encoding details only
// live in one spot.
export function analyzePhoto(blob, filename = 'pick.jpg') {
  const form = new FormData()
  form.append('file', blob, filename)
  return fetch(httpUrl('/api/analyze'), { method: 'POST', body: form })
    .then((res) => {
      if (!res.ok) throw new Error(`server returned ${res.status}`)
      return res.json()
    })
}
