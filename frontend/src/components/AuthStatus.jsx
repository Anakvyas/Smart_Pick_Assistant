import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './AuthStatus.css'

/**
 * A small, non-blocking "who's signed in" pill for the scanner pages —
 * these stay open to anonymous phones (a picker scanning a QR code off the
 * display screen shouldn't need to log in first), so this only ever
 * informs, never gates access the way ProtectedRoute does for /dashboard.
 */
export default function AuthStatus() {
  const { user, isAuthenticated, isLoading, logout } = useAuth()

  if (isLoading) return null

  if (!isAuthenticated) {
    return (
      <Link to="/login" className="auth-status auth-status-guest">
        sign in
      </Link>
    )
  }

  return (
    <span className="auth-status">
      <Link to="/dashboard" className="auth-status-dashboard">dashboard</Link>
      {user?.name || user?.email}
      <button type="button" className="auth-status-logout" onClick={logout}>
        log out
      </button>
    </span>
  )
}
