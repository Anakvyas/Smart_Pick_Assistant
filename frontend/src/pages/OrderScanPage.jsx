import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ordersApi } from '../api/ordersApi'
import ScanDialog from '../components/ScanDialog'

/**
 * The phone-side landing page for an order's QR code (see OrderWatchDialog,
 * which renders that QR pointing here from the dashboard). Not wrapped in
 * ProtectedRoute — the QR link carries its own short-lived, order-scoped
 * `?token=` (see core/security.py's create_scan_token), so the phone that
 * scans it never has to log in, same philosophy as the original /scan and
 * /display pages being open to anonymous phones (see AuthStatus.jsx). A
 * direct visit with no token still needs a real login, handled below by
 * hand rather than ProtectedRoute since only this route is conditional on
 * whether a token is present.
 *
 * This page always renders the camera scanner (ScanDialog) — the PC never
 * uses its own camera; only a phone lands here.
 */
export default function OrderScanPage() {
  const { orderId } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const [state, setState] = useState({ status: 'loading', order: null, error: null })

  useEffect(() => {
    let active = true
    ordersApi.get(orderId, token)
      .then((res) => {
        if (!active) return
        setState({ status: 'done', order: res.data.order, error: null })
      })
      .catch((err) => {
        if (!active) return
        setState({ status: 'error', order: null, error: err?.payload?.error?.message || 'Could not load this order.' })
      })
    return () => { active = false }
  }, [orderId, token])

  // No token and no session at all — the one case this page still sends
  // to /login, same round-trip ProtectedRoute normally handles (back here
  // afterward), since there's no other way to know which order to show.
  if (!token && !authLoading && !isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: `/pick/${orderId}` }} />
  }

  if (state.status === 'loading' || (!token && authLoading)) {
    return (
      <div className="loading-screen">
        <div className="loading-card"><div className="spinner" aria-hidden="true" /><p>Loading order…</p></div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <p style={{ color: 'var(--danger-strong)', marginBottom: 14 }}>{state.error}</p>
          <button type="button" className="secondary-button" onClick={() => navigate('/dashboard')}>
            Back to dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <ScanDialog
      order={state.order}
      scanToken={token}
      onClose={() => navigate('/dashboard')}
      onOrderUpdated={() => {}}
    />
  )
}
