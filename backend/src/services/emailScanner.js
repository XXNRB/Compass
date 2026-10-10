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

// Cap on email body length sent to Claude and stored in Supabase. Long
// newsletters and reply chains otherwise blow up token cost and row size.
const MAX_BODY_CHARS = 8000;

const CLAUDE_SYSTEM_PROMPT = `You are a scheduling assistant for a college student. Analyze emails and extract ANY scheduling-related information broadly. This includes:
- Specific meeting times or dates
- Internship, job, or program start/end dates
- Offers to schedule a call or meeting
- Deadlines or due dates
- Events, orientations, or required attendance
- Any request for the student's availability
- Housing application deadlines or move-in dates
- Apartment tours or lease signing appointments


REJECTIONS OVERRIDE EVERYTHING ELSE.
First decide whether the email tells the student they were turned down for a job, internship, program, scholarship, or housing application. Typical wording: "we have decided to move forward with other candidates", "you were not selected", "we will not be moving forward with your application", "the position has been filled", "we regret to inform you", often introduced by "Unfortunately". Judge the meaning, not single words: "unfortunately the info session moved to Friday" is NOT a rejection, and a conditional like "if you are not selected, you will be notified" is NOT a rejection.
If it IS a rejection:
- Set isRejection to true and hasSchedulingInfo to true
- Set priority to 1 (this overrides the deadline rule and every priority rule below)
- Set hasSpecificDeadline to false, actionItems to [] (no "monitor application" or follow-up items), topicsOrContent to null, eventDate and eventTime to null
- Set eventTitle to the role and organization (e.g. "Roblox Software Engineering Intern application")
- Set reasoning to exactly "Application rejected"


DEADLINES ARE THE MOST IMPORTANT THING YOU DETECT (for anything that is not a rejection).
Read the ENTIRE email body carefully for deadlines — they are often buried in the middle or end of the email, not the subject line.
If the email mentions ANY specific due date or deadline the student must meet (e.g. "due Friday", "submit by March 3", "complete within 48 hours", "respond by end of day", "expires on June 1"):
- Set hasSpecificDeadline to true
- Set priority to 5, REGARDLESS of category. This overrides every other priority rule below. A deadline on a marketing-looking or low-category email is STILL priority 5.
- Put the deadline date in eventDate and the deadline time (if any) in eventTime
- Mention the deadline explicitly in reasoning
Only vague, non-binding dates ("sometime this summer", "in the coming weeks") do NOT count as a specific deadline.


PRIORITY RULES (1-5 scale, applied ONLY when there is no specific deadline):


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
- isRejection (boolean): true if the email rejects the student's application (see REJECTIONS above)
- applicationStage (string or null): for job/internship applications only, where this email puts the application:
  "applied" = application received/submitted confirmation;
  "interviewing" = the student is advancing: invited to interview, schedule a call, take an assessment, or "next steps" in the hiring process;
  "offer" = an offer is extended ("pleased to offer you", "congratulations ... offer");
  "rejected" = the application was turned down (always "rejected" when isRejection is true).
  Rejection wins over everything: "thank you for interviewing ... unfortunately" is "rejected", not "interviewing". Use null for anything that isn't about a specific application (newsletters, job alerts, career fairs).
- organization (string or null): the employer or program the email is about (e.g. "Fidelity", "Roblox"), not the applicant-tracking system that sent it
- hasSchedulingInfo (boolean): true if ANY scheduling info is present, or if isRejection is true
- eventTitle (string or null): name of the event or meeting
- eventDate (string or null): the MOST SPECIFIC date mentioned. Prefer formats like "June 1, 2026" or "2026-06-01" over vague ranges like "Summer 2026". If there is a deadline, use the deadline date. Otherwise, if multiple dates exist, pick the earliest upcoming one. If only a vague season is mentioned with no specific date, return null.
- eventTime (string or null): specific time if mentioned, otherwise null
- location (string or null): location if mentioned
- hasSpecificDeadline (boolean): true if the email states a specific due date or deadline the student must meet
- priority (number 1-5): 5 if hasSpecificDeadline is true; otherwise use the priority rules above
- schedulingType (string): one of "internship", "job", "academic", "assignment", "deadline", "course_registration", "housing", "career_event", "meeting_request", "availability_request", "financial", "health", "social", "other"
- actionItems (array of strings): specific, concrete things the student needs to do because of this email, each a short imperative phrase that includes the deadline when there is one (e.g. "Complete Roblox online assessment by Oct 3", "Submit housing application by Wednesday", "Reply with availability for a call"). Return [] if nothing is required.
- topicsOrContent (string or null): for an exam, quiz, assignment, or assessment, what it covers (chapters, topics, format, length, allowed materials). null if not applicable or not stated.
- reasoning (string): brief explanation of priority assigned


For "interviewing" or "offer", set priority to 5 and list the concrete next steps in actionItems (e.g. "Schedule interview with Fidelity by Oct 14", "Complete HireVue interview", "Respond to offer by Nov 1").

If no scheduling info found return isRejection: false, applicationStage: null, organization: null, hasSchedulingInfo: false, hasSpecificDeadline: false, actionItems: [], and null for other fields.`;

// Unambiguous rejection wording. Checked in code as well as in the prompt so a
// rejection is never saved as a priority-5 "deadline" if the model misses it.
// Bare "unfortunately" / "not selected" are left to the model: alone they also
// appear in rescheduling notices and conditional sentences.
const REJECTION_PATTERNS = [
  /(?:move|moving) forward with other (?:candidates|applicants)/i,
  /(?:decided|chosen|chose) to (?:proceed|pursue|go) (?:forward )?with other (?:candidates|applicants)/i,
  /(?:will|won't|will not|are not|aren't) (?:be )?(?:moving|move) forward with your (?:application|candidacy)/i,
  /decided not to (?:move forward|proceed) with your/i,
  /you (?:have|were) not (?:been )?selected/i,
  /we regret to inform you/i,
  /(?:position|role) has (?:already )?been filled/i,
  /no longer (?:being )?(?:under consideration|considered)/i,
  /unable to offer you (?:a|the) (?:position|role|internship|job)/i,
];

const REJECTION_NOTE = 'Application rejected';

function looksLikeRejection(email) {
  const text = [email?.subject, email?.body || email?.snippet].filter(Boolean).join('\n');
  return REJECTION_PATTERNS.some((pattern) => pattern.test(text));
}
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
* Decodes a Gmail base64url body part to a UTF-8 string.
*/
function decodeBase64Url(data) {
 return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}


/**
* Rough HTML-to-text for emails that have no text/plain part.
*/
function htmlToText(html) {
 return html
   .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
   .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
   .replace(/<[^>]+>/g, ' ')
   .replace(/&nbsp;/gi, ' ')
   .replace(/&amp;/gi, '&')
   .replace(/&lt;/gi, '<')
   .replace(/&gt;/gi, '>')
   .replace(/&quot;/gi, '"')
   .replace(/&#39;/gi, "'");
}


/**
* Collects the decoded bodies of every part with the given MIME type,
* walking nested multipart payloads. Attachments are skipped.
*/
function collectParts(part, mimeType, out = []) {
 if (!part) return out;
 if (part.mimeType === mimeType && part.body?.data && !part.filename) {
   out.push(decodeBase64Url(part.body.data));
 }
 for (const child of part.parts || []) collectParts(child, mimeType, out);
 return out;
}


/**
* Extracts the plain-text body from a Gmail payload, falling back to
* stripped HTML. Whitespace is collapsed and the result is capped.
*/
function extractPlainTextBody(payload) {
 let text = collectParts(payload, 'text/plain').join('\n');
 if (!text.trim()) {
   text = htmlToText(collectParts(payload, 'text/html').join('\n'));
 }
 return text
   .replace(/[ \t ]+/g, ' ')
   .replace(/\s*\n\s*/g, '\n')
   .replace(/\n{3,}/g, '\n\n')
   .trim()
   .slice(0, MAX_BODY_CHARS);
}


/**
* Extracts subject, from, date, snippet, body, and threadId from a Gmail message resource.
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
   body: extractPlainTextBody(message.payload),
 };
}


/**
* Normalizes Claude's output: guarantees an actionItems string array and
* enforces the rules even if the model forgot to apply them. A rejection
* (flagged by the model or matched by REJECTION_PATTERNS) is priority 1 with
* no action items; otherwise any specific deadline is priority 5.
*/
function normalizeAnalysis(result, email) {
 if (result.isRejection === true || looksLikeRejection(email)) {
   return {
     ...result,
     isRejection: true,
     hasSchedulingInfo: true,
     hasSpecificDeadline: false,
     priority: 1,
     actionItems: [],
     topicsOrContent: null,
     eventTitle: result.eventTitle || email?.subject || null,
     eventDate: null,
     eventTime: null,
     reasoning: REJECTION_NOTE,
     applicationStage: 'rejected',
   };
 }

 const actionItems = Array.isArray(result.actionItems)
   ? result.actionItems.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
   : [];

 const stage = ['applied', 'interviewing', 'offer'].includes(result.applicationStage)
   ? result.applicationStage
   : null;
 const advancing = stage === 'interviewing' || stage === 'offer';

 return {
   ...result,
   isRejection: false,
   applicationStage: stage,
   organization: result.organization || null,
   actionItems,
   topicsOrContent: result.topicsOrContent || null,
   priority: result.hasSpecificDeadline || advancing ? 5 : result.priority,
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
* Uses the full body when available (Gmail) and falls back to the snippet
* (Outlook's bodyPreview).
*
* @param {{ subject: string|null, from: string|null, date: string|null, snippet: string, body?: string }} email
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
     '',
     email.body ? `Body:\n${email.body}` : `Snippet: ${email.snippet || ''}`,
   ].join('\n');


   const response = await client.messages.create({
     model: 'claude-haiku-4-5-20251001',
     max_tokens: 1024,
     system: CLAUDE_SYSTEM_PROMPT,
     messages: [{ role: 'user', content: userContent }],
   });


   const textBlock = response.content?.find((block) => block.type === 'text');
   if (!textBlock?.text) {
     return { hasSchedulingInfo: false };
   }


   const result = normalizeAnalysis(parseClaudeJson(textBlock.text), email);
   console.log('Claude analyzed:', email.subject, '→', result.hasSchedulingInfo, result.eventTitle || '');
   return result;
 } catch (error) {
   console.error('Claude email analysis failed:', error.message);
   return { hasSchedulingInfo: false };
 }
}


/**
* Fetches recent Gmail messages (the newest maxResults, optionally narrowed by a
* Gmail search query such as "newer_than:1d") and analyzes each with Claude.
*
* @param {object} googleTokens - OAuth tokens for the mailbox to scan
* @param {{ onTokens?: (tokens: object) => void, query?: string, maxResults?: number }} [options]
*   onTokens receives the merged token set whenever googleapis refreshes the
*   access token; query is a Gmail search string; maxResults caps the messages.
* @returns {Promise<Array<{ email: object, analysis: object }>>}
*/
async function scanGmailEmails(googleTokens, { onTokens, query, maxResults = 20 } = {}) {
 const oauth2Client = createOAuth2Client(googleTokens);
 if (onTokens) {
   oauth2Client.on('tokens', (fresh) => onTokens({ ...googleTokens, ...fresh }));
 }
 const gmail = google.gmail({ version: 'v1', auth: oauth2Client });


 // List the newest matching message IDs
 const listResponse = await gmail.users.messages.list({
   userId: 'me',
   maxResults,
   ...(query ? { q: query } : {}),
 });


 const messageRefs = listResponse.data.messages || [];
 if (messageRefs.length === 0) {
   return [];
 }


 // Fetch the full message (headers + MIME body parts) for each message
 const emails = await Promise.all(
   messageRefs.map(async (ref) => {
     const { data: message } = await gmail.users.messages.get({
       userId: 'me',
       id: ref.id,
       format: 'full',
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
