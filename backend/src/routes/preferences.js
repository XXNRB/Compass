// ============================================================================
// Compass - User preferences routes
// Home address and preferred travel mode, used by the Smart Departure Engine.
// ============================================================================

const express = require('express');
const { supabase } = require('../config/supabase');
const { VALID_TRAVEL_MODES } = require('../services/departureEngine');

const router = express.Router();

/**
 * GET /preferences
 * Returns the user's saved home address and travel mode (travel_mode
 * defaults to "driving" when nothing has been saved yet).
 */
router.get('/preferences', async (req, res) => {
  const userId = req.session.userId || req.query.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('home_address, travel_mode')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Supabase preferences fetch error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch preferences' });
    }

    res.json({
      home_address: data?.home_address || '',
      travel_mode: data?.travel_mode || 'driving',
    });
  } catch (err) {
    console.error('Preferences route error:', err.message);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

/**
 * POST /preferences
 * Upserts the user's home address and preferred travel mode.
 */
router.post('/preferences', async (req, res) => {
  const userId = req.session.userId || req.query.userId || (req.body && req.body.userId);
  const { homeAddress, travelMode } = req.body || {};

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (travelMode && !VALID_TRAVEL_MODES.includes(travelMode)) {
    return res.status(400).json({ error: `travelMode must be one of: ${VALID_TRAVEL_MODES.join(', ')}` });
  }

  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(
        {
          user_id: userId,
          home_address: homeAddress || null,
          travel_mode: travelMode || 'driving',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select()
      .single();

    if (error) {
      console.error('Supabase preferences save error:', error.message);
      return res.status(500).json({ error: 'Failed to save preferences' });
    }

    res.json({ success: true, home_address: data.home_address, travel_mode: data.travel_mode });
  } catch (err) {
    console.error('Preferences save error:', err.message);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

module.exports = router;
