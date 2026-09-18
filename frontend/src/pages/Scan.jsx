import { useCallback, useEffect, useRef, useState } from 'react'
import { useSocket } from '../hooks/useSocket'
import { analyzePhoto } from '../api/scanApi'
import { isTrustworthyRead, mergeFrame } from '../lib/scanAggregation'
import ResultPanel from '../components/ResultPanel'
import AuthStatus from '../components/AuthStatus'
import './Scan.css'

export default function Scan() {
  const videoRef = useRef(null)
  const overlayRef = useRef(null)
  const captureCanvasRef = useRef(document.createElement('canvas'))
  const fileInputRef = useRef(null)
  const boxesRef = useRef([])
  const lastResultAtRef = useRef(0)
  const inflightRef = useRef(false)
  const sendRef = useRef(() => false)
  const pumpRef = useRef(() => {})
  // Accumulates fields across consecutive trustworthy frames into one
  // stable live result instead of showing/discarding whatever the single
  // latest frame happened to carry — same logic ScanDialog.jsx uses for
  // the per-order scanner, see lib/scanAggregation for why. Keeps a noisy
  // one-frame OCR blip ("caps lock", stray background text) from ever
  // being shown as if it were a real product read.
  const mergeRef = useRef(null)

  const [cameraError, setCameraError] = useState(null)
  // Lets "Try again" force a full restart of the camera effect (new
  // stream, new watchdog) without reloading the whole page — see the
  // camera-setup effect below.
  const [cameraKey, setCameraKey] = useState(0)
  const [latency, setLatency] = useState('—')
  const [count, setCount] = useState('no barcode')
  const [phase, setPhase] = useState('idle') // idle | predicting | live | error: ...
  const [hint, setHint] = useState(null)
  const [noProduct, setNoProduct] = useState(false)
  const [result, setResult] = useState(null)

  // A photo picked with the upload button, analyzed as a one-off request —
  // separate from the live request/response pump below, so it doesn't
  // interrupt live scanning underneath.
  const [upload, setUpload] = useState(null) // { status, previewUrl, result, error }

  // Request/response pump: capture a frame, send it, wait for the ack before
  // sending the next one. Goes through sendRef (rather than calling the
  // socket hook's `send` directly) so this can be defined once, independent
  // of the socket connecting/reconnecting.
  const pump = useCallback(() => {
    if (inflightRef.current) return
    const video = videoRef.current
    if (!video || !video.videoWidth) { setTimeout(() => pumpRef.current(), 100); return }

    const w = 640
    const h = Math.round(video.videoHeight * 640 / video.videoWidth)
    const canvas = captureCanvasRef.current
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(video, 0, 0, w, h)

    // Raw JPEG bytes over a binary WS frame, not a base64 data URL — base64
    // costs ~33% extra payload plus an encode/decode on every single frame
    // of a live stream, which is pure added latency for no benefit here.
    canvas.toBlob((blob) => {
      if (!blob) { setTimeout(() => pumpRef.current(), 100); return }
      blob.arrayBuffer().then((buf) => {
        const ok = sendRef.current(buf)
        if (ok) {
          inflightRef.current = true
          setPhase('predicting')
        } else {
          setTimeout(() => pumpRef.current(), 150)
        }
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
    setLatency(r.latency_ms != null ? r.latency_ms + ' ms' : '—')
    setCount(boxesRef.current.length
      ? boxesRef.current.length + ' code' + (boxesRef.current.length !== 1 ? 's' : '')
      : 'no barcode')
    setPhase(r.error ? 'error: ' + r.error : 'live')
    // hint_kind === 'no_product' covers "nothing recognisable at all" even
    // when the (optional, model-file-dependent) YOLO gate isn't running;
    // product_detected === false is the gate's own, earlier verdict when it
    // is. Either one means the same thing to the person holding the phone.
    const isNoProduct = r.product_detected === false || r.hint_kind === 'no_product'
    setHint(isNoProduct ? null : r.hint || null)
    setNoProduct(isNoProduct)

    if (r.valid && isTrustworthyRead(r)) {
      // A confident read (barcode, or a name with a corroborating field) —
      // merge it into the running result so the panel shows a stable,
      // filled-in product instead of flickering between whatever each
      // individual frame happened to catch.
      mergeRef.current = mergeFrame(mergeRef.current, r)
      setResult(mergeRef.current)
    } else if (!r.valid) {
      // Genuinely nothing in frame — clear the stable result rather than
      // leaving a stale product showing once it's actually gone.
      mergeRef.current = null
      setResult(r)
    }
    // else: r.valid but not trustworthy (a noisy one-field OCR blip) —
    // leave the last stable result on screen rather than replacing it.

    pump()
  }, [pump])

  const { status, send } = useSocket('/ws/scan', onMessage)

  useEffect(() => { sendRef.current = send }, [send])

  useEffect(() => {
    if (status === 'open') pump()
  }, [status, pump])

  // Camera setup, once. Guarded with `cancelled` because StrictMode's dev-only
  // double-invoke runs this, tears it down, and runs it again immediately —
  // without the guard, the first run's now-superseded play() call rejects
  // with a spurious "interrupted by a new load request" that would otherwise
  // get reported as a real camera failure.
  useEffect(() => {
    let stream = null
    let cancelled = false

    async function start() {
      setCameraError(null)
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          'Camera unavailable. Browsers only expose the camera on HTTPS or ' +
          'localhost — open this page through an https:// URL.'
        )
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // frameRate pinned (not left to the camera's default/variable
          // rate) — see ScanDialog.jsx's identical constraint for why: an
          // unconstrained rate is what most often beats against indoor
          // lighting's own 50/60Hz flicker and shows up as a visible
          // strobe in the preview.
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 }, height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        // Best-effort continuous-autofocus hint — see ScanDialog.jsx's
        // identical block for why; silently ignored wherever unsupported
        // (Safari/iOS entirely, and most non-Chromium browsers).
        try {
          const track = stream.getVideoTracks()[0]
          const caps = track?.getCapabilities?.()
          if (caps?.focusMode?.includes('continuous')) {
            await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
          }
        } catch { /* unsupported here — the camera still works, just without this hint */ }
      } catch (e) {
        if (cancelled) return
        setCameraError(
          `Camera blocked: ${e.message}. Allow camera access, and make sure the page is on https://`
        )
      }
    }
    start()

    // Watchdog: getUserMedia can resolve with a live stream that never
    // actually produces a frame (stuck autoplay policy, driver quirk) —
    // videoWidth stays 0 forever with no error ever thrown, so nothing
    // above would set cameraError. Without this, that's a blank stage with
    // no way to recover short of reloading the whole page. See
    // ScanDialog.jsx's identical watchdog.
    const watchdog = setTimeout(() => {
      if (!cancelled && !videoRef.current?.videoWidth) {
        setCameraError("Camera didn't start. Tap Try again — if that doesn't help, check that no other app or tab is using the camera.")
      }
    }, 8000)

    return () => {
      cancelled = true
      clearTimeout(watchdog)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [cameraKey])

  // Overlay draw loop, independent of inference so it stays smooth.
  useEffect(() => {
    let raf
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const video = videoRef.current
      const ov = overlayRef.current
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

  function onUploadFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again later
    if (!file) return

    setUpload({ status: 'loading', previewUrl: URL.createObjectURL(file), result: null, error: null })

    analyzePhoto(file)
      .then((result) => setUpload((u) => ({ ...u, status: 'done', result })))
      .catch((err) => setUpload((u) => ({ ...u, status: 'error', error: err.message })))
  }

  const statusText = status !== 'open'
    ? (status === 'connecting' ? 'connecting…' : 'reconnecting…')
    : (phase === 'idle' ? 'live' : phase === 'predicting' ? 'predicting…' : phase === 'live' ? 'live' : phase)

  const isLive = status === 'open'

  return (
    <div className="scan-page">
      <header className="app-header">
        <div className="brand">
          <span className="brand-dot" />
          Smart Pick <span className="brand-sub">scanner</span>
        </div>
        <div className="header-right">
          <AuthStatus />
          <span className={`live-pill${isLive ? ' on' : ''}`}>
            <span className="live-dot" />{statusText}
          </span>
        </div>
      </header>

      <div className="stage">
        <video ref={videoRef} autoPlay playsInline muted />
        <canvas ref={overlayRef} className="overlay" />

        {!noProduct && !result?.valid && (
          <div className="viewfinder" aria-hidden="true">
            <span className="vf-corner tl" /><span className="vf-corner tr" />
            <span className="vf-corner bl" /><span className="vf-corner br" />
          </div>
        )}

        {noProduct && (
          <div className="no-product-overlay">
            <div className="no-product-badge">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3M8 11h6" />
              </svg>
              NO PRODUCT DETECTED
              <span className="no-product-sub">point the camera at a product label</span>
            </div>
          </div>
        )}

        {!noProduct && hint && <div className="hint">{hint}</div>}
      </div>

      <div className="bar">
        <span className="count">{count}</span>
        <span className="lat">{latency}</span>
        <button className="upload-btn" onClick={() => fileInputRef.current?.click()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          Upload photo
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        // No `capture` attribute — on many mobile browsers (iOS Safari
        // especially) it skips the native camera/photo-library/files
        // chooser and launches the camera app directly, so "Upload photo"
        // could never actually pick an existing photo from the gallery.
        onChange={onUploadFile}
        hidden
      />
      {cameraError && (
        <div className="err">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
          </svg>
          <span>{cameraError}</span>
          <button type="button" className="err-retry-btn" onClick={() => setCameraKey((k) => k + 1)}>
            Try again
          </button>
        </div>
      )}

      <div className="live-result">
        <div className="section-label">Live result</div>
        <ResultPanel
          result={result}
          placeholder="Point the camera at a product to see results here"
          defaultShowRaw
        />
      </div>

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
  )
}
