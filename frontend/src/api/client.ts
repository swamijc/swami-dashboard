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
    // and NOT making the initial session-check call (/auth/me)
    if (
      err.response?.status === 401 &&
      !window.location.pathname.includes('/login') &&
      !err.config?.url?.includes('/auth/me')
    ) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
