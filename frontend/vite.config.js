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
    // /demo/images specifically (not plain /demo — that's the React Router
    // /demo *page*, which must still fall through to the SPA): the demo
    // product barcode images, served by app.py's StaticFiles mount, were
    // missing a proxy rule entirely — a request for /demo/images/*.png
    // silently fell through to Vite's SPA history fallback and got
    // index.html back instead of the actual image.
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/demo/images': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
