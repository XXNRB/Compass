const fs = require('fs');
const envPath = '/Users/kofidadzie-yeboah/projects/schedulo/backend/.env';
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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
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