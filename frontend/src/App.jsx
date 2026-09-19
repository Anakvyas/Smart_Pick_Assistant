import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Display from './pages/Display'
import Scan from './pages/Scan'
import Demo from './pages/Demo'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import DashboardPage from './pages/DashboardPage'
import AdminPage from './pages/AdminPage'
import OrderScanPage from './pages/OrderScanPage'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider, useAuth } from './context/AuthContext'
import './styles/global.css'

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth()

  return (
    <Routes>
      <Route path="/" element={<Display />} />
      <Route path="/scan" element={<Scan />} />
      <Route path="/demo" element={<Demo />} />
      {/* Live scanning and photo upload are both on /scan now — this
          redirect keeps any already-scanned /upload QR codes working. */}
      <Route path="/upload" element={<Navigate to="/scan" replace />} />

      <Route
        path="/login"
        element={
          isAuthenticated && !isLoading ? <Navigate to="/dashboard" replace /> : <LoginPage />
        }
      />
      <Route
        path="/signup"
        element={
          isAuthenticated && !isLoading ? <Navigate to="/dashboard" replace /> : <SignupPage />
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute isAuthenticated={isAuthenticated} isLoading={isLoading}>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      {/* No separate ADMIN role yet — same login as the picker dashboard,
          just a different view (see routes/admin.py on the backend). */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute isAuthenticated={isAuthenticated} isLoading={isLoading}>
            <AdminPage />
          </ProtectedRoute>
        }
      />
      {/* Not wrapped in ProtectedRoute — the QR code embeds its own
          short-lived, order-scoped token (see OrderScanPage), so this must
          stay reachable without a login. OrderScanPage itself falls back
          to requiring one only when there's no token in the URL. */}
      <Route path="/pick/:orderId" element={<OrderScanPage />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
