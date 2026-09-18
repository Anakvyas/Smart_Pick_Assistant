import { apiRequest } from './apiClient';

// `token` is the QR scan-token (see OrderWatchDialog/scanToken below) — set
// when this call is being made by a phone that scanned the QR and has no
// login session of its own; omitted entirely for the normal logged-in path,
// where the session cookie already covers it.
function withToken(path, token) {
  return token ? `${path}?token=${encodeURIComponent(token)}` : path;
}

export const ordersApi = {
  mine: () => apiRequest('/api/v1/orders/me', { method: 'GET' }),
  get: (orderId, token) => apiRequest(withToken(`/api/v1/orders/${orderId}`, token), { method: 'GET' }),
  scanToken: (orderId) => apiRequest(`/api/v1/orders/${orderId}/scan-token`, { method: 'GET' }),
  items: (orderId, token) => apiRequest(withToken(`/api/v1/orders/${orderId}/items`, token), { method: 'GET' }),
  verify: (orderId, scan, token) => apiRequest(withToken(`/api/v1/orders/${orderId}/verify`, token), {
    method: 'POST',
    body: JSON.stringify(scan),
  }),
  markUnavailable: (orderId, itemId, reason, token) => apiRequest(
    withToken(`/api/v1/orders/${orderId}/items/${itemId}/unavailable`, token),
    { method: 'POST', body: JSON.stringify({ reason: reason || null }) },
  ),
};
