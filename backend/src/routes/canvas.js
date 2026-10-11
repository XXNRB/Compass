// ============================================================================
// Compass - Canvas LMS routes
// Lets a user connect their school's Canvas instance with a personal access
// token, then pulls courses + assignments into the events table.
// ============================================================================

const express = require('express');
const { supabase } = require('../config/supabase');
const secretBox = require('../services/secretBox');
const {
  normalizeCanvasUrl,
  assertPublicCanvasUrl,
  canvasGet,
  fetchCourses,
  fetchAssignmentsForCourse,
  assignmentToEvent,
} = require('../services/canvasScanner');

const router = express.Router();


/**
 * Imports every active course's assignments with due dates as pending
 * events, skipping ones already imported (deduped by assignment id, so the
 * token and session-cookie connections never duplicate each other).
 *
 * @param {string} userId
 * @param {string} baseUrl - Canvas origin
 * @param {string|{ sessionCookie: string }} auth
 */
async function importAssignments(userId, baseUrl, auth) {
  const courses = await fetchCourses(baseUrl, auth);

  const events = [];
  for (const course of courses) {
    const assignments = await fetchAssignmentsForCourse(baseUrl, auth, course.id);
    for (const assignment of assignments) {
      const event = assignmentToEvent({ ...assignment, courseName: course.name }, userId);
      if (event) events.push(event);
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from('events')
    .select('source_id')
    .eq('user_id', userId)
    .eq('source', 'canvas');
  if (existingError) throw new Error(`Canvas dedupe lookup failed: ${existingError.message}`);

  const existingIds = new Set((existing || []).map((row) => row.source_id));
  const newRows = events.filter((event) => !existingIds.has(event.source_id));

  if (newRows.length) {
    const { error: insertError } = await supabase.from('events').insert(newRows);
    if (insertError) throw new Error(`Canvas insert failed: ${insertError.message}`);
  }

  return { coursesFound: courses.length, assignmentsFound: events.length, imported: newRows.length };
}

/**
 * POST /canvas/connect
 * Validates a Canvas URL + API token against the Canvas API, then saves
 * them on the user's row.
 */
router.post('/canvas/connect', async (req, res) => {
  const userId = req.session.userId || req.query.userId || (req.body && req.body.userId);
  const { canvasUrl, canvasToken } = req.body || {};

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!canvasUrl || !canvasToken) {
    return res.status(400).json({ error: 'Canvas URL and API token are required' });
  }

  const normalizedUrl = normalizeCanvasUrl(canvasUrl);

  try {
    // Validate the credentials before saving anything.
    const { data: profile } = await canvasGet(normalizedUrl, '/api/v1/users/self', canvasToken);

    const { error } = await supabase
      .from('users')
      .update({
        canvas_url: normalizedUrl,
        canvas_token: canvasToken,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      console.error('Supabase Canvas credential save error:', error.message);
      return res.status(500).json({ error: 'Failed to save Canvas credentials' });
    }

    res.json({ success: true, canvasUrl: normalizedUrl, canvasName: profile?.name || null });
  } catch (err) {
    console.error('Canvas connect error:', err.message);
    res.status(400).json({ error: 'Could not connect to Canvas. Check your URL and API token.' });
  }
});

/**
 * GET /canvas/status
 * Reports whether the user has Canvas credentials saved.
 */
router.get('/canvas/status', async (req, res) => {
  const userId = req.session.userId || req.query.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('canvas_url')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Supabase Canvas status error:', error.message);
      return res.status(500).json({ error: 'Failed to check Canvas status' });
    }

    res.json({ connected: !!data?.canvas_url, canvasUrl: data?.canvas_url || null });
  } catch (err) {
    console.error('Canvas status error:', err.message);
    res.status(500).json({ error: 'Failed to check Canvas status' });
  }
});

/**
 * POST /canvas/sync
 * Fetches every active course and each course's assignments from Canvas,
 * and saves the ones with due dates as pending events (deduped by
 * assignment id across syncs).
 */
router.post('/canvas/sync', async (req, res) => {
  const userId = req.session.userId || req.query.userId || (req.body && req.body.userId);

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('canvas_url, canvas_token')
      .eq('id', userId)
      .maybeSingle();

    if (userError) {
      console.error('Supabase Canvas credential lookup error:', userError.message);
      return res.status(500).json({ error: 'Failed to load Canvas credentials' });
    }

    if (!user?.canvas_url || !user?.canvas_token) {
      return res.status(400).json({ error: 'Canvas is not connected yet' });
    }

    const result = await importAssignments(userId, user.canvas_url, user.canvas_token);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Canvas sync error:', err.message);
    res.status(500).json({ error: 'Failed to sync Canvas assignments' });
  }
});

// ----------------------------------------------------------------------------
// Session-cookie connection
// The user copies their canvas_session cookie from their own browser; Compass
// stores it encrypted (never the password), uses it only for GET requests to
// that Canvas site, and drops it once Canvas reports it expired. These routes
// act only for the signed-in session user, never a userId from the request.
// ----------------------------------------------------------------------------

// Cookie values are URL-safe tokens; anything else (spaces, ";", newlines)
// would let a pasted value inject extra headers.
const COOKIE_VALUE = /^[A-Za-z0-9%._~+/=-]{20,4096}$/;

function cleanCookie(raw) {
  return String(raw || '')
    .trim()
    .replace(/^canvas_session=/i, '')
    .replace(/^"|"$/g, '')
    .trim();
}

async function loadCookieConnection(userId) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('canvas_url, canvas_session_cookie, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Canvas preferences lookup failed: ${error.message}`);
  return data;
}

async function saveCookieConnection(userId, fields) {
  const { data: row, error: lookupError } = await supabase
    .from('user_preferences')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);

  const values = { ...fields, updated_at: new Date().toISOString() };
  const { error } = row
    ? await supabase.from('user_preferences').update(values).eq('user_id', userId)
    : await supabase.from('user_preferences').insert({ user_id: userId, travel_mode: 'driving', ...values });
  if (error) throw new Error(error.message);
}

const clearCookie = (userId) => saveCookieConnection(userId, { canvas_session_cookie: null });

const isExpired = (error) => error.statusCode === 401 || error.statusCode === 403;

/**
 * POST /canvas/session  { canvasUrl, sessionCookie }
 * Checks the cookie against Canvas, then stores it encrypted.
 */
router.post('/canvas/session', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to Compass first' });
  }
  if (!secretBox.isConfigured()) {
    console.error('SECRETS_KEY is not set; refusing to store a Canvas session cookie');
    return res.status(503).json({ error: 'Canvas session connections are not set up on this server yet' });
  }

  const canvasUrl = normalizeCanvasUrl(req.body?.canvasUrl);
  const sessionCookie = cleanCookie(req.body?.sessionCookie);
  if (!COOKIE_VALUE.test(sessionCookie)) {
    return res.status(400).json({ error: 'That does not look like a canvas_session cookie value. Copy only the Value column.' });
  }

  try {
    await assertPublicCanvasUrl(canvasUrl);
  } catch (urlError) {
    return res.status(400).json({ error: urlError.message });
  }

  try {
    const { data: profile } = await canvasGet(canvasUrl, '/api/v1/users/self', { sessionCookie });
    await saveCookieConnection(userId, {
      canvas_url: canvasUrl,
      canvas_session_cookie: secretBox.encrypt(sessionCookie),
    });
    res.json({ success: true, canvasUrl, canvasName: profile?.name || null });
  } catch (err) {
    if (isExpired(err)) {
      return res.status(400).json({ error: 'Canvas did not accept that cookie. Make sure you are logged in to Canvas and copied canvas_session from the same site.' });
    }
    console.error('Canvas session connect error:', err.message);
    res.status(502).json({ error: 'Could not reach Canvas. Check the address and try again.' });
  }
});

/**
 * GET /canvas/session
 * Whether a session cookie is saved (the cookie itself is never returned).
 */
router.get('/canvas/session', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to Compass first' });
  }
  try {
    const row = await loadCookieConnection(userId);
    res.json({
      connected: Boolean(row?.canvas_session_cookie),
      canvasUrl: row?.canvas_url || null,
      savedAt: row?.canvas_session_cookie ? row.updated_at : null,
    });
  } catch (err) {
    console.error('Canvas session status error:', err.message);
    res.status(500).json({ error: 'Failed to check Canvas connection' });
  }
});

/**
 * DELETE /canvas/session
 * Forgets the saved cookie.
 */
router.delete('/canvas/session', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to Compass first' });
  }
  try {
    await clearCookie(userId);
    res.json({ success: true });
  } catch (err) {
    console.error('Canvas session disconnect error:', err.message);
    res.status(500).json({ error: 'Failed to disconnect Canvas' });
  }
});

/**
 * POST /canvas/session/sync
 * Imports assignments using the saved session cookie. When Canvas says the
 * cookie expired, it's deleted and the response asks the user to reconnect.
 */
router.post('/canvas/session/sync', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Sign in to Compass first' });
  }

  let row;
  let sessionCookie;
  try {
    row = await loadCookieConnection(userId);
    if (!row?.canvas_url || !row?.canvas_session_cookie) {
      return res.status(400).json({ error: 'Canvas is not connected yet', needsConnect: true });
    }
    sessionCookie = secretBox.decrypt(row.canvas_session_cookie);
  } catch (err) {
    console.error('Canvas session load error:', err.message);
    return res.status(500).json({ error: 'Could not load your Canvas connection. Connect Canvas again.', needsConnect: true });
  }

  try {
    const result = await importAssignments(userId, row.canvas_url, { sessionCookie });
    res.json({ success: true, ...result });
  } catch (err) {
    if (isExpired(err)) {
      await clearCookie(userId).catch((clearError) => console.error('Canvas cookie clear error:', clearError.message));
      return res.status(401).json({ error: 'Your Canvas session expired. Copy a fresh canvas_session cookie to reconnect.', needsConnect: true });
    }
    console.error('Canvas session sync error:', err.message);
    res.status(500).json({ error: 'Failed to sync Canvas assignments' });
  }
});

module.exports = router;
