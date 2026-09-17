import { useCallback, useEffect, useRef, useState } from 'react'
import { useSocket } from '../hooks/useSocket'
import { httpUrl } from '../config'
import { fieldsLine } from '../lib/productFields'
import './ScanDialog.css'

// How long a valid, in-frame read has to hold steady before we trust it and
// call the item verified — long enough to reject a one-frame fluke (motion
// blur that happens to decode), short enough that a clean read still feels
// instant.
const CONFIRM_HOLD_MS = 550

// If nothing valid has been read in this long since scanning started, stop
// burning the camera/battery and hand the picker an explicit "didn't work"
// screen with a way out, instead of spinning forever.
const NOT_VERIFIED_TIMEOUT_MS = 25000

/**
 * Full-screen scan flow for one order: shows the expected order up top,
 * scans live with the same coaching hints as /scan (too dark, move closer,
 * no product…), then resolves to a Verified or Not Verified screen.
 *
 * There's no per-order product/barcode to check the scan against yet (the
 * backend only tracks order-level counts) — so "verified" here means "a
 * real, confident product read held steady", not "matches this order's
 * specific item". The order number stays pinned at the top the whole time
 * so the picker always knows which order they're scanning against.
 */
export default function ScanDialog({ order, onClose, onVerified }) {
  const videoRef = useRef(null)
  const overlayRef = useRef(null)
  const captureCanvasRef = useRef(document.createElement('canvas'))
  const boxesRef = useRef([])
  const lastResultAtRef = useRef(0)
  const inflightRef = useRef(false)
  const sendRef = useRef(() => false)
  const pumpRef = useRef(() => {})
  const holdTimerRef = useRef(null)
  const stageRef = useRef('starting')

  const [cameraError, setCameraError] = useState(null)
  const [cameraKey, setCameraKey] = useState(0)
  // starting | scanning | verifying | verified | not_verified
  const [stage, setStage] = useState('starting')
  const [hint, setHint] = useState(null)
  const [noProduct, setNoProduct] = useState(false)
  const [result, setResult] = useState(null)
  const [latency, setLatency] = useState(null)
  const [upload, setUpload] = useState({ status: 'idle', error: null })

  useEffect(() => { stageRef.current = stage }, [stage])

  const setStageOnce = useCallback((next) => {
    // Once the dialog has resolved, ignore any further frames in flight —
    // otherwise a late-arriving ack could flip a settled "verified" back
    // to "scanning" right as the picker reads the result.
    if (stageRef.current === 'verified' || stageRef.current === 'not_verified') return
    stageRef.current = next
    setStage(next)
  }, [])

  const pump = useCallback(() => {
    if (inflightRef.current) return
    if (stageRef.current === 'verified' || stageRef.current === 'not_verified') return
    const video = videoRef.current
    if (!video || !video.videoWidth) { setTimeout(() => pumpRef.current(), 100); return }

    const w = 640
    const h = Math.round(video.videoHeight * 640 / video.videoWidth)
    const canvas = captureCanvasRef.current
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(video, 0, 0, w, h)

    canvas.toBlob((blob) => {
      if (!blob) { setTimeout(() => pumpRef.current(), 100); return }
      blob.arrayBuffer().then((buf) => {
        const ok = sendRef.current(buf)
        if (ok) inflightRef.current = true
        else setTimeout(() => pumpRef.current(), 150)
      })
    }, 'image/jpeg', 0.6)
  }, [])

  useEffect(() => { pumpRef.current = pump }, [pump])

  const onMessage = useCallback((data) => {
    inflightRef.current = false
    let r
    try { r = JSON.parse(data) } catch { pump(); return }

    boxesRef.current = r.codes || []
    lastResultAtRef.current = performance.now()
    setLatency(r.latency_ms ?? null)
    const isNoProduct = r.product_detected === false || r.hint_kind === 'no_product'
    setHint(isNoProduct ? null : r.hint || null)
    setNoProduct(isNoProduct)
    setResult(r)

    if (stageRef.current !== 'verified' && stageRef.current !== 'not_verified') {
      if (r.valid) {
        if (!holdTimerRef.current) {
          holdTimerRef.current = setTimeout(() => {
            holdTimerRef.current = null
            setStageOnce('verified')
          }, CONFIRM_HOLD_MS)
        }
        setStage('verifying')
        stageRef.current = 'verifying'
      } else {
        if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null }
        setStage('scanning')
        stageRef.current = 'scanning'
      }
    }

    pump()
  }, [pump, setStageOnce])

  const { status, send } = useSocket('/ws/scan', onMessage)
  useEffect(() => { sendRef.current = send }, [send])
  useEffect(() => {
    if (status === 'open') {
      if (stageRef.current === 'starting') { setStage('scanning'); stageRef.current = 'scanning' }
      pump()
    }
  }, [status, pump])

  // Camera setup — cameraKey lets the "Reload camera" button force a full
  // restart of the stream if it's stuck, without remounting the dialog.
  useEffect(() => {
    let stream = null
    let cancelled = false

    async function start() {
      setCameraError(null)
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera unavailable — open this page through an https:// URL or localhost.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch (e) {
        if (cancelled) return
        setCameraError(`Camera blocked: ${e.message}. Allow camera access and try again.`)
      }
    }
    start()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [cameraKey])

  // Overlay draw loop for the live barcode/label boxes.
  useEffect(() => {
    let raf
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const video = videoRef.current, ov = overlayRef.current
      if (!video || !ov) return
      const w = video.clientWidth, h = video.clientHeight
      if (!w || !h) return
      if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h }
      const ctx = ov.getContext('2d')
      ctx.clearRect(0, 0, w, h)
      const age = performance.now() - lastResultAtRef.current
      ctx.globalAlpha = age > 1500 ? Math.max(0, 1 - (age - 1500) / 1000) : 1
      ctx.lineWidth = 3
      ctx.font = '600 13px system-ui, sans-serif'
      ctx.textBaseline = 'top'
      for (const b of boxesRef.current) {
        const x = b.box.x * w, y = b.box.y * h, bw = b.box.w * w, bh = b.box.h * h
        ctx.strokeStyle = '#0f9d63'
        ctx.strokeRect(x, y, bw, bh)
        const text = b.kind + ' · ' + b.value
        const tw = ctx.measureText(text).width
        const ty = y > 20 ? y - 19 : y + bh + 2
        ctx.fillStyle = '#0f9d63'
        ctx.fillRect(x, ty, tw + 10, 18)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(text, x + 5, ty + 2)
      }
      ctx.globalAlpha = 1
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Give up and show "not verified" if nothing valid was read for a while —
  // restarts every time scanning (re)starts, so a re-scan gets a fresh clock.
  useEffect(() => {
    if (stage !== 'scanning' && stage !== 'verifying') return
    const t = setTimeout(() => setStageOnce('not_verified'), NOT_VERIFIED_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [stage, setStageOnce])

  useEffect(() => () => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current) }, [])

  const rescan = useCallback(() => {
    holdTimerRef.current && clearTimeout(holdTimerRef.current)
    holdTimerRef.current = null
    setResult(null)
    setHint(null)
    setNoProduct(false)
    setUpload({ status: 'idle', error: null })
    stageRef.current = 'scanning'
    setStage('scanning')
    pump()
  }, [pump])

  const reloadCamera = useCallback(() => {
    rescan()
    setCameraKey((k) => k + 1)
  }, [rescan])

  const doUpload = useCallback(() => {
    const canvas = captureCanvasRef.current
    setUpload({ status: 'loading', error: null })
    canvas.toBlob((blob) => {
      if (!blob) { setUpload({ status: 'error', error: 'could not capture the frame' }); return }
      const form = new FormData()
      form.append('file', blob, 'pick.jpg')
      fetch(httpUrl('/api/analyze'), { method: 'POST', body: form })
        .then((res) => {
          if (!res.ok) throw new Error(`server returned ${res.status}`)
          return res.json()
        })
        .then(() => {
          setUpload({ status: 'done', error: null })
          onVerified?.(order)
        })
        .catch((err) => setUpload({ status: 'error', error: err.message }))
    }, 'image/jpeg', 0.85)
  }, [order, onVerified])

  const handleNext = useCallback(() => {
    onVerified?.(order)
    onClose()
  }, [onVerified, order, onClose])

  const isLive = status === 'open'
  const statusText = status !== 'open'
    ? (status === 'connecting' ? 'connecting…' : 'reconnecting…')
    : stage === 'verifying' ? 'verifying…' : 'live'

  const scannedLine = result ? fieldsLine(result) : null
  const scannedPrimary = result?.codes?.[0]

  return (
    <div className="scan-dialog-backdrop" role="dialog" aria-modal="true" aria-label={`Scan for order ${order.order_number}`}>
      <div className="scan-dialog">
        <header className="scan-dialog-header">
          <div className="scan-dialog-target">
            <span className="scan-dialog-target-label">Scanning for</span>
            <span className="scan-dialog-target-name">Order {order.order_number}</span>
            <span className="scan-dialog-target-sub">
              {order.product_count} product{order.product_count === 1 ? '' : 's'} · {order.unit_count} units expected
            </span>
          </div>
          <button type="button" className="scan-dialog-close" onClick={onClose} aria-label="Close scanner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        {(stage === 'starting' || stage === 'scanning' || stage === 'verifying') && (
          <div className="scan-dialog-body">
            <div className="scan-stage">
              <video ref={videoRef} autoPlay playsInline muted />
              <canvas ref={overlayRef} className="scan-overlay" />

              {!noProduct && !cameraError && stage !== 'verifying' && (
                <div className="viewfinder" aria-hidden="true">
                  <span className="vf-corner tl" /><span className="vf-corner tr" />
                  <span className="vf-corner bl" /><span className="vf-corner br" />
                </div>
              )}

              {stage === 'verifying' && (
                <div className="verifying-overlay">
                  <div className="verifying-badge">
                    <span className="spinner brand" aria-hidden="true" />
                    Verifying against order…
                  </div>
                </div>
              )}

              {noProduct && stage !== 'verifying' && (
                <div className="no-product-overlay">
                  <div className="no-product-badge">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M8 11h6" />
                    </svg>
                    NO ITEM FOUND
                    <span className="no-product-sub">point the camera at the product label</span>
                  </div>
                </div>
              )}

              {!noProduct && hint && stage !== 'verifying' && <div className="scan-hint">{hint}</div>}

              {cameraError && (
                <div className="camera-error-overlay">
                  <div className="camera-error-card">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
                    </svg>
                    <p>{cameraError}</p>
                    <button type="button" className="btn btn-primary" onClick={reloadCamera}>Try again</button>
                  </div>
                </div>
              )}
            </div>

            <div className="scan-dialog-status">
              <span className={`live-pill${isLive ? ' on' : ''}`}>
                <span className="live-dot" />{statusText}
              </span>
              {latency != null && <span className="scan-latency">{latency} ms</span>}
            </div>
          </div>
        )}

        {stage === 'verified' && (
          <div className="scan-outcome verified">
            <div className="outcome-icon success">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12l5 5L20 6" />
              </svg>
            </div>
            <h2>Verified</h2>
            <p className="outcome-sub">Matched against Order {order.order_number}</p>

            <div className="outcome-card">
              <div className="outcome-card-title">
                {scannedPrimary ? `${scannedPrimary.kind} · ${scannedPrimary.value}` : (result?.name || 'Item scanned')}
              </div>
              {scannedLine && <div className="outcome-card-sub">{scannedLine}</div>}
            </div>

            {upload.status === 'error' && (
              <p className="outcome-error">Couldn't upload the pick: {upload.error}</p>
            )}

            <div className="outcome-actions">
              <button type="button" className="btn btn-secondary" onClick={handleNext}>Next</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={doUpload}
                disabled={upload.status === 'loading' || upload.status === 'done'}
              >
                {upload.status === 'loading' && <span className="spinner" aria-hidden="true" />}
                {upload.status === 'done' ? 'Uploaded ✓' : upload.status === 'loading' ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        )}

        {stage === 'not_verified' && (
          <div className="scan-outcome not-verified">
            <div className="outcome-icon danger">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </div>
            <h2>Not Verified</h2>
            <p className="outcome-sub">
              {cameraError || "Couldn't get a clear read on the product in time."}
            </p>
            <ul className="outcome-tips">
              <li>Move closer so the barcode or label fills the frame</li>
              <li>Make sure there's enough light — avoid glare and shadows</li>
              <li>Hold the phone steady for a moment</li>
            </ul>
            <div className="outcome-actions">
              <button type="button" className="btn btn-secondary" onClick={reloadCamera}>Reload camera</button>
              <button type="button" className="btn btn-primary" onClick={rescan}>Re-scan</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
