// ============================================================================
// Compass - Email scanning routes
// Triggers Gmail scanning and saves detected events to Supabase.
// ============================================================================


const express = require('express');
const { scanGmailEmails } = require('../services/emailScanner');
const { supabase } = require('../config/supabase');
const { listConnectedEmails, updateConnectedEmailTokens } = require('../services/connectedEmails');


const router = express.Router();


/**
* Event columns for the action-item checklist, exam/assignment topics, and
* the email body. Action items are stored as { text, done } so the
* dashboard can persist checkbox state.
*/
function emailDetailFields(item) {
 return {
   action_items: (item.analysis.actionItems || []).map((text) => ({ text, done: false })),
   topics: item.analysis.topicsOrContent || null,
   email_body: item.email.body || item.email.snippet || null,
 };
}


/**
* Gmail accounts to scan: every connected Gmail account for the signed-in
* user, or just the session's own login for users who haven't signed in
* since connected_emails existed. Stored tokens are only ever loaded for
* req.session.userId, never a userId from the query string.
*/
async function gmailAccountsToScan(req) {
 const accounts = req.session.userId
   ? await listConnectedEmails(req.session.userId, { provider: 'gmail', withTokens: true })
   : [];

 const sessionEmail = req.session.googleEmail || null;
 const sessionListed = sessionEmail && accounts.some((account) => account.email === sessionEmail);
 if (req.session.googleTokens && !sessionListed) {
   accounts.unshift({ id: null, email: sessionEmail, tokens: req.session.googleTokens });
 }
 return accounts;
}


/**
* GET /emails/scan
* Scans recent Gmail messages in every connected Gmail account, detects
* scheduling events, tags each with its account, and saves them to Supabase
* without duplicates.
*/
router.get('/emails/scan', async (req, res) => {
 const accounts = await gmailAccountsToScan(req);
 if (accounts.length === 0) {
   return res.status(401).json({ error: 'Not authenticated with Google' });
 }


 try {
   // Scan accounts one at a time (Claude rate limits); one account's expired
   // or revoked token shouldn't stop the rest.
   const events = [];
   const failedAccounts = [];
   for (const account of accounts) {
     try {
       const results = await scanGmailEmails(account.tokens, {
         onTokens: account.id ? (tokens) => updateConnectedEmailTokens(account.id, tokens) : undefined,
       });
       for (const item of results) {
         // Keep only emails Claude flagged as scheduling-related
         if (item.analysis?.hasSchedulingInfo === true) {
           events.push({ ...item, accountEmail: account.email });
         }
       }
     } catch (accountError) {
       console.error(`Gmail scan failed for ${account.email}:`, accountError.message);
       failedAccounts.push(account.email);
     }
   }

   if (failedAccounts.length === accounts.length) {
     return res.status(502).json({
       success: false,
       message: `Could not scan ${failedAccounts.join(', ')}. Try reconnecting the account.`,
     });
   }


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
           // Also backfills the account on rows saved before events.source_email existed
           const updatePayload = {
             email_count: (existing.email_count || 1) + 1,
             source_email: item.accountEmail,
           };


           if (newPriority > (existing.priority || 0)) {
             updatePayload.title =
               item.analysis.eventTitle || item.email.subject;
             updatePayload.description = item.analysis.reasoning;
             updatePayload.priority = newPriority;
             Object.assign(updatePayload, emailDetailFields(item));
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
        source_email: item.accountEmail,
        scheduling_type: item.analysis.schedulingType || 'other',
        priority: newPriority,
        status: 'pending',
        ...emailDetailFields(item),
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
     accountsScanned: accounts.length - failedAccounts.length,
     failedAccounts,
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
    const userId = req.session.userId || req.query.userId;

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
      if (userId) {
        for (const item of events) {
          const newPriority = item.analysis.priority || 3;
          const threadId = item.email.threadId;

          if (threadId) {
            const { data: existing } = await supabase
              .from('events')
              .select('id, priority, email_count')
              .eq('user_id', userId)
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
            user_id: userId,
            thread_id: threadId || null,
            email_count: 1,
            title: item.analysis.eventTitle || item.email.subject,
            description: item.analysis.reasoning,
            start_time: null,
            raw_date: item.analysis.eventDate || null,
            event_time: item.analysis.eventTime || null,
            location: item.analysis.location || null,
            source: 'outlook',
            source_email: req.session.microsoftEmail || null,
            scheduling_type: item.analysis.schedulingType || 'other',
            priority: newPriority,
            status: 'pending',
            ...emailDetailFields(item),
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
