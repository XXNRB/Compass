// ============================================================================
// Schedulo - Outlook email scanner
// Fetches recent Outlook messages via Microsoft Graph and uses Claude to
// extract scheduling information (same analysis pipeline as Gmail).
// ============================================================================

const https = require('https');
const { analyzeEmailWithClaude } = require('./emailScanner');

// Microsoft Graph endpoint: 20 newest messages with fields needed for analysis
const GRAPH_MESSAGES_URL =
  'https://graph.microsoft.com/v1.0/me/messages'
  + '?$top=20'
  + '&$select=subject,from,receivedDateTime,bodyPreview,conversationId'
  + '&$orderby=receivedDateTime desc';

/**
 * Performs an HTTPS GET request using Node's built-in https module.
 *
 * @param {string} url - Full request URL
 * @param {string} accessToken - Microsoft OAuth access token
 * @returns {Promise<object>} Parsed JSON response body
 */
function graphGet(url, accessToken) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
      (response) => {
        let body = '';

        response.on('data', (chunk) => {
          body += chunk;
        });

        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(
                `Microsoft Graph API error (${response.statusCode}): ${body}`,
              ),
            );
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (parseError) {
            reject(new Error(`Failed to parse Graph API response: ${parseError.message}`));
          }
        });
      },
    );

    request.on('error', reject);
  });
}

/**
 * Maps a Microsoft Graph message resource to our normalized email shape.
 *
 * @param {object} message - Single item from Graph API `value` array
 * @returns {{ id: string, threadId: string|null, subject: string|null, from: string|null, date: string|null, snippet: string }}
 */
function parseOutlookMessage(message) {
  const fromAddress = message.from?.emailAddress?.address || null;

  return {
    id: message.id,
    threadId: message.conversationId || null,
    subject: message.subject || null,
    from: fromAddress,
    date: message.receivedDateTime || null,
    snippet: message.bodyPreview || '',
  };
}

/**
 * Waits for the given number of milliseconds (used between Claude calls).
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetches the 20 most recent Outlook messages and analyzes each with Claude.
 *
 * @param {{ accessToken: string }} microsoftTokens - OAuth tokens from the user's Microsoft session
 * @returns {Promise<Array<{ email: object, analysis: object }>>}
 */
async function scanOutlookEmails(microsoftTokens) {
  const accessToken = microsoftTokens?.accessToken;
  if (!accessToken) {
    throw new Error('Microsoft access token is required to scan Outlook emails.');
  }

  // Fetch messages from Microsoft Graph (no external HTTP libraries)
  const graphResponse = await graphGet(GRAPH_MESSAGES_URL, accessToken);
  const messages = graphResponse.value || [];

  if (messages.length === 0) {
    return [];
  }

  const emails = messages.map(parseOutlookMessage);

  // Analyze each email one at a time to avoid Claude rate limits
  const results = [];
  for (const email of emails) {
    const analysis = await analyzeEmailWithClaude(email);
    results.push({ email, analysis });

    // 500ms pause between requests
    await delay(500);
  }

  return results;
}

module.exports = { scanOutlookEmails };
