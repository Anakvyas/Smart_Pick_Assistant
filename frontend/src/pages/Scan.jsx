import { useCallback, useEffect, useRef, useState } from 'react'
import { useSocket } from '../hooks/useSocket'
import { httpUrl } from '../config'
import { fieldRows, fieldsLine } from '../lib/productFields'
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

  const [cameraError, setCameraError] = useState(null)
  const [latency, setLatency] = useState('—')
  const [count, setCount] = useState('no barcode')
  const [phase, setPhase] = useState('idle') // idle | predicting | live | error: ...
  const [hint, setHint] = useState(null)
  const [hintEmpty, setHintEmpty] = useState(false)
  const [fields, setFields] = useState(null)

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

    const ok = sendRef.current(canvas.toDataURL('image/jpeg', 0.5))
    if (ok) {
      inflightRef.current = true
      setPhase('predicting')
    }
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
    setHint(r.hint || null)
    setHintEmpty(r.product_detected === false)
    setFields(fieldsLine(r))

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
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          'Camera unavailable. Browsers only expose the camera on HTTPS or ' +
          'localhost — open this page through an https:// URL.'
        )
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 }, height: { ideal: 720 },
          },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch (e) {
        if (cancelled) return
        setCameraError(
          `Camera blocked: ${e.message}. Allow camera access, and make sure the page is on https://`
        )
      }
    }
    start()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

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
        ctx.strokeStyle = '#25d366'
        ctx.strokeRect(x, y, bw, bh)

        const text = b.kind + ' · ' + b.value
        const tw = ctx.measureText(text).width
        const ty = y > 20 ? y - 19 : y + bh + 2
        ctx.fillStyle = '#25d366'
        ctx.fillRect(x, ty, tw + 10, 18)
        ctx.fillStyle = '#04120a'
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

    const form = new FormData()
    form.append('image', file)

    fetch(httpUrl('/upload'), { method: 'POST', body: form })
      .then((res) => {
        if (!res.ok) throw new Error(`server returned ${res.status}`)
        return res.json()
      })
      .then((result) => setUpload((u) => ({ ...u, status: 'done', result })))
      .catch((err) => setUpload((u) => ({ ...u, status: 'error', error: err.message })))
  }

  const statusText = status !== 'open'
    ? (status === 'connecting' ? 'connecting…' : 'reconnecting…')
    : (phase === 'idle' ? 'live' : phase === 'predicting' ? 'predicting…' : phase === 'live' ? 'live' : phase)

  const uploadRows = upload?.result ? fieldRows(upload.result) : []
  const uploadCodes = upload?.result?.codes || []

  return (
    <div className="scan-page">
      <div className="stage">
        <video ref={videoRef} autoPlay playsInline muted />
        <canvas ref={overlayRef} className="overlay" />
        {hint && <div className={`hint${hintEmpty ? ' empty' : ''}`}>{hint}</div>}
        {fields && <div className="fields">{fields}</div>}
      </div>
      <div className="bar">
        <span className="count">{count}</span>
        <span className="lat">{latency}</span>
        <span className="status">{statusText}</span>
        <button className="upload-btn" onClick={() => fileInputRef.current?.click()}>
          upload photo
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onUploadFile}
        hidden
      />
      {cameraError && <div className="err">{cameraError}</div>}

      {upload && (
        <div className="upload-panel">
          <div className="upload-panel-head">
            <img src={upload.previewUrl} alt="Uploaded product" />
            <button className="close-btn" onClick={() => setUpload(null)}>×</button>
          </div>
          {upload.status === 'loading' && <p className="state">analyzing…</p>}
          {upload.status === 'error' && <p className="state error">Couldn't analyze that photo: {upload.error}</p>}
          {upload.status === 'done' && (
            <div className="upload-result">
              {uploadCodes.length > 0 && (
                <div className="codes">
                  {uploadCodes.map((c, i) => (
                    <span key={i} className="code-chip">{c.kind} · {c.value}</span>
                  ))}
                </div>
              )}
              {uploadRows.length > 0 ? (
                <div className="fields-list">
                  {uploadRows.map(([key, label, value]) => (
                    <div className="field-row" key={key}>
                      <span className="k">{label}</span>
                      <span className="v">{value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="state">no label info found in that photo</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
