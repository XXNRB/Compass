// ============================================================================
// Compass - Connected email account routes
// Lists the mailboxes a user has connected, for the dashboard/calendar filter.
// ============================================================================

const express = require('express');
const { listConnectedEmails } = require('../services/connectedEmails');

const router = express.Router();


/**
 * GET /connected-emails
 * Returns { accounts: [{ id, email, provider }], primary }. Never includes tokens.
 * primary is the Gmail address this session signed in with (null if unknown).
 */
router.get('/connected-emails', async (req, res) => {
  const userId = req.session.userId || req.query.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const accounts = await listConnectedEmails(userId);
  res.json({ success: true, accounts, primary: req.session.googleEmail || null });
});


module.exports = router;
