import { useEffect, useRef, useState } from 'react'
import { useSocket } from '../hooks/useSocket'
import QrCode from '../components/QrCode'
import { FIELD_KEYS, FIELD_LABELS } from '../lib/productFields'
import './Display.css'

const norm = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')

export default function Display() {
  const imgRef = useRef(null)
  const overlayRef = useRef(null)
  const boxesRef = useRef([])
  const lastAtRef = useRef(0)
  const timesRef = useRef([])
  const [imageSrc, setImageSrc] = useState(null)
  const [itemInFrame, setItemInFrame] = useState(null)
  const [latency, setLatency] = useState('')
  const [fps, setFps] = useState('')
  const [scanHint, setScanHint] = useState('')
  // Inventory persists across frames, keyed by whatever's most stable in a
  // frame (barcode, then GSTIN, then a normalised name) so the same
  // physical item updates one row instead of spawning a new one each frame.
  const [inventory, setInventory] = useState(new Map())
  // Ticks every 500ms purely to re-check which items are still "fresh"
  // (< 1.5s old) — Date.now() itself must stay out of the render body.
  const [now, setNow] = useState(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
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
    setScanHint(r.hint || '')

    if (r.valid) {
      const primary = r.codes && r.codes[0]
      const key = primary ? primary.kind + '|' + primary.value
        : r.gstin ? 'GSTIN|' + r.gstin
        : r.name ? 'OCR|' + norm(r.name)
        : null
      if (!key) return

      setInventory((prev) => {
        const next = new Map(prev)
        const existing = next.get(key)
        const fields = {}
        for (const k of FIELD_KEYS) fields[k] = r[k] || existing?.[k] || null
        next.set(key, {
          kind: primary ? primary.kind : 'OCR',
          value: primary ? primary.value : (r.name || 'scanned item'),
          ...fields,
          count: (existing?.count || 0) + 1,
          at: Date.now(),
        })
        return next
      })
    }
  })

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
      ctx.font = '600 13px system-ui, sans-serif'
      ctx.textBaseline = 'top'
      ctx.strokeStyle = '#25d366'

      for (const b of boxesRef.current) {
        const x = b.box.x * w, y = b.box.y * h, bw = b.box.w * w, bh = b.box.h * h
        ctx.strokeRect(x, y, bw, bh)
        const text = b.kind + ' · ' + b.value
        const tw = ctx.measureText(text).width
        const ty = y > 20 ? y - 19 : y + bh + 2
        ctx.fillStyle = '#25d366'
        ctx.fillRect(x, ty, tw + 10, 18)
        ctx.fillStyle = '#04120a'
        ctx.fillText(text, x + 5, ty + 2)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const items = [...inventory.values()].sort((a, b) => b.at - a.at)

  const connText = status !== 'open'
    ? (status === 'connecting' ? 'connecting…' : 'reconnecting…')
    : itemInFrame === null ? 'waiting for a scanner…' : itemInFrame ? 'item in frame' : 'no item in frame'

  const scanUrl = `${window.location.origin}/scan`

  return (
    <div className="display-page">
      <div className="left">
        <div className="stage">
          <img ref={imgRef} id="frame" alt="" src={imageSrc || undefined} />
          <canvas ref={overlayRef} className="ov" />
        </div>
        <div className="meta">
          <span className="conn">{connText}</span>
          <span className="lat">{latency}</span>
          <span className="fps">{fps}</span>
          <span className="scanhint">{scanHint}</span>
        </div>
        <div className="qr-row">
          <QrCode value={scanUrl} label="scan on your phone" size={140} />
        </div>
      </div>
      <div className="right">
        <h2>Detected items</h2>
        <div className="sub">
          <span>{items.length ? `${items.length} unique item${items.length > 1 ? 's' : ''}` : 'nothing yet'}</span>
          <button onClick={() => setInventory(new Map())}>clear</button>
        </div>
        <div className="items">
          {items.length === 0 && <div className="item muted">nothing detected yet</div>}
          {items.map((i, idx) => {
            const rows = FIELD_KEYS.filter((k) => i[k])
            return (
              <div key={idx} className={`item${now != null && now - i.at < 1500 ? ' fresh' : ''}`}>
                <span className="k">{i.kind}</span> — {i.value}
                {rows.length === 0
                  ? <div className="exp none">no label info found</div>
                  : rows.map((k) => <div className="exp" key={k}>{FIELD_LABELS[k]}: {i[k]}</div>)}
                <div className="seen">seen {i.count}×</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
