import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Exposed on the LAN (not just localhost) so a phone can reach the
    // /scan page after scanning the Display page's QR code.
    host: true,
    // Vite normally 403s any request whose Host header it doesn't
    // recognize (a DNS-rebinding guard) — that includes the random
    // ngrok-free.dev hostname ngrok assigns each tunnel, so it has to be
    // explicitly allowed for the phone-over-ngrok flow to reach this dev
    // server at all.
    allowedHosts: true,
    // Forwards to the FastAPI backend (backend/app.py) so the whole app is
    // reachable through one origin/port — required for a single ngrok
    // tunnel to work, since ngrok maps one public URL to one local port.
    // No path collision to route around here (unlike the old /upload page
    // route): the backend's own routes all live under /ws and /api.
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
