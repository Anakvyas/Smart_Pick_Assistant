import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSocket } from '../hooks/useSocket'
import QrCode from '../components/QrCode'
import ResultPanel from '../components/ResultPanel'
import AuthStatus from '../components/AuthStatus'
import { FIELD_KEYS, FIELD_LABELS } from '../lib/productFields'
import { PUBLIC_URL_OVERRIDE, isLocalOrigin, httpUrl } from '../config'
import './Display.css'

const norm = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')

// How long a newly-seen item waits for the rest of its fields (OCR often
// takes a frame or two longer than the barcode decode) before it's allowed
// onto the visible list anyway. Long enough to usually catch a same-product
// frame that lands a moment later, short enough that "fast" doesn't turn
// into a visible stall.
const REVEAL_WINDOW_MS = 200

const isComplete = (fields) => FIELD_KEYS.every((k) => fields[k])

// A name-only OCR guess (no barcode/GSTIN/batch in the same frame) is the
// weakest signal this pipeline produces — it's literally "biggest legible
// text in frame", which just as happily picks up stray background text
// (a keyboard's "caps lock" label, someone's name on a monitor) as a real
// product name when nothing else on the label was readable. Requiring at
// least one corroborating field (weight/mrp/expiry/company/address/mfg
// date) before trusting a name-only key is what keeps that noise out of
// the list entirely, rather than each stray read spawning its own row.
const OTHER_FIELDS = FIELD_KEYS.filter((k) => k !== 'name')
const hasCorroboration = (fields) => OTHER_FIELDS.some((k) => fields[k])

export default function Display() {
  const imgRef = useRef(null)
  const overlayRef = useRef(null)
  const boxesRef = useRef([])
  const lastAtRef = useRef(0)
  const timesRef = useRef([])
  const fileInputRef = useRef(null)
  const [imageSrc, setImageSrc] = useState(null)
  const [itemInFrame, setItemInFrame] = useState(null)
  const [noProduct, setNoProduct] = useState(false)
  const [latency, setLatency] = useState('')
  const [fps, setFps] = useState('')
  const [scanHint, setScanHint] = useState('')
  // Inventory persists across frames, keyed by whatever's most stable in a
  // frame (barcode, then GSTIN, then a normalised name) so the same
  // physical item updates one row instead of spawning a new one each frame.
  const [inventory, setInventory] = useState(new Map())
  // Keys already showing in `inventory` — checked synchronously from the
  // socket handler, so it can't rely on the (possibly stale, possibly
  // batched) `inventory` state value itself.
  const publishedRef = useRef(new Set())
  // A key not yet on the visible list buffers its fields here (outside
  // React state, so accumulating them doesn't cause a re-render every
  // frame) until REVEAL_WINDOW_MS elapses or every known field has shown
  // up, whichever comes first — see revealItem below.
  const pendingRef = useRef(new Map())
  // Ticks every 500ms purely to re-check which items are still "fresh"
  // (< 1.5s old) — Date.now() itself must stay out of the render body.
  const [now, setNow] = useState(null)

  // A photo picked/dropped straight on this (PC) screen, analyzed as a
  // one-off request through the same /api/analyze the phone's upload
  // button uses — so a laptop with no camera can still try the pipeline
  // without needing a phone at all.
  const [upload, setUpload] = useState(null) // { status, previewUrl, result, error }
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const revealItem = useCallback((key) => {
    const entry = pendingRef.current.get(key)
    if (!entry) return
    pendingRef.current.delete(key)
    // A name-only key that never picked up a corroborating field doesn't
    // get published at all — deliberately dropped rather than marked
    // "seen", so if a *later*, unrelated frame happens to read the same
    // stray text again, it starts a fresh buffer instead of instantly
    // reusing (and re-trusting) this one.
    if (key.startsWith('OCR|') && !hasCorroboration(entry.fields)) return
    publishedRef.current.add(key)
    setInventory((prev) => {
      const next = new Map(prev)
      next.set(key, { kind: entry.kind, value: entry.value, ...entry.fields, count: 1, at: Date.now() })
      return next
    })
  }, [])

  const { status } = useSocket('/ws/display', (data) => {
    let r
    try { r = JSON.parse(data) } catch { return }

    if (r.image) setImageSrc('data:image/jpeg;base64,' + r.image)
    boxesRef.current = r.codes || []
    const now = performance.now()
    lastAtRef.current = now

    timesRef.current.push(now)
    while (timesRef.current.length && now - timesRef.current[0] > 2000) timesRef.current.shift()
    setFps((timesRef.current.length / 2).toFixed(1) + ' fps')
    setLatency((r.latency_ms ?? '—') + ' ms')
    setItemInFrame(!!r.valid)
    setNoProduct(r.product_detected === false || r.hint_kind === 'no_product')
    setScanHint(r.hint_kind === 'no_product' ? '' : r.hint || '')

    if (r.valid) {
      // Batch code ranks above a raw name guess: two frames that land on
      // different fragments of the same pack as "name" (a tagline here, the
      // flavour name there) still print the identical batch code, so keying
      // on it — when there's no barcode/GSTIN to key on instead — is what
      // actually clubs those reads into one row instead of one each.
      const primary = r.codes && r.codes[0]
      const key = primary ? primary.kind + '|' + primary.value
        : r.gstin ? 'GSTIN|' + r.gstin
        : r.batch ? 'BATCH|' + norm(r.batch)
        : r.name ? 'OCR|' + norm(r.name)
        : null
      if (!key) return

      const kind = primary ? primary.kind : 'OCR'
      const value = primary ? primary.value : (r.name || 'scanned item')

      if (publishedRef.current.has(key)) {
        // Already on the list — keep it live, same as before.
        setInventory((prev) => {
          const next = new Map(prev)
          const existing = next.get(key)
          if (!existing) return prev
          const fields = {}
          for (const k of FIELD_KEYS) fields[k] = r[k] || existing[k] || null
          next.set(key, { ...existing, ...fields, count: existing.count + 1, at: Date.now() })
          return next
        })
        return
      }

      // First sighting of this item — buffer it rather than publishing a
      // near-empty row immediately (a barcode alone with no label text
      // read yet). Merge every new field into the pending entry as more
      // frames arrive; reveal early the moment it's fully filled in.
      let entry = pendingRef.current.get(key)
      if (!entry) {
        entry = { kind, value, fields: {} }
        pendingRef.current.set(key, entry)
        entry.timer = setTimeout(() => revealItem(key), REVEAL_WINDOW_MS)
      }
      for (const k of FIELD_KEYS) if (r[k]) entry.fields[k] = r[k]
      if (isComplete(entry.fields)) {
        clearTimeout(entry.timer)
        revealItem(key)
      }
    }
  })

  // Pending timers must not fire (or leak) past unmount, and a manual
  // "clear" should let a still-in-frame item re-buffer and reappear rather
  // than silently refusing to republish a key it thinks is already shown.
  const clearInventory = useCallback(() => {
    for (const entry of pendingRef.current.values()) clearTimeout(entry.timer)
    pendingRef.current.clear()
    publishedRef.current.clear()
    setInventory(new Map())
  }, [])

  useEffect(() => () => {
    for (const entry of pendingRef.current.values()) clearTimeout(entry.timer)
  }, [])

  useEffect(() => {
    let raf
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const img = imgRef.current, ov = overlayRef.current
      if (!img || !ov) return
      const w = img.clientWidth, h = img.clientHeight
      if (!w || !h) return
      if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h }
      const ctx = ov.getContext('2d')
      ctx.clearRect(0, 0, w, h)

      if (performance.now() - lastAtRef.current > 2500) return

      ctx.lineWidth = 2.5
      ctx.font = '600 13px Inter, system-ui, sans-serif'
      ctx.textBaseline = 'top'
      ctx.strokeStyle = '#0f9d63'

      for (const b of boxesRef.current) {
        const x = b.box.x * w, y = b.box.y * h, bw = b.box.w * w, bh = b.box.h * h
        ctx.strokeRect(x, y, bw, bh)
        const text = b.kind + ' · ' + b.value
        const tw = ctx.measureText(text).width
        const ty = y > 20 ? y - 19 : y + bh + 2
        ctx.fillStyle = '#0f9d63'
        ctx.fillRect(x, ty, tw + 10, 18)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(text, x + 5, ty + 2)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const analyzeFile = useCallback((file) => {
    if (!file) return
    setUpload({ status: 'loading', previewUrl: URL.createObjectURL(file), result: null, error: null })
    const form = new FormData()
    form.append('file', file)
    fetch(httpUrl('/api/analyze'), { method: 'POST', body: form })
      .then((res) => {
        if (!res.ok) throw new Error(`server returned ${res.status}`)
        return res.json()
      })
      .then((result) => setUpload((u) => ({ ...u, status: 'done', result })))
      .catch((err) => setUpload((u) => ({ ...u, status: 'error', error: err.message })))
  }, [])

  function onFilePicked(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    analyzeFile(file)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    analyzeFile(e.dataTransfer.files?.[0])
  }

  const items = [...inventory.values()].sort((a, b) => b.at - a.at)

  const connText = status !== 'open'
    ? (status === 'connecting' ? 'connecting…' : 'reconnecting…')
    : itemInFrame === null ? 'waiting for a scanner…' : itemInFrame ? 'item in frame' : 'no item in frame'

  // A QR code built from `window.location.origin` only reaches a phone
  // when that origin itself is phone-reachable (the ngrok URL, or a LAN
  // IP) — opening this page via localhost would otherwise bake
  // "localhost" into the code, which resolves to the phone itself once
  // scanned, not this computer. VITE_PUBLIC_URL pins the QR target
  // regardless of which URL this browser tab happens to be on.
  const scanUrl = `${PUBLIC_URL_OVERRIDE || window.location.origin}/scan`
  const showLocalWarning = !PUBLIC_URL_OVERRIDE && isLocalOrigin()

  return (
    <div className="display-page">
      <div className="left">
        <header className="app-header">
          <div className="brand">
            <span className="brand-dot" />
            Smart Pick <span className="brand-sub">display</span>
          </div>
          <div className="header-right">
            <AuthStatus />
            <Link to="/demo" className="demo-link">view demo products</Link>
          </div>
        </header>

        <div className="stage">
          {imageSrc
            ? <img ref={imgRef} id="frame" alt="" src={imageSrc} />
            : <div className="stage-empty skeleton" />}
          <canvas ref={overlayRef} className="ov" />
          {!imageSrc && (
            <div className="stage-empty-label">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 15 4.5-4.5a2 2 0 0 1 2.8 0L15 15" />
                <circle cx="16" cy="9" r="1.5" />
              </svg>
              waiting for a scanner to connect…
            </div>
          )}
          {noProduct && (
            <div className="no-product-overlay">
              <div className="no-product-badge">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M8 11h6" />
                </svg>
                NO PRODUCT DETECTED
              </div>
            </div>
          )}
        </div>
        <div className="meta">
          <span className={`status-pill ${status !== 'open' ? 'neutral' : itemInFrame ? 'success' : 'neutral'}`}>
            <span className="dot" />{connText}
          </span>
          <span className="lat">{latency}</span>
          <span className="fps">{fps}</span>
          {scanHint && <span className="scanhint">{scanHint}</span>}
        </div>
        <div className="qr-row">
          <QrCode value={scanUrl} label="scan on your phone" size={140} />
          <div className="or-divider"><span>or</span></div>
          <div
            className={`dropzone${dragOver ? ' drag' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </svg>
            <span className="dropzone-text">Upload a photo from this computer</span>
            <span className="dropzone-sub">click or drag &amp; drop</span>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={onFilePicked} hidden />
        </div>
        {showLocalWarning && (
          <div className="local-warning">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            This page is open at <code>{window.location.host}</code> — a phone can't
            reach "localhost", so this QR code won't work. Open this page through your
            ngrok URL instead (or your LAN IP, printed by <code>npm run dev</code>), or
            set <code>VITE_PUBLIC_URL</code> in <code>frontend/.env</code>.
          </div>
        )}

        {upload && (
          <div className="upload-panel">
            <div className="upload-panel-head">
              <img src={upload.previewUrl} alt="Uploaded product" />
              <button className="close-btn" onClick={() => setUpload(null)} aria-label="Close">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="upload-panel-body">
              {upload.status === 'loading' && (
                <p className="state"><span className="spinner brand" aria-hidden="true" />analyzing…</p>
              )}
              {upload.status === 'error' && <p className="state error">Couldn't analyze that photo: {upload.error}</p>}
              {upload.status === 'done' && <ResultPanel result={upload.result} />}
            </div>
          </div>
        )}
      </div>
      <div className="right">
        <h2>Detected items</h2>
        <div className="sub">
          <span>{items.length ? `${items.length} unique item${items.length > 1 ? 's' : ''}` : 'nothing yet'}</span>
          <button onClick={clearInventory}>clear</button>
        </div>
        <div className="items">
          {items.length === 0 && (
            <div className="empty-items">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 7l9-4 9 4-9 4-9-4Z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" />
              </svg>
              nothing detected yet
            </div>
          )}
          {items.map((i, idx) => {
            const rows = FIELD_KEYS.filter((k) => i[k])
            const isFresh = now != null && now - i.at < 1500
            return (
              <div key={idx} className={`item${isFresh ? ' fresh' : ''}`}>
                <div className="item-head">
                  <span className="k">{i.kind}</span>
                  {isFresh && <span className="status-pill success"><span className="dot" />live</span>}
                </div>
                <div className="item-value">{i.value}</div>
                {rows.length === 0
                  ? <div className="exp none">no label info found</div>
                  : rows.map((k) => <div className="exp" key={k}><span>{FIELD_LABELS[k]}</span>{i[k]}</div>)}
                <div className="seen">seen {i.count}×</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
