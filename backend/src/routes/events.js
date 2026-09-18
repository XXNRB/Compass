// ============================================================================
// Compass - Events API routes
// ============================================================================


const express = require('express');
const { supabase } = require('../config/supabase');
const { addEventToGoogleCalendar } = require('../services/syllabusScanner');


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


/**
* PATCH /events/:id
* Approves or rejects a pending event. Approving a still-pending event also
* adds it to the user's Google Calendar (when connected and a date is
* parseable); rejecting just marks it so the dashboard can drop it from view.
*/
router.patch('/events/:id', async (req, res) => {
 const userId = req.session.userId || req.query.userId || (req.body && req.body.userId);
 const { status } = req.body || {};

 if (!userId) {
   return res.status(401).json({ error: 'Not authenticated' });
 }

 if (status !== 'approved' && status !== 'rejected') {
   return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
 }

 try {
   const { data: event, error: fetchError } = await supabase
     .from('events')
     .select('*')
     .eq('id', req.params.id)
     .eq('user_id', userId)
     .maybeSingle();

   if (fetchError) {
     console.error('Supabase event fetch error:', fetchError.message);
     return res.status(500).json({ error: 'Failed to fetch event' });
   }

   if (!event) {
     return res.status(404).json({ error: 'Event not found' });
   }

   let addedToGoogleCalendar = false;

   // Only insert into Google Calendar the first time a pending event is
   // approved — re-approving an already-approved row is a no-op here.
   if (status === 'approved' && event.status === 'pending' && req.session.googleTokens) {
     const created = await addEventToGoogleCalendar(req.session.googleTokens, {
       eventTitle: event.title,
       eventDate: event.raw_date,
       eventTime: event.event_time,
       location: event.location,
       reasoning: event.description,
     });
     addedToGoogleCalendar = !!created;
   }

   const { data: updated, error: updateError } = await supabase
     .from('events')
     .update({ status })
     .eq('id', req.params.id)
     .select()
     .single();

   if (updateError) {
     console.error('Supabase event update error:', updateError.message);
     return res.status(500).json({ error: 'Failed to update event' });
   }

   res.json({ success: true, event: updated, addedToGoogleCalendar });
 } catch (err) {
   console.error('Event status update error:', err.message);
   res.status(500).json({ error: 'Failed to update event' });
 }
});


module.exports = router;
