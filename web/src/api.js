// Backend origin: VITE_API_URL wins if set; otherwise production builds use the
// Render backend and local dev uses the backend on localhost:3000.
const PRODUCTION_API_URL = 'https://compass-lpmk.onrender.com';
const DEV_API_URL = 'http://localhost:3000';

const API_ORIGIN = (
  import.meta.env.VITE_API_URL || (import.meta.env.PROD ? PRODUCTION_API_URL : DEV_API_URL)
).replace(/\/+$/, '');

// All backend routes are mounted under /api.
export const API_BASE = `${API_ORIGIN}/api`;

// OAuth starts on the backend and returns here afterwards, so it needs to know
// which frontend origin (and therefore which port) to send the user back to.
export function authUrl(provider) {
  return `${API_BASE}/auth/${provider}?origin=${encodeURIComponent(window.location.origin)}`;
}
