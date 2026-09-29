// ============================================================================
// Compass - Microsoft Outlook OAuth routes
// Connects a user's Microsoft account for Mail, Calendar, and profile access.
// ============================================================================


const express = require('express');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const https = require('https');
const { supabase } = require('../config/supabase');
const { rememberFrontendOrigin, getFrontendUrl } = require('../config/frontend');
const { upsertConnectedEmail } = require('../services/connectedEmails');


const router = express.Router();


const SCOPES = [
 'Mail.Read',
 'Calendars.ReadWrite',
 'User.Read',
 'offline_access',
];


const SESSION_TOKEN_KEY = 'microsoftTokens';


function getMsalClient() {
 const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
 return new ConfidentialClientApplication({
   auth: {
     clientId: process.env.MICROSOFT_CLIENT_ID,
     clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
     authority: `https://login.microsoftonline.com/${tenantId}`,
   },
 });
}


function fetchUserEmail(accessToken) {
 return new Promise((resolve, reject) => {
   const options = {
     hostname: 'graph.microsoft.com',
     path: '/v1.0/me?$select=mail,userPrincipalName',
     method: 'GET',
     headers: {
       'Authorization': `Bearer ${accessToken}`,
       'Content-Type': 'application/json',
     },
   };
   const req = https.request(options, (res) => {
     let data = '';
     res.on('data', (chunk) => { data += chunk; });
     res.on('end', () => {
       try {
         const profile = JSON.parse(data);
         resolve(profile.mail || profile.userPrincipalName || null);
       } catch (e) { reject(e); }
     });
   });
   req.on('error', reject);
   req.end();
 });
}


router.get('/auth/microsoft', async (req, res) => {
 rememberFrontendOrigin(req);
 try {
   const msalClient = getMsalClient();
   const authUrl = await msalClient.getAuthCodeUrl({
     scopes: SCOPES,
     redirectUri: process.env.MICROSOFT_REDIRECT_URI,
   });
   res.redirect(authUrl);
 } catch (error) {
   console.error('Microsoft OAuth start error:', error.message);
   res.status(500).json({ success: false, message: 'Failed to start Microsoft authentication' });
 }
});


router.get('/auth/microsoft/callback', async (req, res) => {
 const { code } = req.query;
 if (!code) {
   return res.status(400).json({ success: false, message: 'Authorization code missing' });
 }
 try {
   const msalClient = getMsalClient();
   const tokenResponse = await msalClient.acquireTokenByCode({
     code,
     scopes: SCOPES,
     redirectUri: process.env.MICROSOFT_REDIRECT_URI,
   });

   const tokens = {
     accessToken: tokenResponse.accessToken,
     refreshToken: tokenResponse.refreshToken,
     expiresOn: tokenResponse.expiresOn,
     account: tokenResponse.account,
   };
   req.session[SESSION_TOKEN_KEY] = tokens;

   const userEmail = await fetchUserEmail(tokenResponse.accessToken);
   req.session.microsoftEmail = userEmail;

   // --- Supabase: persist user profile and Microsoft tokens ---
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
         // New user: create a row with email and Microsoft tokens
         const { data: newUser, error: insertError } = await supabase
           .from('users')
           .insert({
             email: userEmail,
             microsoft_tokens: tokens,
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
         // Returning user: refresh stored Microsoft OAuth tokens
         const { data: updatedUser, error: updateError } = await supabase
           .from('users')
           .update({
             microsoft_tokens: tokens,
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

     await upsertConnectedEmail(req.session.userId, userEmail, 'outlook', tokens);
   }

   // Redirect to dashboard with email so frontend can display it
   const redirectUrl = `${getFrontendUrl(req)}/dashboard?email=${encodeURIComponent(userEmail)}&userId=${req.session.userId}`;
   res.redirect(redirectUrl);
 } catch (error) {
   console.error('Microsoft OAuth callback error:', error.message);
   res.status(500).json({ success: false, message: 'Failed to complete Microsoft authentication' });
 }
});


router.get('/auth/microsoft/status', async (req, res) => {
 const tokens = req.session[SESSION_TOKEN_KEY];
 if (!tokens || !tokens.accessToken) {
   return res.json({ connected: false });
 }
 try {
   await fetchUserEmail(tokens.accessToken);
   res.json({ connected: true });
 } catch (error) {
   console.error('Microsoft status check failed:', error.message);
   res.json({ connected: false });
 }
});


module.exports = router;