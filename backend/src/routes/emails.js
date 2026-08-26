// ============================================================================
// Compass - Email scanning routes
// Triggers Gmail scanning and saves detected events to Supabase.
// ============================================================================


const express = require('express');
const { scanGmailEmails } = require('../services/emailScanner');
const { supabase } = require('../config/supabase');


const router = express.Router();


/**
* GET /emails/scan
* Scans recent Gmail messages, detects scheduling events,
* and saves them to Supabase without duplicates.
*/
router.get('/emails/scan', async (req, res) => {
 if (!req.session.googleTokens) {
   return res.status(401).json({ error: 'Not authenticated with Google' });
 }


 try {
   const results = await scanGmailEmails(req.session.googleTokens);


   // Keep only emails Claude flagged as scheduling-related
   const events = results.filter(
     (item) => item.analysis?.hasSchedulingInfo === true
   );


   // Save detected events to Supabase if user is logged in
   let saved = 0;
   if (req.session.userId) {
     for (const item of events) {
       const newPriority = item.analysis.priority || 3;
       const threadId = item.email.threadId;


       // Deduplicate by Gmail thread: one event row per conversation thread
       if (threadId) {
         const { data: existing, error: lookupError } = await supabase
           .from('events')
           .select('id, priority, title, description, email_count')
           .eq('user_id', req.session.userId)
           .eq('thread_id', threadId)
           .maybeSingle();


         if (lookupError) {
           console.error('Supabase event lookup error:', lookupError.message);
           continue;
         }


         if (existing) {
           // Thread already tracked — bump count; refresh title/description if higher priority
           const updatePayload = {
             email_count: (existing.email_count || 1) + 1,
           };


           if (newPriority > (existing.priority || 0)) {
             updatePayload.title =
               item.analysis.eventTitle || item.email.subject;
             updatePayload.description = item.analysis.reasoning;
             updatePayload.priority = newPriority;
           }


           const { error: updateError } = await supabase
             .from('events')
             .update(updatePayload)
             .eq('id', existing.id);


           if (updateError) {
             console.error('Supabase event update error:', updateError.message);
           }
           continue;
         }
       }


       // New thread (or no threadId) — insert a fresh event row
       const { error } = await supabase.from('events').insert({
        user_id: req.session.userId,
        thread_id: threadId || null,
        email_count: 1,
        title: item.analysis.eventTitle || item.email.subject,
        description: item.analysis.reasoning,
        start_time: null,
        raw_date: item.analysis.eventDate || null,
        event_time: item.analysis.eventTime || null,
        location: item.analysis.location || null,
        source: 'gmail',
        scheduling_type: item.analysis.schedulingType || 'other',
        priority: newPriority,
        status: 'pending',
      });


       if (error) {
         console.error('Supabase event insert error:', error.message);
       } else {
         saved++;
       }
     }
   }


   res.json({
     success: true,
     total: events.length,
     saved,
     events,
   });
 } catch (error) {
   console.error('Gmail scan error:', error.message);
   res.status(500).json({
     success: false,
     message: 'Failed to scan Gmail emails',
   });
 }
});

/**
 * GET /emails/scan/outlook
 * Scans recent Outlook messages and saves scheduling events to Supabase.
 */
router.get('/emails/scan/outlook', async (req, res) => {
    if (!req.session.microsoftTokens) {
      return res.status(401).json({ error: 'Not authenticated with Microsoft' });
    }
  
    try {
      const { scanOutlookEmails } = require('../services/outlookScanner');
      const results = await scanOutlookEmails(req.session.microsoftTokens);
  
      const events = results.filter(
        (item) => item.analysis?.hasSchedulingInfo === true
      );
  
      let saved = 0;
      if (req.session.userId) {
        for (const item of events) {
          const newPriority = item.analysis.priority || 3;
          const threadId = item.email.threadId;
  
          if (threadId) {
            const { data: existing } = await supabase
              .from('events')
              .select('id, priority, email_count')
              .eq('user_id', req.session.userId)
              .eq('thread_id', threadId)
              .maybeSingle();
  
            if (existing) {
              await supabase
                .from('events')
                .update({ email_count: (existing.email_count || 1) + 1 })
                .eq('id', existing.id);
              continue;
            }
          }
  
          const { error } = await supabase.from('events').insert({
            user_id: req.session.userId,
            thread_id: threadId || null,
            email_count: 1,
            title: item.analysis.eventTitle || item.email.subject,
            description: item.analysis.reasoning,
            start_time: null,
            raw_date: item.analysis.eventDate || null,
            event_time: item.analysis.eventTime || null,
            location: item.analysis.location || null,
            source: 'outlook',
            scheduling_type: item.analysis.schedulingType || 'other',
            priority: newPriority,
            status: 'pending',
          });
  
          if (error) {
            console.error('Supabase outlook insert error:', error.message);
          } else {
            saved++;
          }
        }
      }
  
      res.json({ success: true, total: events.length, saved, events });
    } catch (error) {
      console.error('Outlook scan error:', error.message);
      res.status(500).json({ success: false, message: 'Failed to scan Outlook emails' });
    }
  });
  
module.exports = router;
