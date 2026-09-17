import { apiRequest } from './apiClient';

export const authApi = {
  signup: (payload) => apiRequest('/api/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  login: (payload) => apiRequest('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  me: () => apiRequest('/api/v1/auth/me', { method: 'GET' }),
  logout: () => apiRequest('/api/v1/auth/logout', { method: 'POST' }),
};
