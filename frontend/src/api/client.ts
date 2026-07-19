import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  r => r,
  err => {
    // Only redirect to login on 401 if we are NOT already on the login page
    // and NOT making internal status/session checks (which can legitimately return 401)
    const url = err.config?.url || '';
    const isStatusCheck = url.includes('/auth/me') ||
      url.includes('/session-status') ||
      url.includes('/tracking/') ||
      url.includes('/timesheet/') ||
      url.includes('/admin/configs');
    if (
      err.response?.status === 401 &&
      !window.location.pathname.includes('/login') &&
      !isStatusCheck
    ) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
