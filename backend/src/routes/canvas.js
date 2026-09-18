// ============================================================================
// Compass - Canvas LMS routes
// Lets a user connect their school's Canvas instance with a personal access
// token, then pulls courses + assignments into the events table.
// ============================================================================

const express = require('express');
const { supabase } = require('../config/supabase');
const {
  normalizeCanvasUrl,
  canvasGet,
  fetchCourses,
  fetchAssignmentsForCourse,
  assignmentToEvent,
} = require('../services/canvasScanner');

const router = express.Router();

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

    const courses = await fetchCourses(user.canvas_url, user.canvas_token);

    const events = [];
    for (const course of courses) {
      const assignments = await fetchAssignmentsForCourse(user.canvas_url, user.canvas_token, course.id);
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

    if (existingError) {
      console.error('Supabase Canvas dedupe lookup error:', existingError.message);
      return res.status(500).json({ error: 'Failed to check existing Canvas events' });
    }

    const existingIds = new Set((existing || []).map((row) => row.source_id));
    const newRows = events.filter((event) => !existingIds.has(event.source_id));

    if (newRows.length) {
      const { error: insertError } = await supabase.from('events').insert(newRows);
      if (insertError) {
        console.error('Supabase Canvas insert error:', insertError.message);
        return res.status(500).json({ error: 'Failed to save Canvas assignments' });
      }
    }

    res.json({
      success: true,
      coursesFound: courses.length,
      assignmentsFound: events.length,
      imported: newRows.length,
    });
  } catch (err) {
    console.error('Canvas sync error:', err.message);
    res.status(500).json({ error: 'Failed to sync Canvas assignments' });
  }
});

module.exports = router;
