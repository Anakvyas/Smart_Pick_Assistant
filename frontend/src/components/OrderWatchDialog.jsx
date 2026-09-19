import { useCallback, useEffect, useRef, useState } from 'react'
import { isLocalOrigin, PUBLIC_URL_OVERRIDE } from '../config'
import { ordersApi } from '../api/ordersApi'
import { analyzePhoto } from '../api/scanApi'
import { useSocket } from '../hooks/useSocket'
import { countResolved, firstPending } from '../lib/orderItems'
import QrCode from './QrCode'
import ResultPanel from './ResultPanel'
import './OrderWatchDialog.css'

// How often this "window" re-checks the order's items while a phone
// scans against it via the QR code — updating within a few seconds reads
// as live for a picking workflow without needing a dedicated push channel
// just for this side of it.
const POLL_MS = 3000

// Mirrors what the backend computes in controllers/order_controller.py
// (_apply_order_completion) — lets this poll-only view keep the order card
// behind it in sync without a dedicated order-fetch endpoint. An order is
// complete once every item is VERIFIED or UNAVAILABLE, not just VERIFIED —
// see firstPending/lib/orderItems for the shared definition of "resolved".
function deriveOrderFromItems(order, items) {
  const pickedCount = items.reduce((sum, i) => sum + i.quantity_verified, 0)
  const allResolved = items.length > 0 && !firstPending(items)
  const status = allResolved ? 'COMPLETED' : pickedCount > 0 ? 'IN_PROGRESS' : order.status
  return { ...order, picked_count: pickedCount, status }
}

/**
 * The PC/desktop side of picking an order: a "window" onto the phone doing
 * the actual scanning (see ScanDialog, the phone-only camera scanner this
 * QR code opens at /pick/:orderId) — this component never requests camera
 * access itself. Shows the QR code, updates the checklist live (pushed over
 * an order-scoped websocket as the phone verifies items, with a poll as a
 * backstop), and lets a picker without a phone upload a photo directly from
 * this computer instead.
 */
export default function OrderWatchDialog({ order, onClose, onOrderUpdated, onShowScanner }) {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading') // loading | error | watching | complete
  const [error, setError] = useState(null)
  // A short-lived, order-scoped token embedded in the QR link so the phone
  // that scans it never has to log in — see ordersApi.scanToken and
  // core/security.py's create_scan_token on the backend. Fetched once per
  // order; the QR panel shows a loading placeholder for the brief moment
  // before it arrives rather than a stale/wrong link.
  const [scanToken, setScanToken] = useState(null)
  const cancelledRef = useRef(false)
  const statusRef = useRef('loading')
  // Live debug feed: /ws/scan/{order.id} (the phone's connection, see
  // ScanDialog) broadcasts every frame's full result to this order's
  // /ws/display/{order.id} subscribers — scoped per-order (routes/scan.py's
  // broadcast()) so two pickers working two different orders never see
  // each other's live scan traffic here.
  const [lastScanFrame, setLastScanFrame] = useState(null)
  // The actual JPEG the phone's camera just captured, as a data URL — same
  // field Display.jsx already renders (`result.image`, base64), just not
  // previously shown here. Lets someone at this PC see exactly what the
  // phone is pointed at without looking at the phone itself.
  const [frameImage, setFrameImage] = useState(null)
  // True for a short window after each frame — drives the "scanning live…"
  // pulse so it's obvious the phone is actively feeding frames right now,
  // not just that a frame arrived at some point in the past.
  const [frameLive, setFrameLive] = useState(false)
  const frameLiveTimerRef = useRef(null)
  const fileInputRef = useRef(null)
  // A photo picked from this PC's filesystem/gallery, held for review
  // before it's sent — same pattern as ScanDialog's capture/gallery review
  // step. { blob, previewUrl }
  const [capturedPhoto, setCapturedPhoto] = useState(null)
  const [upload, setUpload] = useState({ status: 'idle', error: null, outcome: null })

  const poll = useCallback(() => {
    if (statusRef.current === 'complete') return
    ordersApi.items(order.id)
      .then((res) => {
        if (cancelledRef.current) return
        const list = res.data.items
        setItems(list)
        onOrderUpdated?.(deriveOrderFromItems(order, list))
        const next = firstPending(list) ? 'watching' : 'complete'
        statusRef.current = next
        setStatus(next)
      })
      .catch((err) => {
        if (cancelledRef.current) return
        setError(err?.payload?.error?.message || 'Could not load this order.')
        statusRef.current = 'error'
        setStatus('error')
      })
  }, [order, onOrderUpdated])

  // Paused while this tab/window isn't actually visible — polling every
  // few seconds from a background tab (or a minimized window someone left
  // open) was pure wasted load with nobody watching it. Catches up with an
  // immediate poll the moment it's visible again rather than waiting out
  // whatever was left of the interval.
  useEffect(() => {
    let active = true
    ordersApi.scanToken(order.id)
      .then((res) => { if (active) setScanToken(res.data.token) })
      .catch(() => {}) // QR just won't render until a retry — items polling still works via the cookie
    return () => { active = false }
  }, [order.id])

  useEffect(() => {
    cancelledRef.current = false
    let id = null

    const startInterval = () => { if (!id) id = setInterval(poll, POLL_MS) }
    const stopInterval = () => { if (id) { clearInterval(id); id = null } }

    const handleVisibility = () => {
      if (document.hidden) {
        stopInterval()
      } else {
        poll()
        startInterval()
      }
    }

    poll()
    if (!document.hidden) startInterval()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelledRef.current = true
      stopInterval()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [poll])

  // item_update (pushed by routes/orders.py right after a verify/unavailable
  // call succeeds, from a phone OR this PC's own upload below) updates the
  // checklist instantly instead of waiting on the poll; anything else is a
  // raw scan-frame result for the debug panel, same as before.
  const onSocketMessage = useCallback((data) => {
    let msg
    try { msg = JSON.parse(data) } catch { return }
    if (msg.type === 'item_update') {
      if (msg.item) {
        setItems((prev) => {
          const next = prev.map((i) => (i.id === msg.item.id ? msg.item : i))
          const nextStatus = firstPending(next) ? 'watching' : 'complete'
          statusRef.current = nextStatus
          setStatus(nextStatus)
          return next
        })
      }
      if (msg.order) onOrderUpdated?.(msg.order)
      return
    }
    setLastScanFrame(msg)
    // Only replace the preview when this frame actually carries one — the
    // backend only includes `image` when a display is connected (see
    // routes/scan.py's want_image), which is always true once this dialog
    // is open, but a mid-stream error frame (frame_error_payload) never
    // has one and shouldn't blank out the last real photo.
    if (msg.image) setFrameImage(`data:image/jpeg;base64,${msg.image}`)
    setFrameLive(true)
    clearTimeout(frameLiveTimerRef.current)
    // Frames arrive roughly every few hundred ms while a phone is actively
    // scanning (see ScanDialog's single-in-flight pump loop) — anything
    // quieter than ~1.5s means the phone stopped, not just a slow frame.
    frameLiveTimerRef.current = setTimeout(() => setFrameLive(false), 1500)
  }, [onOrderUpdated])

  useEffect(() => () => clearTimeout(frameLiveTimerRef.current), [])

  useSocket(`/ws/display/${order.id}`, onSocketMessage)

  const onFilePicked = useCallback((e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again later
    if (!file) return
    setCapturedPhoto((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl)
      return { blob: file, previewUrl: URL.createObjectURL(file) }
    })
    setUpload({ status: 'idle', error: null, outcome: null })
  }, [])

  const retakePhoto = useCallback(() => {
    setCapturedPhoto((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl)
      return null
    })
    setUpload({ status: 'idle', error: null, outcome: null })
  }, [])

  // Releases a picked photo's blob URL if the dialog closes while it's
  // still under review — every other path that replaces/clears
  // capturedPhoto already revokes the outgoing URL itself (onFilePicked,
  // retakePhoto), this only covers unmount. Same pattern as ScanDialog.
  const capturedPhotoRef = useRef(null)
  useEffect(() => { capturedPhotoRef.current = capturedPhoto }, [capturedPhoto])
  useEffect(() => () => {
    if (capturedPhotoRef.current?.previewUrl) URL.revokeObjectURL(capturedPhotoRef.current.previewUrl)
  }, [])

  // Sends the reviewed photo through the same /api/analyze -> verify path a
  // phone's capture/gallery pick goes through (see ScanDialog.analyzeCaptured)
  // — lets a picker at this PC without a phone still check a product against
  // the order by uploading a photo of it.
  const analyzeAndVerify = useCallback(() => {
    if (!capturedPhoto) return
    setUpload({ status: 'loading', error: null, outcome: null })
    analyzePhoto(capturedPhoto.blob)
      .then((r) => {
        if (!r.valid || (!r.barcode && !r.name)) {
          setUpload({
            status: 'idle', error: null,
            outcome: { matched: false, reason: "That photo didn't have a clear enough barcode or label to check." },
          })
          return null
        }
        return ordersApi.verify(order.id, { barcode: r.barcode || null, name: r.name || null })
      })
      .then((res) => {
        if (!res) return
        const data = res.data
        onOrderUpdated?.(data.order)
        if (data.matched) {
          setItems((prev) => prev.map((i) => (i.id === data.item.id ? data.item : i)))
          const nextStatus = data.order.status === 'COMPLETED' ? 'complete' : 'watching'
          statusRef.current = nextStatus
          setStatus(nextStatus)
        }
        setUpload({ status: 'idle', error: null, outcome: data })
        if (data.matched) retakePhoto()
      })
      .catch((err) => setUpload({ status: 'error', error: err.message, outcome: null }))
  }, [capturedPhoto, order.id, onOrderUpdated, retakePhoto])

  const pickUrl = scanToken
    ? `${PUBLIC_URL_OVERRIDE || window.location.origin}/pick/${order.id}?token=${encodeURIComponent(scanToken)}`
    : null
  const showLocalWarning = !PUBLIC_URL_OVERRIDE && isLocalOrigin()
  // Reachable over the LAN, but plain http:// — the phone will load the
  // page fine, but its browser will then flatly refuse camera access
  // (getUserMedia requires https:// or localhost), which otherwise shows
  // up as a confusing "camera/upload just doesn't work" on the phone with
  // no warning ever shown on this screen to explain why. Excludes the
  // localhost case above (different problem: can't even reach the page)
  // and the case where VITE_PUBLIC_URL is set (assumed to already be an
  // https:// tunnel, per this app's own documented ngrok setup).
  const showInsecureWarning = !PUBLIC_URL_OVERRIDE && !isLocalOrigin() && window.location.protocol !== 'https:'
  const resolvedCount = countResolved(items)
  const nextTarget = firstPending(items)

  return (
    <div className="watch-dialog-backdrop" role="dialog" aria-modal="true" aria-label={`Watch order ${order.order_number}`}>
      <div className="watch-dialog">
        <header className="watch-dialog-header">
          <div className="watch-dialog-title">
            <span className="watch-dialog-eyebrow">Order</span>
            <span className="watch-dialog-name">{order.order_number}</span>
            {items.length > 0 && (
              <span className="watch-dialog-sub">{resolvedCount} of {items.length} products done</span>
            )}
          </div>
          <div className="watch-dialog-header-actions">
            {onShowScanner && (
              <button type="button" className="watch-dialog-scanner-btn" onClick={onShowScanner} aria-label="Scan with this device's camera instead">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><circle cx="12" cy="13.5" r="3.5" />
                </svg>
                Camera
              </button>
            )}
            <button type="button" className="watch-dialog-close" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </header>

        {status === 'error' && (
          <div className="watch-dialog-error">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
            </svg>
            <p>{error}</p>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        )}

        {status === 'complete' && (
          <div className="watch-dialog-complete">
            <div className="watch-complete-icon">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12l5 5L20 6" />
              </svg>
            </div>
            <h2>Order Complete</h2>
            <p>
              All {items.length} product{items.length === 1 ? '' : 's'} are accounted for
              {items.some((i) => i.status === 'UNAVAILABLE') && ' (some marked unavailable)'}.
            </p>
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        )}

        {(status === 'loading' || status === 'watching') && (
          <div className="watch-dialog-body">
            <div className="qr-panel">
              {pickUrl
                ? <QrCode value={pickUrl} label="scan with your phone" size={168} />
                : <div className="qr-code-placeholder" style={{ width: 168, height: 168 }} />}
              <p className="qr-hint">
                {nextTarget ? `Next up: ${nextTarget.name}` : 'Open your phone’s camera on this code to start scanning.'}
                {' '}This window updates live as items get verified.
              </p>
              {showLocalWarning && (
                <p className="qr-warning">
                  This page is open at <code>{window.location.host}</code> — a phone on another
                  network can't reach "localhost". Open this from your LAN IP or an ngrok URL instead.
                </p>
              )}

              {showInsecureWarning && (
                <p className="qr-warning">
                  This is a plain <code>http://</code> link — the phone will open it fine, but its
                  browser will then refuse camera access entirely (only <code>https://</code> or
                  "localhost" are allowed to use the camera). Front the frontend dev server with
                  ngrok and set <code>VITE_PUBLIC_URL</code>, then reopen this order.
                </p>
              )}

              {!capturedPhoto && (
                <button
                  type="button"
                  className="watch-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                  Upload a photo from this computer
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onFilePicked}
                hidden
              />
            </div>

            {/* Review step for a PC-picked photo, not sent yet — mirrors
                ScanDialog's capture/gallery review so a bad shot can be
                retaken before spending a round trip on it. Lets a picker at
                this PC without a phone still check a product against the
                order. */}
            {capturedPhoto && (
              <div className="watch-upload-review">
                <img src={capturedPhoto.previewUrl} alt="Photo to check against this order" className="watch-upload-review-img" />
                <div className="watch-upload-review-actions">
                  <button type="button" className="btn btn-secondary" onClick={retakePhoto} disabled={upload.status === 'loading'}>
                    Retake
                  </button>
                  <button type="button" className="btn btn-primary" onClick={analyzeAndVerify} disabled={upload.status === 'loading'}>
                    {upload.status === 'loading' && <span className="spinner" aria-hidden="true" />}
                    {upload.status === 'loading' ? 'Checking…' : 'Analyze & verify'}
                  </button>
                </div>
              </div>
            )}

            {upload.status === 'error' && (
              <p className="watch-upload-error">Couldn't analyze that photo: {upload.error}</p>
            )}
            {upload.outcome?.matched === false && (
              <p className="watch-upload-error">
                {upload.outcome.reason || "That photo didn't match anything still pending on this order."}
              </p>
            )}

            <div className="watch-items-list">
              {items.length === 0 && status === 'loading' && (
                <div className="watch-items-empty">
                  <span className="spinner brand" aria-hidden="true" />
                  Loading order…
                </div>
              )}
              {items.map((i) => (
                <div
                  key={i.id}
                  className={`watch-item${i.status === 'VERIFIED' ? ' done' : ''}${i.status === 'UNAVAILABLE' ? ' unavailable' : ''}`}
                >
                  <span className="watch-item-check" aria-hidden="true">
                    {i.status === 'VERIFIED' && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12l5 5L20 6" />
                      </svg>
                    )}
                    {i.status === 'UNAVAILABLE' && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    )}
                  </span>
                  <span className="watch-item-name">
                    {i.name}
                    {i.status === 'UNAVAILABLE' && (
                      <span className="watch-item-unavailable-reason">
                        {' '}— unavailable{i.unavailable_reason ? ` (${i.unavailable_reason})` : ''}
                      </span>
                    )}
                  </span>
                  <span className="watch-item-qty">{i.quantity_verified}/{i.quantity_expected}</span>
                </div>
              ))}
            </div>

            {/* Debug view: whatever the phone's camera is reading right
                now, live — the actual photo it's processing, the extracted
                fields and raw JSON, and a pulse while frames are actively
                arriving — so what went wrong (or right) on a scan can be
                checked from this screen without needing to look at the
                phone at all. */}
            <div className="watch-debug-section">
              <div className="section-label-row">
                <div className="section-label">Live scan feed (debug)</div>
                <span className={`watch-live-pulse${frameLive ? ' active' : ''}`}>
                  <span className="watch-live-pulse-dot" />
                  {frameLive ? 'Scanning…' : 'Idle'}
                </span>
              </div>
              {frameImage && (
                <div className={`watch-frame-preview${frameLive ? ' active' : ''}`}>
                  <img src={frameImage} alt="What the phone's camera is currently pointed at" />
                </div>
              )}
              <ResultPanel
                result={lastScanFrame}
                placeholder="Nothing scanned yet — this fills in as soon as a phone starts scanning."
                defaultShowRaw
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
