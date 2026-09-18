import { FIELD_KEYS } from './productFields'

// Shared by the live camera scanner (Scan.jsx) and the per-order picker
// (ScanDialog.jsx) — the same two problems ("noisy single-field OCR reads
// treated as real products" and "the displayed result flickers frame to
// frame instead of settling") show up identically in both, so both should
// fix them the exact same way rather than drifting into two slightly
// different heuristics over time.

export const normalizeName = (s) => (s ? s.toLowerCase().replace(/[^a-z0-9]+/g, '') : '')

// A name with no barcode and no other corroborating field is the weakest
// signal the pipeline produces — it's "biggest legible text in frame",
// which just as happily reads a stray background label as a real product
// name (see Display.jsx's identical hasCorroboration reasoning).
const OTHER_FIELDS = FIELD_KEYS.filter((k) => k !== 'name' && k !== 'barcode')
export function isTrustworthyRead(r) {
  if (r.codes && r.codes.length) return true
  if (!r.name) return false
  return OTHER_FIELDS.some((k) => r[k])
}

// Accumulates fields across consecutive trustworthy frames into one stable
// result instead of showing whatever the single latest frame happened to
// carry — a barcode decode and the label's OCR fields often land on
// different frames a beat apart. Keyed on barcode when one's been seen
// (the strongest identity signal), falling back to the normalised name
// until a barcode shows up. First-seen-wins per field: once a field is
// filled in, a later, possibly-noisier frame can't overwrite it, which is
// what keeps the displayed name/value stable instead of flickering.
export function mergeFrame(buf, r) {
  const key = r.barcode || normalizeName(r.name)
  if (!key) return buf

  // Only reset for *actual* evidence of a different physical product —
  // two different barcodes, or (with no barcode on either side yet) two
  // names that don't overlap at all. A frame that simply lacks a barcode
  // the buffer already has, or that's the first to *introduce* one, is not
  // a conflict — it's the barcode reader and OCR landing on different
  // frames of the same product, and should upgrade the buffer in place
  // rather than throw its accumulated fields away.
  const rNameKey = normalizeName(r.name)
  const isDifferentProduct = buf && (
    (buf.barcode && r.barcode && buf.barcode !== r.barcode) ||
    (!buf.barcode && !r.barcode && buf.key && rNameKey &&
      !buf.key.includes(rNameKey) && !rNameKey.includes(buf.key))
  )

  if (!buf || isDifferentProduct) {
    buf = { key, valid: true, codes: [], barcode: null, barcode_type: null, latency_ms: null }
    for (const k of FIELD_KEYS) buf[k] = null
  }
  if (r.barcode) { buf.barcode = r.barcode; buf.barcode_type = r.barcode_type; buf.key = r.barcode }
  if (r.codes?.length) buf.codes = r.codes
  for (const k of FIELD_KEYS) if (r[k] && !buf[k]) buf[k] = r[k]
  buf.latency_ms = r.latency_ms
  return buf
}
