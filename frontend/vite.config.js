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
    // Forwards to the backend so the whole app is reachable through one
    // origin/port — required for a single ngrok tunnel to work, since ngrok
    // maps one public URL to one local port.
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/upload': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // "/upload" is also a client-side route (redirecting old QR codes
        // to /scan) — only the POST from the upload button is the backend
        // call; a plain GET must fall through to the SPA instead.
        bypass(req) {
          if (req.method !== 'POST') return req.url
        },
      },
    },
  },
})
