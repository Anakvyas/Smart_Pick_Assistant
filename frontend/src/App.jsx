import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Display from './pages/Display'
import Scan from './pages/Scan'
import Demo from './pages/Demo'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Display from './pages/Display';
import Scan from './pages/Scan';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DashboardPage from './pages/DashboardPage';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider, useAuth } from './context/AuthContext';
import './styles/global.css';

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Display />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/demo" element={<Demo />} />
        {/* Live scanning and photo upload are both on /scan now — this
            redirect keeps any already-scanned /upload QR codes working. */}
        <Route path="/upload" element={<Navigate to="/scan" replace />} />
      </Routes>
    </BrowserRouter>
  )
    <Routes>
      <Route path="/" element={<Display />} />
      <Route path="/scan" element={<Scan />} />
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

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
