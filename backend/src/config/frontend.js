// ============================================================================
// Compass - Frontend origin handling
// The Vite dev server picks whatever port is free (5173, 5174, ...), so the
// backend can't assume a single frontend URL. It remembers the origin a login
// started from and sends the user back there, and accepts any localhost port
// for CORS outside production.
// ============================================================================

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';


// Accepts "http://host:port/path" or a scheme-less "host:port" and returns the
// bare origin, or null if the value can't be parsed.
function normalizeOrigin(value) {
 if (!value || typeof value !== 'string') return null;
 const withScheme = /^https?:\/\//i.test(value.trim()) ? value.trim() : `http://${value.trim()}`;
 try {
   const { origin } = new URL(withScheme);
   return origin === 'null' ? null : origin;
 } catch (err) {
   return null;
 }
}


function isAllowedOrigin(value) {
 const origin = normalizeOrigin(value);
 if (!origin) return false;

 if (origin === normalizeOrigin(process.env.FRONTEND_URL)) return true;
 if (process.env.NODE_ENV === 'production') return false;

 const { hostname } = new URL(origin);
 return hostname === 'localhost' || hostname === '127.0.0.1';
}


// Called when an OAuth flow starts. Picks the first allowed origin from the
// explicit ?origin= param, then the Origin and Referer headers, and keeps it on
// the session so the callback can redirect back to the same frontend.
function rememberFrontendOrigin(req) {
 const candidates = [req.query.origin, req.get('origin'), req.get('referer')];
 for (const candidate of candidates) {
   if (isAllowedOrigin(candidate)) {
     req.session.frontendOrigin = normalizeOrigin(candidate);
     return;
   }
 }
}


// Where to send the user after a callback. Re-validated so a stale session
// value can never redirect somewhere the allowlist no longer permits.
function getFrontendUrl(req) {
 const remembered = req.session?.frontendOrigin;
 if (remembered && isAllowedOrigin(remembered)) return remembered;
 const configured = normalizeOrigin(process.env.FRONTEND_URL);
 if (configured) return configured;

 warnMissingFrontendUrl();
 return DEFAULT_FRONTEND_URL;
}


let warned = false;
function warnMissingFrontendUrl() {
 if (warned) return;
 warned = true;
 console.warn(
   `FRONTEND_URL is not set and this login did not record a frontend origin; falling back to ${DEFAULT_FRONTEND_URL}. Set FRONTEND_URL in backend/.env.`,
 );
}


module.exports = { isAllowedOrigin, rememberFrontendOrigin, getFrontendUrl };
