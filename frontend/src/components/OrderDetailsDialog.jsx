import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ordersApi } from '../api/ordersApi'
import './OrderDetailsDialog.css'

// Assigned -> completed, as "1h 24m" / "18m 05s" / "42s" — whichever units
// are actually relevant, not a fixed format that reads as "0h 3m" for a
// quick pick or as raw seconds for a multi-hour one.
function formatDuration(startIso, endIso) {
  const ms = new Date(endIso) - new Date(startIso)
  if (!Number.isFinite(ms) || ms < 0) return null
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

function formatTimestamp(iso) {
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso
  }
}

// The item's own resolution moment — whichever of the two terminal
// timestamps actually applies (see OrderItem model: exactly one or
// neither is ever set, never both).
const itemTimestamp = (i) => i.verified_at || i.unavailable_at || null

/**
 * Read-only summary for an already-COMPLETED order — what "View details"
 * on the dashboard opens instead of the camera scanner (which has nothing
 * left to do on a finished order). Shows every item's final state, in the
 * order they were actually scanned, and how long the *scanning itself*
 * took — first item resolved to last, not assigned_at to completed_at
 * (that wall-clock gap also counts however long the order sat untouched
 * before picking even started, which isn't "how long verifying took").
 */
export default function OrderDetailsDialog({ order, onClose }) {
  const [state, setState] = useState({ status: 'loading', items: [], error: null })

  useEffect(() => {
    let active = true
    ordersApi.items(order.id)
      .then((res) => {
        if (!active) return
        setState({ status: 'done', items: res.data.items, error: null })
      })
      .catch((err) => {
        if (!active) return
        setState({ status: 'error', items: [], error: err?.payload?.error?.message || 'Could not load this order.' })
      })
    return () => { active = false }
  }, [order.id])

  // Chronological — reads as a timeline of what actually got scanned, in
  // the order it happened. Anything without a timestamp (shouldn't happen
  // on a genuinely completed order, but seed/legacy data might lack one)
  // sorts to the end rather than scrambling the rest.
  const sortedItems = [...state.items].sort((a, b) => {
    const ta = itemTimestamp(a), tb = itemTimestamp(b)
    if (!ta && !tb) return 0
    if (!ta) return 1
    if (!tb) return -1
    return new Date(ta) - new Date(tb)
  })

  // Scan time = span from the first item resolved to the last — the
  // actual verifying/scanning latency, not time-since-assignment (which
  // includes however long the order just sat there before picking
  // started). Falls back to the order's own assigned/completed gap only
  // when there aren't at least two timestamped items to measure a span
  // from (e.g. a one-item order, or older data seeded without per-item
  // timestamps).
  const scanTimes = state.items.map(itemTimestamp).filter(Boolean).map((t) => new Date(t).getTime())
  const duration = scanTimes.length >= 2
    ? formatDuration(new Date(Math.min(...scanTimes)).toISOString(), new Date(Math.max(...scanTimes)).toISOString())
    : order.completed_at ? formatDuration(order.assigned_at, order.completed_at) : null
  const verifiedCount = state.items.filter((i) => i.status === 'VERIFIED').length
  const unavailableCount = state.items.filter((i) => i.status === 'UNAVAILABLE').length

  return (
    <motion.div
      className="details-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Order ${order.order_number} details`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className="details-dialog"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <header className="details-dialog-header">
          <div className="details-dialog-title">
            <span className="details-dialog-eyebrow">Order</span>
            <span className="details-dialog-name">{order.order_number}</span>
            <span className="details-dialog-status-pill">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12l5 5L20 6" />
              </svg>
              Completed
            </span>
          </div>
          <button type="button" className="details-dialog-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="details-dialog-body">
          <div className="details-stats-row">
            <div className="details-stat">
              <span className="details-stat-label">Scan time</span>
              <span className="details-stat-value">{duration || '—'}</span>
            </div>
            <div className="details-stat">
              <span className="details-stat-label">Assigned</span>
              <span className="details-stat-value">{formatTimestamp(order.assigned_at)}</span>
            </div>
            <div className="details-stat">
              <span className="details-stat-label">Completed</span>
              <span className="details-stat-value">{order.completed_at ? formatTimestamp(order.completed_at) : '—'}</span>
            </div>
          </div>

          <div className="details-summary-line">
            {verifiedCount} verified
            {unavailableCount > 0 && ` · ${unavailableCount} unavailable`}
            {' '}· {order.unit_count} units total
          </div>

          {state.status === 'loading' && (
            <div className="details-items-empty">
              <span className="spinner brand" aria-hidden="true" />
              Loading items…
            </div>
          )}

          {state.status === 'error' && (
            <p className="details-error">{state.error}</p>
          )}

          {state.status === 'done' && (
            <div className="details-items-list">
              {sortedItems.map((i) => (
                <div
                  key={i.id}
                  className={`details-item${i.status === 'VERIFIED' ? ' done' : ''}${i.status === 'UNAVAILABLE' ? ' unavailable' : ''}`}
                >
                  <span className="details-item-check" aria-hidden="true">
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
                  <span className="details-item-body">
                    <span className="details-item-name">
                      {i.name}
                      {i.status === 'UNAVAILABLE' && (
                        <span className="details-item-unavailable-reason">
                          {' '}— unavailable{i.unavailable_reason ? ` (${i.unavailable_reason})` : ''}
                        </span>
                      )}
                    </span>
                    {(i.verified_at || i.unavailable_at) && (
                      <span className="details-item-timestamp">
                        {formatTimestamp(i.verified_at || i.unavailable_at)}
                      </span>
                    )}
                  </span>
                  <span className="details-item-qty">{i.quantity_verified}/{i.quantity_expected}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
