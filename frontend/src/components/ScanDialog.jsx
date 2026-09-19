import { useCallback, useEffect, useRef, useState } from 'react'
<<<<<<< HEAD
import { motion } from 'framer-motion'
=======
>>>>>>> origin/main
import { useSocket } from '../hooks/useSocket'
import { ordersApi } from '../api/ordersApi'
import { analyzePhoto } from '../api/scanApi'
import { isTrustworthyRead, mergeFrame, normalizeName } from '../lib/scanAggregation'
import { countResolved, firstPending, isPending } from '../lib/orderItems'
import './ScanDialog.css'

// How long a valid, in-frame read has to hold steady before we trust it and
// send it off to be checked against the order — long enough to reject a
// one-frame fluke (motion blur that happens to decode) and to naturally
// aggregate 2-3 consecutive frames' fields into one stable result (see
// lib/scanAggregation's mergeFrame), short enough that a clean read still
// feels instant.
const CONFIRM_HOLD_MS = 550

// If nothing valid has been read in this long since scanning started, stop
// burning the camera/battery and hand the picker an explicit "didn't work"
// screen with a way out, instead of spinning forever.
const NOT_VERIFIED_TIMEOUT_MS = 25000

const stillScanning = (s) => s === 'starting' || s === 'scanning' || s === 'checking'
const showsCamera = (s) => s === 'loading' || stillScanning(s)

function nameMatches(item, rawName) {
  const a = normalizeName(rawName)
  if (!a) return false
  const b = normalizeName(item.name)
  return !!b && (a.includes(b) || b.includes(a))
}

// A barcode-scanner read (scan.barcode) and the label's OCR-read GSTIN
// (scan.gstin) aren't the same kind of number, but either one landing on
// either of the item's own barcode or gstin is equally good evidence of
// which physical product this is (mirrors the backend's _code_matches).
function codeMatches(item, scan) {
  const scanned = [scan.barcode, scan.gstin].filter(Boolean)
  const expected = [item.barcode, item.gstin].filter(Boolean)
  return scanned.some((c) => expected.includes(c))
}

// Looser than itemVerifies below — no label corroboration required — used
// only to recognize *which* product a scan looks like, for a clearer "out
// of order" message. Mirrors the backend's _identifies: a code match is
// enough on its own, otherwise falls back to name — not an early return on
// "a code was read", since a scanned code that isn't this item's own (e.g.
// a name-only custom item) shouldn't block recognizing it by label.
function identifies(item, scan) {
  if ((scan.barcode || scan.gstin) && codeMatches(item, scan)) return true
  return !!(scan.name && nameMatches(item, scan.name))
}

// Mirrors the backend's own matching (controllers/order_controller.py,
// _find_match) exactly, including the part that's easy to miss: a code
// (barcode or GSTIN) match alone is never trusted by itself when the order
// is in strict mode — a misread, a swapped/adjacent label, or a relabeled
// item can all still produce a "correct" code read on the wrong physical
// product. The same scan's name has to corroborate it before it counts as
// a match. `strictLabel` (the order's effective strict_label_verification)
// skips that corroboration and trusts the code alone, same as the backend
// does for a "barcode only" order. When the scan's code doesn't match this
// item's own (e.g. it has none on file at all — a name-only custom item),
// falls back to a plain name check rather than giving up just because some
// code was read.
function itemVerifies(item, scan, strictLabel) {
  if ((scan.barcode || scan.gstin) && codeMatches(item, scan)) {
    return !strictLabel || !!(scan.name && nameMatches(item, scan.name))
  }
  return !!(scan.name && nameMatches(item, scan.name))
}

// Plain-language status for what's been read so far this hold, in place of
// showing raw OCR fields/JSON on a phone screen — that's small, technical,
// and not what a picker mid-scan needs. The full structured breakdown and
// raw JSON still show on the PC (OrderWatchDialog's debug panel), which is
// where that level of detail is actually useful.
function liveStatusMessage(r) {
  if (!r) return null
  const hasBarcode = !!(r.barcode || (r.codes && r.codes.length))
  const hasLabel = !!r.name
  if (hasBarcode && hasLabel) return { text: 'Label and barcode matched — checking…', tone: 'success' }
  if (hasBarcode && !hasLabel) return { text: "Barcode found — can't confirm without the label yet", tone: 'pending' }
  if (!hasBarcode && hasLabel) return { text: 'Label found — no barcode yet, hold steady', tone: 'pending' }
  return null
}

/**
 * Phone-side camera scanner for one order — this device's own camera only
 * (see OrderWatchDialog for the PC-side QR + live-results "window", which
 * never touches a camera at all). Loads the order's real expected items,
 * shows the next one to look for up top, scans live with the same coaching
 * hints as /scan (too dark, move closer, no product…), aggregates a few
 * consecutive trustworthy frames into one stable result, then checks it
 * against the backend (POST .../verify — matches by barcode first, falling
 * back to a fuzzy label-name match).
 */
export default function ScanDialog({ order, onClose, onOrderUpdated, scanToken, onShowQR }) {
  const videoRef = useRef(null)
  const overlayRef = useRef(null)
  const captureCanvasRef = useRef(document.createElement('canvas'))
  // "Gallery" — the phone's photo library/files, no `capture` attribute
  // (see that input's own comment for why one matters).
  const fileInputRef = useRef(null)
  // "Capture" — forces the native camera app open via `capture`, for a
  // full-resolution dedicated photo instead of a low-res live-preview grab.
  const cameraInputRef = useRef(null)
  const boxesRef = useRef([])
  const lastResultAtRef = useRef(0)
  const inflightRef = useRef(false)
  const sendRef = useRef(() => false)
  const pumpRef = useRef(() => { })
  const holdTimerRef = useRef(null)
  const stageRef = useRef('loading')
  const mergeRef = useRef(null)
  const itemsRef = useRef([])
  const quickNoteTimerRef = useRef(null)
  const notVerifiedTimerRef = useRef(null)

  const [cameraError, setCameraError] = useState(null)
  const [cameraKey, setCameraKey] = useState(0)
  // loading | load_error | starting | scanning | checking |
  // order_complete | not_verified
  const [stage, setStage] = useState('loading')
  const [notVerifiedReason, setNotVerifiedReason] = useState(null)
  const [hint, setHint] = useState(null)
  const [noProduct, setNoProduct] = useState(false)
  const [items, setItems] = useState([])
  const [upload, setUpload] = useState({ status: 'idle', error: null })
  // A photo taken (or picked from the gallery) but not yet sent — shown as
  // a review step (the captured frame, Analyze / Retake) instead of firing
  // straight off to the server the instant the shutter's tapped, so a bad
  // shot (glare, motion blur, wrong angle) can be retaken before spending
  // a round-trip on it.
  const [capturedPhoto, setCapturedPhoto] = useState(null) // { blob, previewUrl }
  const [quickNote, setQuickNote] = useState(null)
  // A scan that read confidently but matches nothing pending — shown as a
  // non-blocking banner over the still-live camera (not a takeover screen):
  // scanning keeps running the whole time, so a wrong item never stops the
  // picker from continuing, retrying, or falling back to a photo upload.
  const [mismatch, setMismatch] = useState(null) // { detected }
  // Mirrors mergeRef.current for rendering — the full accumulated field set
  // (name, weight, MRP, expiry, company, batch, GSTIN…) shown live below
  // the camera as it fills in, not just the tiny barcode-kind label drawn
  // on the video itself. Cleared on rescan so a fresh attempt doesn't show
  // stale fields from whatever was scanned before it.
  const [liveResult, setLiveResult] = useState(null)
  // Confirm step for "this isn't on the shelf" — a picker choice, not a
  // scan result, so it gets its own small panel rather than living inside
  // the scan/verify pipeline. { status: 'idle' | 'confirming' | 'saving', error }
  const [unavailableFlow, setUnavailableFlow] = useState({ status: 'idle', error: null })

  useEffect(() => { stageRef.current = stage }, [stage])
  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => () => clearTimeout(quickNoteTimerRef.current), [])

  const showQuickNote = useCallback((text) => {
    setQuickNote(text)
    clearTimeout(quickNoteTimerRef.current)
    quickNoteTimerRef.current = setTimeout(() => setQuickNote(null), 1400)
  }, [])

  const goTo = useCallback((next, extra) => {
    stageRef.current = next
    setStage(next)
    if (extra?.reason !== undefined) setNotVerifiedReason(extra.reason)
  }, [])

  // "Stuck" clock: fires only when NOTHING trustworthy has been read for a
  // while — not merely "nothing matched yet" (see onMessage, which pushes
  // this back out on every trustworthy read, match or mismatch, so a
  // picker actively hitting wrong items never gets bounced into this by
  // mistake; only genuine silence from the camera/model does).
  const scheduleNotVerifiedTimeout = useCallback(() => {
    clearTimeout(notVerifiedTimerRef.current)
    notVerifiedTimerRef.current = setTimeout(() => {
      goTo('not_verified', { reason: "Couldn't get a clear read on the product in time." })
    }, NOT_VERIFIED_TIMEOUT_MS)
  }, [goTo])

  // Load this order's real expected items up front — there's nothing to
  // scan against until this is back.
  useEffect(() => {
    let active = true
    ordersApi.items(order.id, scanToken)
      .then((res) => {
        if (!active) return
        const list = res.data.items
        setItems(list)
        goTo(firstPending(list) ? 'starting' : 'order_complete')
      })
      .catch((err) => {
        if (!active) return
        setNotVerifiedReason(err?.payload?.error?.message || 'Could not load this order.')
        goTo('load_error')
      })
    return () => { active = false }
  }, [order.id, scanToken, goTo])

  const pump = useCallback(() => {
    if (inflightRef.current) return
    if (!stillScanning(stageRef.current)) return
    const video = videoRef.current
    if (!video || !video.videoWidth) { setTimeout(() => pumpRef.current(), 100); return }

    const w = 640
    const h = Math.round(video.videoHeight * 640 / video.videoWidth)
    const canvas = captureCanvasRef.current
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(video, 0, 0, w, h)

    // Raw JPEG over binary WS — no base64 either direction — plus the
    // inflightRef gate above means exactly one frame is ever in flight:
    // the next capture only fires from this same pump() being re-invoked
    // by the *ack* of the frame just sent (see onMessage's trailing
    // pump() call), never sent speculatively. That single-in-flight
    // discipline both keeps the backend from being flooded when it's
    // slower than the camera's frame rate, and guarantees responses are
    // consumed in the exact order they were requested — nothing "stale"
    // can ever land after something newer already did.
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

  // Shared by both the live-scan hold-timer and the "Upload photo" button —
  // a photo upload gets checked against the order exactly the same way a
  // live read does, so a successful upload updates the item checklist and
  // (via onOrderUpdated) the PC's watch view too, not just this screen.
  const verifyScanned = useCallback((scanned) => {
    if (!scanned) return

    // null (order default) behaves as strict — matches config.py's own
    // STRICT_LABEL_VERIFICATION default — since this client has no way to
    // read the backend's actual env-level default when the order itself
    // doesn't override it.
    const strictLabel = order.strict_label_verification ?? true
    // Line-wise: only the current expected item (whatever "Scan this next"
    // up top names) is ever eligible — a clean read of a *later* line
    // doesn't jump the queue. Mirrors the backend's _current_expected_item
    // / _find_match exactly, so this client-side pre-check never disagrees
    // with what the actual verify call would decide.
    const current = firstPending(itemsRef.current)
    const currentMatch = current && itemVerifies(current, scanned, strictLabel) ? current : null
    if (!currentMatch) {
      const verifiedHit = itemsRef.current.find((i) => !isPending(i) && identifies(i, scanned))
      if (verifiedHit) {
        // Already fully picked — the camera is very often still pointed at
        // whatever was *just* verified. Quiet, non-blocking: stays on the
        // live camera, no screen swap, nothing to acknowledge.
        showQuickNote(`${verifiedHit.name} — already picked ✓`)
        return
      }
      const otherPending = current
        && itemsRef.current.find((i) => isPending(i) && i.id !== current.id && identifies(i, scanned))
      // Non-blocking: shown as a banner over the still-live camera, not a
      // takeover screen, so scanning keeps running the whole time and the
      // picker can retry, keep scanning, or fall back to a photo upload.
      const reason = otherPending
        ? `Scan "${current.name}" next — that's what this order expects right now, not "${otherPending.name}".`
        // A code (barcode/GSTIN) with no name yet is the specific "not
        // enough to confirm" case itemVerifies rejects in strict mode —
        // called out by name here rather than lumped in with a genuine
        // wrong-item read.
        : strictLabel && (scanned.barcode || scanned.gstin) && !scanned.name && current
          ? `Barcode/GSTIN read, but there's no label/name yet to confirm it's "${current.name}" — hold steady so the label gets read too.`
          : null
      setMismatch({ detected: scanned, reason })
      return
    }

    goTo('checking')
    ordersApi.verify(order.id, { barcode: scanned.barcode || null, gstin: scanned.gstin || null, name: scanned.name || null }, scanToken)
      .then((res) => {
        const data = res.data
        onOrderUpdated?.(data.order)
        if (!data.matched) {
          // The order changed under us between the client-side pre-check
          // and this call (e.g. another device just finished the same
          // item) — rare, but handled the same as a genuine mismatch.
          setMismatch({ detected: scanned, reason: data.reason })
          goTo('scanning')
          return
        }
        setItems((prev) => prev.map((i) => (i.id === data.item.id ? data.item : i)))
        setMismatch(null)
        if (data.order.status === 'COMPLETED') {
          goTo('order_complete')
          return
        }
        // Stay live rather than parking on a static "Verified" screen that
        // needs a tap to continue — a quiet, self-dismissing note (same
        // mechanism as the "already picked" case above) plus an immediate
        // reset back into 'scanning' so the very next product can be
        // scanned right away. pump() bails out whenever stage isn't one of
        // stillScanning's, so without this the frame loop would otherwise
        // just sit dead until something called rescan().
        showQuickNote(`${data.item.name} verified ✓ (${data.item.quantity_verified}/${data.item.quantity_expected})`)
        mergeRef.current = null
        if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null }
        setLiveResult(null)
        goTo('scanning')
        pumpRef.current()
      })
      .catch((err) => {
        goTo('not_verified', { reason: err?.payload?.error?.message || "Couldn't reach the server to verify that scan." })
      })
  }, [order.id, order.strict_label_verification, scanToken, onOrderUpdated, goTo, showQuickNote])

  const verifyCurrent = useCallback(() => {
    const scanned = mergeRef.current
    mergeRef.current = null
    verifyScanned(scanned)
  }, [verifyScanned])

  const onMessage = useCallback((data) => {
    inflightRef.current = false
    let r
    try { r = JSON.parse(data) } catch { pump(); return }

    if (stageRef.current === 'starting') goTo('scanning')

    boxesRef.current = r.codes || []
    lastResultAtRef.current = performance.now()
    const isNoProduct = r.product_detected === false || r.hint_kind === 'no_product'
    setHint(isNoProduct ? null : r.hint || null)
    setNoProduct(isNoProduct)

    if (stageRef.current === 'scanning' || stageRef.current === 'starting') {
      if (r.valid && isTrustworthyRead(r)) {
        scheduleNotVerifiedTimeout() // real activity — push the "stuck" clock back out
        mergeRef.current = mergeFrame(mergeRef.current, r)
        setLiveResult(mergeRef.current)
        if (!holdTimerRef.current) {
          holdTimerRef.current = setTimeout(() => {
            holdTimerRef.current = null
            verifyCurrent()
          }, CONFIRM_HOLD_MS)
        }
      } else if (holdTimerRef.current) {
        // A noisy/untrustworthy frame in between doesn't reset progress —
        // only a genuinely empty/invalid frame does, so one bad OCR blip
        // mid-hold can't cancel an otherwise-good read.
        if (!r.valid) {
          clearTimeout(holdTimerRef.current)
          holdTimerRef.current = null
          mergeRef.current = null
          setLiveResult(null)
        }
      }
    }

    pump()
  }, [pump, goTo, verifyCurrent, scheduleNotVerifiedTimeout])

  // Order-scoped path — matched by routes/orders.py pushing item_update
  // events on the same order id via /ws/display/{order_id}, and by
  // routes/scan.py's broadcast() mirroring order-scoped scan frames only to
  // that order's /ws/display subscribers (see OrderWatchDialog). Keeps two
  // pickers working two different orders from ever seeing each other's
  // live scan traffic.
  const { status, send } = useSocket(`/ws/scan/${order.id}`, onMessage)
  useEffect(() => { sendRef.current = send }, [send])
  useEffect(() => {
    if (status === 'open') pump()
  }, [status, pump])

  // Camera setup, once. cameraKey lets the "Reload camera" button force a
  // full restart of the stream if it's stuck, without remounting the dialog.
  useEffect(() => {
    let stream = null
    let cancelled = false
    // Captured once, up front — not re-read as `videoRef.current` later
    // (including in cleanup), since the <video> element conditionally
    // unmounts/remounts across stage changes (showsCamera(stage)). Reading
    // the ref fresh at cleanup time could grab a *different*, newer
    // element than the one this effect actually attached a stream to.
    const videoEl = videoRef.current

    async function start() {
      setCameraError(null)
      // Browsers refuse camera access on any origin that isn't https:// or
      // localhost — checked with window.isSecureContext (normalized across
      // browsers) rather than just testing whether mediaDevices exists,
      // since some mobile browsers still expose the API object on an
      // insecure origin and only fail once getUserMedia is actually called,
      // with a much less clear error. The QR code a phone scans to reach
      // this page is very often a plain http://<LAN-IP> URL (see
      // OrderWatchDialog) — that's the single most common way to land here
      // without a camera ever being possible at all, so it gets called out
      // by name instead of a generic "blocked" message.
      if (!window.isSecureContext) {
        setCameraError(
          `Camera needs a secure connection. This page is open at ${window.location.protocol}//${window.location.host}, ` +
          `which browsers won't allow camera access on unless it's "https://" or "localhost". ` +
          `Front the frontend dev server with ngrok (or another https:// tunnel) and open that URL instead.`
        )
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera unavailable on this browser.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // frameRate pinned (not left to the camera's default/variable
          // rate) — an unconstrained rate is what most often beats against
          // indoor LED/fluorescent lighting's own 50/60Hz flicker and shows
          // up as a visible strobe in the preview; a fixed 30fps is the
          // steadiest common ground across phone cameras. This can't fully
          // eliminate exposure hunting under bad lighting (that's the
          // camera hardware/driver reacting to the room, not something a
          // web page controls) but it removes one real variable.
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 }, height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        if (videoEl) {
          videoEl.srcObject = stream
          await videoEl.play()
        }
        // Best-effort: some Android Chrome cameras default to single-shot
        // focus, which combined with a scanner's constant macro-range
        // hunting for a label can compound the exposure instability into
        // something worse. Not part of the guaranteed constraint spec —
        // getCapabilities()/applyConstraints() for this are Chromium-only
        // and absent entirely on Safari/iOS — so this is wrapped to fail
        // silently everywhere it isn't supported rather than ever blocking
        // the camera actually starting.
        try {
          const track = stream.getVideoTracks()[0]
          const caps = track?.getCapabilities?.()
          if (caps?.focusMode?.includes('continuous')) {
            await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
          }
        } catch { /* unsupported here — the camera still works, just without this hint */ }
      } catch (e) {
        if (cancelled) return
        setCameraError(`Camera blocked: ${e.message}. Allow camera access and try again.`)
      }
    }
    start()

    // Watchdog: getUserMedia can resolve (permission granted, stream
    // returned) and yet never actually produce a frame — a stuck autoplay
    // policy, a driver quirk, a track that stays "live" but frozen. That
    // leaves videoWidth at 0 forever with no error ever thrown, so nothing
    // above would ever set cameraError — the picker would just see a blank
    // stage with no "Try again" button and no way out short of reloading
    // the whole page. This turns silent hangs into the same recoverable
    // error state a thrown getUserMedia error already gets.
    const watchdog = setTimeout(() => {
      if (!cancelled && !videoEl?.videoWidth) {
        setCameraError("Camera didn't start. Tap Try again — if that doesn't help, check that no other app or tab is using the camera.")
      }
    }, 8000)

    return () => {
      cancelled = true
      clearTimeout(watchdog)
      stream?.getTracks().forEach((t) => t.stop())
      // Fully detach, not just stop the tracks — leaving a stopped
      // stream's object reference on the <video> element is what some
      // mobile browsers have been seen to get confused by on a same-page
      // retry (the "Try again" button bumping cameraKey), where a fresh
      // getUserMedia call resolves fine but the element itself never
      // actually starts playing the new stream. Only a full page reload
      // reliably cleared that stale reference before; this should make
      // "Try again" just as reliable.
      if (videoEl) videoEl.srcObject = null
    }
  }, [cameraKey])

  // Overlay draw loop for the live barcode/label boxes — independent of
  // inference so it stays smooth regardless of backend latency.
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

  // Starts the "stuck" clock when scanning (re)starts; onMessage keeps
  // pushing it back out on every trustworthy read, so it only ever fires
  // on genuine, sustained silence.
  useEffect(() => {
    if (stage === 'scanning') scheduleNotVerifiedTimeout()
    else clearTimeout(notVerifiedTimerRef.current)
    return () => clearTimeout(notVerifiedTimerRef.current)
  }, [stage, scheduleNotVerifiedTimeout])

  useEffect(() => () => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current) }, [])

  // Releases a captured/picked photo's blob URL if the dialog closes while
  // it's still under review — every other path that replaces or clears
  // capturedPhoto already revokes the outgoing URL itself (see
  // onFilePicked/retakePhoto), this only covers unmount.
  const capturedPhotoRef = useRef(null)
  useEffect(() => { capturedPhotoRef.current = capturedPhoto }, [capturedPhoto])
  useEffect(() => () => {
    if (capturedPhotoRef.current?.previewUrl) URL.revokeObjectURL(capturedPhotoRef.current.previewUrl)
  }, [])

  const rescan = useCallback(() => {
    holdTimerRef.current && clearTimeout(holdTimerRef.current)
    holdTimerRef.current = null
    mergeRef.current = null
    setHint(null)
    setNoProduct(false)
    setMismatch(null)
    setLiveResult(null)
    setCapturedPhoto((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl)
      return null
    })
    setUpload({ status: 'idle', error: null })
    setUnavailableFlow({ status: 'idle', error: null })
    goTo('scanning')
    pump()
  }, [pump, goTo])

  // "This isn't on the shelf" — a picker decision, not a scan outcome, so
  // it goes through its own endpoint (mark_item_unavailable on the
  // backend) rather than pretending a barcode/name matched. Always acts on
  // whatever item is currently PENDING (the same one the header's "Scan
  // this next" banner names), read fresh off itemsRef rather than the
  // possibly-stale `nextTarget` render value.
  const markCurrentUnavailable = useCallback((reason) => {
    const target = firstPending(itemsRef.current)
    if (!target) return
    setUnavailableFlow({ status: 'saving', error: null })
    ordersApi.markUnavailable(order.id, target.id, reason, scanToken)
      .then((res) => {
        const data = res.data
        onOrderUpdated?.(data.order)
        setItems((prev) => prev.map((i) => (i.id === data.item.id ? data.item : i)))
        if (data.order.status === 'COMPLETED') {
          setUnavailableFlow({ status: 'idle', error: null })
          goTo('order_complete')
        } else {
          rescan()
          showQuickNote(`${target.name} marked unavailable`)
        }
      })
      .catch((err) => {
        setUnavailableFlow({
          status: 'idle',
          error: err?.payload?.error?.message || "Couldn't mark that item unavailable.",
        })
      })
  }, [order.id, scanToken, onOrderUpdated, goTo, rescan, showQuickNote])

  const reloadCamera = useCallback(() => {
    rescan()
    setCameraKey((k) => k + 1)
  }, [rescan])

  // Both "Capture" (native camera app, forced via the hidden input's
  // `capture` attribute) and "Gallery" (photo library/files, no `capture`
  // attribute) land here — same review step either way: a preview with
  // Retake/Analyze, not sent until confirmed. A native camera photo reads
  // meaningfully better than an in-page canvas grab off the live preview
  // stream ever could (full sensor resolution, real autofocus/HDR, vs. the
  // getUserMedia stream's capped ~1280x720 live feed) — worth the one extra
  // tap out to the camera app and back.
  const onFilePicked = useCallback((e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again later
    if (!file) return
    setCapturedPhoto((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl)
      return { blob: file, previewUrl: URL.createObjectURL(file) }
    })
    setUpload({ status: 'idle', error: null })
  }, [])

  const retakePhoto = useCallback(() => {
    setCapturedPhoto((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl)
      return null
    })
    setUpload({ status: 'idle', error: null })
  }, [])

  // Sends the *reviewed* photo through /api/analyze. Whatever comes back
  // is then checked against the order exactly like a live scan would be
  // (see verifyScanned), so this isn't just a preview — a match here
  // verifies the item and updates the checklist same as scanning it live.
  // Passing order.id also gets this broadcast to /ws/display/{order.id} —
  // same channel the live camera pump already feeds — so a Capture or
  // Gallery photo shows up in the PC watch screen's live debug feed too,
  // not just live camera frames.
  const analyzeCaptured = useCallback(() => {
    if (!capturedPhoto) return
    setUpload({ status: 'loading', error: null })
    analyzePhoto(capturedPhoto.blob, 'pick.jpg', order.id)
      .then((r) => {
        if (r.valid && isTrustworthyRead(r)) {
          setUpload({ status: 'idle', error: null })
          setMismatch(null)
          retakePhoto() // clears the review step now that it's been acted on
          verifyScanned(r)
        } else {
          setUpload({ status: 'idle', error: null })
          showQuickNote("That photo didn't have a clear enough barcode or label to check.")
        }
      })
      .catch((err) => setUpload({ status: 'error', error: err.message }))
  }, [capturedPhoto, order.id, verifyScanned, showQuickNote, retakePhoto])

  const isLive = status === 'open'
  // A small text status, not a screen-covering overlay — "starting
  // camera…" here just means the socket's live but nothing's round-
  // tripped through the backend yet (stage hasn't reached 'scanning'),
  // shown the same unobtrusive way "connecting…"/"live" already are so it
  // never blocks the camera preview underneath it.
  const statusText = status !== 'open'
    ? (status === 'connecting' ? 'connecting…' : 'reconnecting…')
    : stage === 'starting' ? 'starting camera…'
      : stage === 'checking' ? 'verifying…' : 'live'

  const nextTarget = firstPending(items)
  const resolvedCount = countResolved(items)
  const unavailableCount = items.filter((i) => i.status === 'UNAVAILABLE').length
  const liveMessage = liveStatusMessage(liveResult)

  return (
<<<<<<< HEAD
    <motion.div
      className="scan-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Scan for order ${order.order_number}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className="scan-dialog"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
=======
    <div className="scan-dialog-backdrop" role="dialog" aria-modal="true" aria-label={`Scan for order ${order.order_number}`}>
      <div className="scan-dialog">
>>>>>>> origin/main
        <header className="scan-dialog-header">
          <div className="scan-dialog-target">
            <span className="scan-dialog-target-label">
              {stage === 'loading' ? 'Loading order…' : nextTarget ? 'Scan this next' : 'Order'}
            </span>
            <span className="scan-dialog-target-name">
              {stage === 'loading' ? `Order ${order.order_number}` : nextTarget ? nextTarget.name : `Order ${order.order_number}`}
            </span>
            <span className="scan-dialog-target-sub">
              Order {order.order_number}
              {items.length > 0 && ` · ${resolvedCount} of ${items.length} products done`}
              {nextTarget && ` · need ${nextTarget.quantity_expected - nextTarget.quantity_verified} more`}
            </span>
          </div>
          <div className="scan-dialog-header-actions">
            {onShowQR && (
              <button type="button" className="scan-dialog-qr-btn" onClick={onShowQR} aria-label="Show QR code to scan with another phone">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01" />
                </svg>
                QR
              </button>
            )}
            <button type="button" className="scan-dialog-close" onClick={onClose} aria-label="Close scanner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </header>

        {stage === 'load_error' && (
          <div className="scan-outcome not-verified">
            <div className="outcome-icon danger">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
              </svg>
            </div>
            <h2>Couldn't load order</h2>
            <p className="outcome-sub">{notVerifiedReason}</p>
            <div className="outcome-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {showsCamera(stage) && (
          <div className="scan-dialog-body">
            <div className="scan-stage">
              <video ref={videoRef} autoPlay playsInline muted />
              <canvas ref={overlayRef} className="scan-overlay" />

              {!noProduct && !cameraError && stage === 'scanning' && !mismatch && (
                <div className="viewfinder" aria-hidden="true">
                  <span className="vf-corner tl" /><span className="vf-corner tr" />
                  <span className="vf-corner bl" /><span className="vf-corner br" />
                </div>
              )}

              {quickNote && stage === 'scanning' && <div className="quick-note">{quickNote}</div>}

              {/* Small badge directly on the live video, not a screen-
                  covering overlay (that was the earlier regression — see
                  git history) — same slot/size as .scan-hint/.quick-note
                  below, just green and only for this one moment: socket's
                  live, camera's live, nothing's round-tripped the backend
                  yet. Disappears the instant the first frame comes back. */}
              {stage === 'starting' && !cameraError && (
                <div className="camera-starting-badge">
                  <span className="camera-starting-dot" />
                  Starting camera…
                </div>
              )}

              {stage === 'loading' && (
                <div className="verifying-overlay">
                  <div className="verifying-badge">
                    <span className="spinner brand" aria-hidden="true" />
                    Loading order…
                  </div>
                </div>
              )}

              {stage === 'checking' && (
                <div className="verifying-overlay">
                  <div className="verifying-badge">
                    <span className="spinner brand" aria-hidden="true" />
                    PROCESSING…
                  </div>
                </div>
              )}

              {noProduct && stage === 'scanning' && !mismatch && (
                <div className="no-product-overlay">
                  <div className="no-product-badge">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M8 11h6" />
                    </svg>
                    NO PRODUCT DETECTED
                    <span className="no-product-sub">point the camera at the product label</span>
                  </div>
                </div>
              )}

              {!noProduct && hint && !quickNote && !mismatch && stage === 'scanning' && <div className="scan-hint">{hint}</div>}

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

              {/* Non-blocking: camera keeps running underneath this the
                  whole time — a mismatch is information, not a stop sign. */}
              {mismatch && stage === 'scanning' && (
                <div className="mismatch-banner">
                  <div className="mismatch-head">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                      <path d="M12 9v4M12 16h.01" /><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                    </svg>
                    Not matched — still scanning
                  </div>
                  <div className="expected-vs-detected compact">
                    <div className="evd-col">
                      <div className="evd-label">Expected</div>

                      <div className="evd-value">
                        {nextTarget ? nextTarget.name : '—'}
                      </div>
                    </div>

                    <div className="evd-arrow" aria-hidden="true">
                      ≠
                    </div>

                    <div className="evd-col">
                      <div className="evd-label">Detected</div>

                      <div className="evd-value">
                        {mismatch.detected?.name ||
                          mismatch.detected?.codes?.[0]?.value ||
                          'Unknown'}
                      </div>
                    </div>
                  </div>

                  {mismatch.reason && (
                    <p className="mismatch-reason">
                      {mismatch.reason}
                    </p>
                  )}

                  <div className="mismatch-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={rescan}
                    >
                      Rescan
                    </button>

                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      Take photo
                    </button>
                  </div>
                </div>
              )}

              {/* Review step: the captured/picked photo, not sent yet — the
                  picker sees exactly what was taken and can retake it
                  before it's ever analyzed, rather than finding out it was
                  a bad shot only after the round trip. */}
              {capturedPhoto && (
                <div className="capture-review-overlay">
                  <img
                    src={capturedPhoto.previewUrl}
                    alt="Captured product"
                    className="capture-review-img"
                    onError={() => setUpload({ status: 'error', error: "Couldn't display that photo — try capturing again." })}
                  />
                  <div className="capture-review-actions">
                    <button type="button" className="btn btn-secondary" onClick={retakePhoto} disabled={upload.status === 'loading'}>
                      Retake
                    </button>
                    <button type="button" className="btn btn-primary" onClick={analyzeCaptured} disabled={upload.status === 'loading'}>
                      {upload.status === 'loading' && <span className="spinner" aria-hidden="true" />}
                      {upload.status === 'loading' ? 'Analyzing…' : 'Analyze'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="scan-dialog-status">
              <span className={`live-pill${isLive ? ' on' : ''}`}>
                <span className="live-dot" />{statusText}
              </span>
              {!mismatch && !capturedPhoto && (
                <div className="scan-dialog-status-actions">
                  <button
                    type="button"
                    className="upload-inline-btn"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={stage === 'checking'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><circle cx="12" cy="13.5" r="3.5" />
                    </svg>
                    Capture
                  </button>
                  <button
                    type="button"
                    className="upload-inline-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={stage === 'checking'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                    Gallery
                  </button>
                </div>
              )}
            </div>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              // `capture` forces the native camera app open directly — a
              // full-resolution, properly-focused photo instead of a
              // canvas-grabbed frame off the live preview stream (capped at
              // ~1280x720, no real autofocus control).
              capture="environment"
              onChange={onFilePicked}
              hidden
            />

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              // Deliberately no `capture` attribute — this is the photo
              // library/files picker, not the camera (see cameraInputRef
              // above for that). On many mobile browsers (iOS Safari
              // especially), `capture` on a file input skips the native
              // camera/photo-library/files chooser and launches the camera
              // app directly, which would silently defeat this "Gallery"
              // button (no way to actually pick an existing photo).
              onChange={onFilePicked}
              hidden
            />

            {!mismatch && !capturedPhoto && nextTarget && unavailableFlow.status === 'idle' && (
              <button
                type="button"
                className="mark-unavailable-link"
                onClick={() => setUnavailableFlow({ status: 'confirming', error: null })}
              >
                Can't find "{nextTarget.name}"? Mark unavailable
              </button>
            )}

            {unavailableFlow.error && (
              <p className="outcome-error upload-inline-error">{unavailableFlow.error}</p>
            )}

            {unavailableFlow.status === 'confirming' && nextTarget && (
              <div className="unavailable-confirm">
                <p className="unavailable-confirm-title">
                  Mark <strong>{nextTarget.name}</strong> unavailable?
                </p>
                <p className="unavailable-confirm-sub">This item will be skipped — choose a reason:</p>
                <div className="unavailable-reason-grid">
                  {['Out of stock', 'Damaged', 'Missing from shelf', 'Other'].map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      className="unavailable-reason-btn"
                      onClick={() => markCurrentUnavailable(reason)}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="unavailable-cancel-btn"
                  onClick={() => setUnavailableFlow({ status: 'idle', error: null })}
                >
                  Cancel
                </button>
              </div>
            )}

            {unavailableFlow.status === 'saving' && (
              <div className="unavailable-confirm">
                <p className="state"><span className="spinner brand" aria-hidden="true" />Marking unavailable…</p>
              </div>
            )}

            {!mismatch && (
              <div className={`live-status-message${liveMessage ? ` ${liveMessage.tone}` : ' idle'}`}>
                {liveMessage ? liveMessage.text : "Point the camera at a product's barcode or label"}
              </div>
            )}

            {upload.status === 'error' && (
              <p className="outcome-error upload-inline-error">Couldn't analyze that photo: {upload.error}</p>
            )}
          </div>
        )}

        {stage === 'order_complete' && (
          <div className="scan-outcome verified">
            <div className="outcome-icon success">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12l5 5L20 6" />
              </svg>
            </div>
            <h2>Order Complete</h2>
            <p className="outcome-sub">
              All {items.length} product{items.length === 1 ? '' : 's'} on Order {order.order_number} are accounted for
              {unavailableCount > 0 && ` (${unavailableCount} marked unavailable)`}.
            </p>
            <div className="outcome-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>Back to orders</button>
            </div>
          </div>
        )}

        {stage === 'not_verified' && (
          <div className="scan-outcome not-verified">
            <div className="outcome-icon danger">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
              </svg>
            </div>
            <h2>Not Verified</h2>
            <p className="outcome-sub">{cameraError || notVerifiedReason}</p>
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
<<<<<<< HEAD
      </motion.div>
    </motion.div>
=======
      </div>
    </div>
>>>>>>> origin/main
  )
}
