import { httpUrl } from '../config'

// Routed through the same same-origin proxy (Vite's /api -> :8000) every
// other request in this app already uses — not a separate VITE_API_URL
// pointing at the old standalone Node auth server's port, which no longer
// exists now that auth lives in the same FastAPI process as the scanner.
export async function apiRequest(path, options = {}) {
  const response = await fetch(httpUrl(path), {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Request failed.');
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}
