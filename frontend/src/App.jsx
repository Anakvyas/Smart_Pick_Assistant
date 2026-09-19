import { AnimatePresence } from 'framer-motion'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Display from './pages/Display'
import Scan from './pages/Scan'
import Demo from './pages/Demo'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import DashboardPage from './pages/DashboardPage'
import AdminPage from './pages/AdminPage'
import OrderScanPage from './pages/OrderScanPage'
import ProtectedRoute from './components/ProtectedRoute'
import PageTransition from './components/PageTransition'
import { AuthProvider, useAuth } from './context/AuthContext'
import './styles/global.css'

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageTransition><Display /></PageTransition>} />
        <Route path="/scan" element={<PageTransition><Scan /></PageTransition>} />
        <Route path="/demo" element={<PageTransition><Demo /></PageTransition>} />
        {/* Live scanning and photo upload are both on /scan now — this
            redirect keeps any already-scanned /upload QR codes working. */}
        <Route path="/upload" element={<Navigate to="/scan" replace />} />

        <Route
          path="/login"
          element={
            isAuthenticated && !isLoading
              ? <Navigate to="/dashboard" replace />
              : <PageTransition><LoginPage /></PageTransition>
          }
        />
        <Route
          path="/signup"
          element={
            isAuthenticated && !isLoading
              ? <Navigate to="/dashboard" replace />
              : <PageTransition><SignupPage /></PageTransition>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute isAuthenticated={isAuthenticated} isLoading={isLoading}>
              <PageTransition><DashboardPage /></PageTransition>
            </ProtectedRoute>
          }
        />
        {/* No separate ADMIN role yet — same login as the picker dashboard,
            just a different view (see routes/admin.py on the backend). */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute isAuthenticated={isAuthenticated} isLoading={isLoading}>
              <PageTransition><AdminPage /></PageTransition>
            </ProtectedRoute>
          }
        />
        {/* Not wrapped in ProtectedRoute — the QR code embeds its own
            short-lived, order-scoped token (see OrderScanPage), so this must
            stay reachable without a login. OrderScanPage itself falls back
            to requiring one only when there's no token in the URL. */}
        <Route path="/pick/:orderId" element={<PageTransition><OrderScanPage /></PageTransition>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
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
