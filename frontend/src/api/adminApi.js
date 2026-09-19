import { apiRequest } from './apiClient';

export const adminApi = {
  products: (q) => apiRequest(`/api/v1/admin/products${q ? `?q=${encodeURIComponent(q)}` : ''}`, { method: 'GET' }),
  orders: () => apiRequest('/api/v1/admin/orders', { method: 'GET' }),
  createOrder: (payload) => apiRequest('/api/v1/admin/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
};
