const fs = require('fs');
const path = require('path');

// Render injects env vars directly; only read the local .env file in development.
if (process.env.NODE_ENV !== 'production') {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] === '#') return;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex);
        const val = trimmed.substring(eqIndex + 1);
        process.env[key] = val;
      }
    });
  }
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const googleRoutes = require('./routes/google');
const microsoftRoutes = require('./routes/microsoft');
const emailsRoutes = require('./routes/emails');
const eventsRoutes = require('./routes/events');
const syllabusRoutes = require('./routes/syllabus');
const calendarSyncRoutes = require('./routes/calendarSync');
const canvasRoutes = require('./routes/canvas');
const preferencesRoutes = require('./routes/preferences');
const { isAllowedOrigin } = require('./config/frontend');

const app = express();
const PORT = process.env.PORT || 3000;

// Reflect any allowed frontend origin (FRONTEND_URL, plus any localhost port in dev).
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)),
  credentials: true,
}));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.json());
// In production the frontend (Vercel) and API (Render) are different sites, so the
// session cookie must be SameSite=None + Secure to be sent on cross-site requests.
// Render terminates TLS at its proxy, so trust it or Express won't set Secure cookies.
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

app.use('/api', googleRoutes);
app.use('/api', microsoftRoutes);
app.use('/api', emailsRoutes);
app.use('/api', eventsRoutes);
app.use('/api', syllabusRoutes);
app.use('/api', calendarSyncRoutes);
app.use('/api', canvasRoutes);
app.use('/api', preferencesRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Compass API is running' });
});

app.listen(PORT, () => {
  console.log(`Schedulo API listening on http://localhost:${PORT}`);
});