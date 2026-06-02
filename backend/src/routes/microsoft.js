// ============================================================================
// Compass - Microsoft Outlook OAuth routes
// Connects a user's Microsoft account for Mail, Calendar, and profile access.
// ============================================================================


const express = require('express');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const https = require('https');


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
   req.session[SESSION_TOKEN_KEY] = {
     accessToken: tokenResponse.accessToken,
     refreshToken: tokenResponse.refreshToken,
     expiresOn: tokenResponse.expiresOn,
     account: tokenResponse.account,
   };
   const userEmail = await fetchUserEmail(tokenResponse.accessToken);
   res.json({ success: true, email: userEmail });
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