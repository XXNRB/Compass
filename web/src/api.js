// Relative by default: in dev, Vite proxies /api to the backend (see
// vite.config.js), so this works on whatever port Vite picks. Set VITE_API_URL
// (e.g. https://api.example.com/api) to point at a backend directly.
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

// OAuth starts on the backend and returns here afterwards, so it needs to know
// which frontend origin (and therefore which port) to send the user back to.
export function authUrl(provider) {
  return `${API_BASE}/auth/${provider}?origin=${encodeURIComponent(window.location.origin)}`;
}
