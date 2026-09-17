import { apiRequest } from './apiClient';

export const ordersApi = {
  mine: () => apiRequest('/api/v1/orders/me', { method: 'GET' }),
};
