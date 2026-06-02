// ============================================================================
// Compass - Events API routes
// ============================================================================


const express = require('express');
const { supabase } = require('../config/supabase');


const router = express.Router();


/**
* GET /events
* Returns all events for the logged-in user.
*/
router.get('/events', async (req, res) => {
 const userId = req.session.userId || req.query.userId;


 if (!userId) {
   return res.status(401).json({ error: 'Not authenticated' });
 }


 try {
   const { data, error } = await supabase
     .from('events')
     .select('*')
     .eq('user_id', userId)
     .order('created_at', { ascending: false });


   if (error) {
     console.error('Supabase events fetch error:', error.message);
     return res.status(500).json({ message: 'Failed to fetch events' });
   }


   res.json({ success: true, events: data || [] });
 } catch (err) {
   console.error('Events route error:', err.message);
   res.status(500).json({ message: 'Failed to fetch events' });
 }
});


module.exports = router;
