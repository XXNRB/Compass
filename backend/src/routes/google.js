// ============================================================================
// Schedulo - Google OAuth routes
// Connects a user's Google account for Gmail, Calendar, and profile access.
// ============================================================================


const express = require('express');
const { google } = require('googleapis');
const { supabase } = require('../config/supabase');
const { rememberFrontendOrigin } = require('../config/frontend');


function getFrontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}


const router = express.Router();


// OAuth2 client created lazily so env vars are loaded first
function getOAuth2Client() {
 return new google.auth.OAuth2(
   process.env.GOOGLE_CLIENT_ID,
   process.env.GOOGLE_CLIENT_SECRET,
   process.env.GOOGLE_REDIRECT_URI
 );
}


// Scopes requested during consent (Gmail read, Calendar, user email)
const SCOPES = [
 'https://www.googleapis.com/auth/gmail.readonly',
 'https://www.googleapis.com/auth/calendar',
 'https://www.googleapis.com/auth/calendar.events',
 'https://www.googleapis.com/auth/userinfo.email',
 'https://www.googleapis.com/auth/userinfo.profile',
];


// Session key where Google OAuth tokens are stored after callback
const SESSION_TOKEN_KEY = 'googleTokens';


/**
* GET /auth/google
* Starts the OAuth flow by redirecting the user to Google's consent screen.
*/
router.get('/auth/google', (req, res) => {
 rememberFrontendOrigin(req);
 const oauth2Client = getOAuth2Client();
 const authUrl = oauth2Client.generateAuthUrl({
   access_type: 'offline',
   scope: SCOPES,
   prompt: 'consent',
 });


 res.redirect(authUrl);
});


/**
* GET /auth/google/callback
* Google redirects here after consent. Exchanges the code for tokens,
* saves them on the session, and returns the user's email.
*/
router.get('/auth/google/callback', async (req, res) => {
 const { code } = req.query;


 if (!code) {
   return res.status(400).json({
     success: false,
     message: 'Authorization code missing',
   });
 }


 try {
   const oauth2Client = getOAuth2Client();
   const { tokens } = await oauth2Client.getToken(code);
   oauth2Client.setCredentials(tokens);


   req.session[SESSION_TOKEN_KEY] = tokens;


   const people = google.people({ version: 'v1', auth: oauth2Client });
   const { data } = await people.people.get({
     resourceName: 'people/me',
     personFields: 'emailAddresses',
   });


   const primaryEmail = data.emailAddresses?.find(
     (entry) => entry.metadata?.primary
   );
   const userEmail =
     primaryEmail?.value || data.emailAddresses?.[0]?.value || null;


   // --- Supabase: persist user profile and Google tokens ---
   let isNewUser = false;


   if (userEmail) {
     try {
       // Look up an existing user by email
       const { data: existingUser, error: lookupError } = await supabase
         .from('users')
         .select('id')
         .eq('email', userEmail)
         .maybeSingle();


       if (lookupError) {
         console.error('Supabase user lookup error:', lookupError.message);
       } else if (!existingUser) {
         // New user: create a row with email and timestamp
         isNewUser = true;


         const { data: newUser, error: insertError } = await supabase
           .from('users')
           .insert({
             email: userEmail,
             updated_at: new Date().toISOString(),
           })
           .select('id')
           .single();


         if (insertError) {
           console.error('Supabase user insert error:', insertError.message);
         } else if (newUser?.id) {
           req.session.userId = newUser.id;
         }
       } else {
         // Returning user: refresh stored Google OAuth tokens
         const { data: updatedUser, error: updateError } = await supabase
           .from('users')
           .update({
             google_tokens: tokens,
             updated_at: new Date().toISOString(),
           })
           .eq('id', existingUser.id)
           .select('id')
           .single();


         if (updateError) {
           console.error('Supabase user update error:', updateError.message);
         } else if (updatedUser?.id) {
           req.session.userId = updatedUser.id;
         } else {
           req.session.userId = existingUser.id;
         }
       }
     } catch (dbError) {
       console.error('Supabase save error:', dbError.message);
     }
   }


   // Redirect to dashboard with email so frontend can display it
   const redirectUrl = `${getFrontendUrl()}/dashboard?email=${encodeURIComponent(userEmail)}&userId=${req.session.userId}&new=${isNewUser}`;
   res.redirect(redirectUrl);
   } catch (error) {
   console.error('Google OAuth callback error:', error.message);
   res.status(500).json({
     success: false,
     message: 'Failed to complete Google authentication',
   });
 }
});


/**
* GET /auth/google/status
* Reports whether the current session has a valid Google connection.
*/
router.get('/auth/google/status', async (req, res) => {
 const tokens = req.session[SESSION_TOKEN_KEY];


 if (!tokens) {
   return res.json({ connected: false });
 }


 try {
   const oauth2Client = getOAuth2Client();
   oauth2Client.setCredentials(tokens);
   const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
   await oauth2.userinfo.get();


   res.json({ connected: true });
 } catch (error) {
   console.error('Google connection status check failed:', error.message);
   res.json({ connected: false });
 }
});


module.exports = router;