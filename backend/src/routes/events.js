// ============================================================================
// Compass - Events API routes
// ============================================================================


const express = require('express');
const { supabase } = require('../config/supabase');
const { addEventToGoogleCalendar } = require('../services/syllabusScanner');
const { calculateDeparture } = require('../services/departureEngine');
const { deduplicateUserEvents } = require('../services/eventDedupe');


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
* GET /events/deduplicate
* Removes duplicate exams/quizzes for the current user: same day, same type,
* similar start time. Keeps the most detailed copy. Pass ?dryRun=true to
* preview without deleting.
*/
router.get('/events/deduplicate', async (req, res) => {
 const userId = req.session.userId || req.query.userId;

 if (!userId) {
   return res.status(401).json({ error: 'Not authenticated' });
 }

 try {
   const dryRun = req.query.dryRun === 'true';
   const result = await deduplicateUserEvents(supabase, userId, { dryRun });
   res.json({ success: true, ...result });
 } catch (err) {
   console.error('Event deduplicate error:', err.message);
   res.status(500).json({ error: 'Failed to remove duplicate events' });
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
   let departureFields = {};

   // Only run these the first time a pending event is approved —
   // re-approving an already-approved row is a no-op here.
   if (status === 'approved' && event.status === 'pending') {
     if (req.session.googleTokens) {
       const created = await addEventToGoogleCalendar(req.session.googleTokens, {
         eventTitle: event.title,
         eventDate: event.raw_date,
         eventTime: event.event_time,
         location: event.location,
         reasoning: event.description,
       });
       addedToGoogleCalendar = !!created;
     }

     // Smart Departure Engine: only applies when the event has a location.
     if (event.location) {
       try {
         const { data: prefs, error: prefsError } = await supabase
           .from('user_preferences')
           .select('home_address, travel_mode')
           .eq('user_id', userId)
           .maybeSingle();

         if (prefsError) {
           console.error('Supabase preferences lookup error:', prefsError.message);
         } else if (prefs?.home_address) {
           const departure = await calculateDeparture(event, prefs);
           if (departure) {
             departureFields = {
               departure_time: departure.departureTime.toISOString(),
               travel_duration_minutes: departure.travelDurationMinutes,
               travel_mode_used: departure.travelModeUsed,
             };
           }
         }
       } catch (departureError) {
         console.error('Smart Departure Engine error:', departureError.message);
         // Non-fatal: approval proceeds without a departure recommendation.
       }
     }
   }

   const { data: updated, error: updateError } = await supabase
     .from('events')
     .update({ status, ...departureFields })
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


/**
* PATCH /events/:id/action-items
* Checks or unchecks one action item on an event. Body: { index, done }.
*/
router.patch('/events/:id/action-items', async (req, res) => {
 const userId = req.session.userId || req.query.userId || (req.body && req.body.userId);
 const { index, done } = req.body || {};

 if (!userId) {
   return res.status(401).json({ error: 'Not authenticated' });
 }

 if (!Number.isInteger(index) || typeof done !== 'boolean') {
   return res.status(400).json({ error: 'index (integer) and done (boolean) are required' });
 }

 try {
   const { data: event, error: fetchError } = await supabase
     .from('events')
     .select('action_items')
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

   const items = Array.isArray(event.action_items) ? [...event.action_items] : [];
   if (index < 0 || index >= items.length) {
     return res.status(400).json({ error: 'Action item index out of range' });
   }
   items[index] = { ...items[index], done };

   const { error: updateError } = await supabase
     .from('events')
     .update({ action_items: items })
     .eq('id', req.params.id)
     .eq('user_id', userId);

   if (updateError) {
     console.error('Supabase action item update error:', updateError.message);
     return res.status(500).json({ error: 'Failed to update action item' });
   }

   res.json({ success: true, actionItems: items });
 } catch (err) {
   console.error('Action item update error:', err.message);
   res.status(500).json({ error: 'Failed to update action item' });
 }
});


module.exports = router;
