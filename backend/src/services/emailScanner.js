// ============================================================================
// Schedulo - Gmail email scanner
// Fetches recent Gmail messages and uses Claude to extract scheduling info.
// ============================================================================


const { google } = require('googleapis');

// Domains to never send to Claude (work / confidential senders)
const BLOCKED_DOMAINS = [
  'mass.gov',
  'suffolkdistrictattorney.com',
];

function isBlockedEmail(from) {
  if (!from) return false;
  return BLOCKED_DOMAINS.some((domain) => from.toLowerCase().includes(domain));
}

const CLAUDE_SYSTEM_PROMPT = `You are a scheduling assistant for a college student. Analyze emails and extract ANY scheduling-related information broadly. This includes:
- Specific meeting times or dates
- Internship, job, or program start/end dates
- Offers to schedule a call or meeting
- Deadlines or due dates
- Events, orientations, or required attendance
- Any request for the student's availability
- Housing application deadlines or move-in dates
- Apartment tours or lease signing appointments


PRIORITY RULES (1-5 scale):


5 = Critical (directly affects academic standing, career, or housing):
- Active back-and-forth with a recruiter, internship coordinator, or employer
- Job interview scheduling or offer letters
- Meeting with professor about grades, academic standing, or probation
- Housing application deadlines, lease signing, or move-in dates
- Apartment tour scheduling or landlord communication
- Financial aid or scholarship deadlines
- Any meeting or deadline that directly affects the student's academic, career, or living situation
- Virtual interviews or informational calls with potential employers


4 = High (important but not immediately critical):
- New internship or job opportunity emails requiring a response
- Meeting requests from professors about coursework or projects
- Major academic deadlines (exams, papers, major presentations)
- Course registration deadlines or add/drop period reminders
- Career fair, networking event, or campus recruiting event
- Housing lottery deadlines or roommate matching deadlines
- Club leadership meetings or important organization events
- Study abroad application deadlines
- Canvas announcements from professors about upcoming tests or projects
- Scholarship application deadlines


3 = Medium (beneficial but flexible):
- General office hours announcements
- Weekly or recurring homework due dates
- Regular assignment reminders (1-2 hours before due)
- Club or organization regular meetings
- Campus events related to career or academics
- Informational internship emails with no direct ask
- Campus housing info sessions or tours
- Tutoring or academic support session scheduling
- Canvas inbox messages from classmates about group projects
- Zoom or virtual meetings related to job opportunities or recruiting


2 = Low (optional or general interest):
- Social events on campus
- Optional campus activities
- Newsletters with event listings
- Alumni network events
- General campus announcements with dates


1 = Minimal (automated or marketing):
- Automated notifications with vague event mentions
- Marketing emails from companies
- Promotional emails with event references
- Mass email blasts to all students


YEAR-BASED CONTEXT:
- Freshman year signals (orientation, intro courses, dorm life, first semester): weight academics and housing higher, internships are 4 not 5
- Sophomore/Junior signals (declaring major, first internship search, campus involvement): balance academics and internships equally at 5
- Senior signals (full-time recruiting, graduation, senior thesis, job offers): weight career and internship items at 5, academics at 4


CATEGORIES TO ALWAYS FLAG (hasSchedulingInfo = true):
- Internship and job opportunities
- Academic meetings and deadlines
- Housing applications, tours, lease signings, move-in dates
- Career fairs and recruiting events
- Financial aid deadlines
- Study abroad opportunities
- Health and wellness appointments (counseling, medical)
- Any email asking for the student's availability


Return ONLY a valid JSON object with these fields:
- hasSchedulingInfo (boolean): true if ANY scheduling info is present
- eventTitle (string or null): name of the event or meeting
- eventDate (string or null): the MOST SPECIFIC date mentioned. Prefer formats like "June 1, 2026" or "2026-06-01" over vague ranges like "Summer 2026". If multiple dates exist, pick the earliest upcoming one. If only a vague season is mentioned with no specific date, return null.- eventTime (string or null): specific time if mentioned, otherwise null
- location (string or null): location if mentioned
- priority (number 1-5): use the priority rules above
- schedulingType (string): one of "internship", "job", "academic", "assignment", "deadline", "course_registration", "housing", "career_event", "meeting_request", "availability_request", "financial", "health", "social", "other"- reasoning (string): brief explanation of priority assigned


If no scheduling info found return hasSchedulingInfo: false and null for other fields.`;
/**
* Builds an OAuth2 client from stored Google tokens.
*/
function createOAuth2Client(googleTokens) {
 const oauth2Client = new google.auth.OAuth2(
   process.env.GOOGLE_CLIENT_ID,
   process.env.GOOGLE_CLIENT_SECRET,
   process.env.GOOGLE_REDIRECT_URI
 );
 oauth2Client.setCredentials(googleTokens);
 return oauth2Client;
}


/**
* Reads a message header value by name (case-insensitive).
*/
function getHeader(headers, name) {
 const header = headers?.find(
   (entry) => entry.name?.toLowerCase() === name.toLowerCase()
 );
 return header?.value || null;
}


/**
* Extracts subject, from, date, snippet, and threadId from a Gmail message resource.
*/
function parseGmailMessage(message) {
 const headers = message.payload?.headers || [];


 return {
   id: message.id,
   threadId: message.threadId || null,
   subject: getHeader(headers, 'Subject'),
   from: getHeader(headers, 'From'),
   date: getHeader(headers, 'Date'),
   snippet: message.snippet || '',
 };
}


/**
* Parses JSON from Claude's text response (handles optional markdown fences).
*/
function parseClaudeJson(text) {
 const trimmed = text.trim();
 const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
 const jsonText = fenced ? fenced[1].trim() : trimmed;
 return JSON.parse(jsonText);
}


/**
* Sends one email to Claude and returns structured scheduling fields.
*
* @param {{ subject: string|null, from: string|null, date: string|null, snippet: string }} email
* @returns {Promise<object>}
*/
async function analyzeEmailWithClaude(email) {
 try {
   const Anthropic = require('@anthropic-ai/sdk');


   const client = new Anthropic({
     apiKey: process.env.ANTHROPIC_API_KEY,
   });


   const userContent = [
     `Subject: ${email.subject || '(no subject)'}`,
     `From: ${email.from || '(unknown)'}`,
     `Date: ${email.date || '(unknown)'}`,
     `Snippet: ${email.snippet || ''}`,
   ].join('\n');


   const response = await client.messages.create({
     model: 'claude-haiku-4-5-20251001',
     max_tokens: 512,
     system: CLAUDE_SYSTEM_PROMPT,
     messages: [{ role: 'user', content: userContent }],
   });


   const textBlock = response.content?.find((block) => block.type === 'text');
   if (!textBlock?.text) {
     return { hasSchedulingInfo: false };
   }


   const result = parseClaudeJson(textBlock.text);
   console.log('Claude analyzed:', email.subject, '→', result.hasSchedulingInfo, result.eventTitle || '');
   return result; 
 } catch (error) {
   console.error('Claude email analysis failed:', error.message);
   return { hasSchedulingInfo: false };
 }
}


/**
* Fetches the 20 most recent Gmail messages and analyzes each with Claude.
*
* @param {object} googleTokens - OAuth tokens from the user's Google session
* @returns {Promise<Array<{ email: object, analysis: object }>>}
*/
async function scanGmailEmails(googleTokens) {
 const oauth2Client = createOAuth2Client(googleTokens);
 const gmail = google.gmail({ version: 'v1', auth: oauth2Client });


 // List the 20 newest message IDs in the inbox
 const listResponse = await gmail.users.messages.list({
   userId: 'me',
   maxResults: 20,
 });


 const messageRefs = listResponse.data.messages || [];
 if (messageRefs.length === 0) {
   return [];
 }


 // Fetch metadata (subject, from, date) and snippet for each message
 const emails = await Promise.all(
   messageRefs.map(async (ref) => {
     const { data: message } = await gmail.users.messages.get({
       userId: 'me',
       id: ref.id,
       format: 'metadata',
       metadataHeaders: ['Subject', 'From', 'Date'],
     });


     return parseGmailMessage(message);
   })
 );


 // Analyze each email with Claude and collect results
// Analyze each email with Claude one at a time to avoid rate limits
const results = [];
for (const email of emails) {
 if (isBlockedEmail(email.from)) {
   console.log('Skipping confidential email from:', email.from);
   continue;
 }
 const analysis = await analyzeEmailWithClaude(email);
 results.push({ email, analysis });
 // Small delay between requests to respect rate limits
 await new Promise(resolve => setTimeout(resolve, 500));
}


 return results;
}


module.exports = { scanGmailEmails, analyzeEmailWithClaude };
