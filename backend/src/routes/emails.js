// ============================================================================
// Compass - Email scanning routes
// Triggers Gmail/Outlook scanning and saves detected events to Supabase.
// ============================================================================


const express = require('express');
const { scanGmailEmails } = require('../services/emailScanner');
const { supabase } = require('../config/supabase');
const { listConnectedEmails, updateConnectedEmailTokens } = require('../services/connectedEmails');
const { saveScannedEmail } = require('../services/applicationTracker');


const router = express.Router();

// The login auto-scan looks at the last day only, capped so a busy inbox
// can't turn one login into dozens of Claude calls.
const AUTO_SCAN_QUERY = 'newer_than:1d';
const AUTO_SCAN_MAX_RESULTS = 30;


/**
* The signed-in user's Gmail accounts (with tokens). The session's own login
* is included even if it's missing from connected_emails. Stored tokens are
* only ever loaded for req.session.userId, never a userId from the query.
*/
async function gmailAccounts(req) {
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
* Saves each analyzed email that Claude flagged; returns counts.
*/
async function saveResults(userId, items, { source }) {
 let saved = 0;
 let updated = 0;
 for (const item of items) {
   const outcome = await saveScannedEmail(supabase, userId, item, { source, accountEmail: item.accountEmail });
   if (outcome === 'inserted') saved += 1;
   if (outcome === 'updated') updated += 1;
 }
 return { saved, updated };
}


/**
* GET /emails/scan
* Scans ONE Gmail account and saves its scheduling events.
*
* Query:
*   account - which connected Gmail address to scan. Omitted = the primary
*             account (the one the user signed in with); secondary accounts
*             are only scanned when named here.
*   window  - "1d" limits the scan to the last day (the login auto-scan).
*   after   - with window=1d, epoch seconds of the previous auto-scan, so a
*             second login the same day doesn't re-analyze the same emails.
*/
router.get('/emails/scan', async (req, res) => {
 const accounts = await gmailAccounts(req);
 if (accounts.length === 0) {
   return res.status(401).json({ error: 'Not authenticated with Google' });
 }

 const requested = typeof req.query.account === 'string' ? req.query.account.trim().toLowerCase() : '';
 const primaryEmail = (req.session.googleEmail || accounts[0].email || '').toLowerCase();
 const target = accounts.find((account) => (account.email || '').toLowerCase() === (requested || primaryEmail))
   || (!requested ? accounts[0] : null);
 if (!target) {
   return res.status(404).json({ error: `${req.query.account} is not one of your connected Gmail accounts` });
 }

 const autoScan = req.query.window === '1d';
 const after = Number.parseInt(req.query.after, 10);
 const query = autoScan
   ? [AUTO_SCAN_QUERY, Number.isFinite(after) && after > 0 ? `after:${after}` : ''].filter(Boolean).join(' ')
   : undefined;

 try {
   let results;
   try {
     results = await scanGmailEmails(target.tokens, {
       onTokens: target.id ? (tokens) => updateConnectedEmailTokens(target.id, tokens) : undefined,
       ...(autoScan ? { query, maxResults: AUTO_SCAN_MAX_RESULTS } : {}),
     });
   } catch (scanError) {
     console.error(`Gmail scan failed for ${target.email}:`, scanError.message);
     return res.status(502).json({
       success: false,
       message: `Could not scan ${target.email}. Try reconnecting the account.`,
     });
   }

   // Keep only emails Claude flagged as scheduling-related
   const events = results
     .filter((item) => item.analysis?.hasSchedulingInfo === true)
     .map((item) => ({ ...item, accountEmail: target.email }));

   const counts = req.session.userId
     ? await saveResults(req.session.userId, events, { source: 'gmail' })
     : { saved: 0, updated: 0 };

   res.json({
     success: true,
     account: target.email,
     scannedMessages: results.length,
     total: events.length,
     ...counts,
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

    const events = results
      .filter((item) => item.analysis?.hasSchedulingInfo === true)
      .map((item) => ({ ...item, accountEmail: req.session.microsoftEmail || null }));

    const counts = userId
      ? await saveResults(userId, events, { source: 'outlook' })
      : { saved: 0, updated: 0 };

    res.json({ success: true, total: events.length, ...counts, events });
  } catch (error) {
    console.error('Outlook scan error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to scan Outlook emails' });
  }
});

module.exports = router;
