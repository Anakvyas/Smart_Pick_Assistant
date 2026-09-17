import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Display from './pages/Display'
import Scan from './pages/Scan'
import Demo from './pages/Demo'

export default function App() {
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
}
