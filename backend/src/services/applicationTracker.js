// ============================================================================
// Compass - Saving scanned emails, with application tracking
// One email thread → one event (thread dedupe). On top of that, an email that
// moves a job/internship application forward or ends it (interview invite,
// offer, rejection) updates the application's existing event instead of
// creating a new one, even when it arrives in a different thread.
// ============================================================================

const APPLICATION_TYPES = ['internship', 'job'];
const STAGE_ORDER = { applied: 1, interviewing: 2, offer: 3 };
// Columns added after the original schema. If the Supabase migration hasn't
// been run yet, writes are retried without them instead of failing the scan.
const NEWER_COLUMNS = ['stage', 'sender_domain'];

// Senders whose domain says nothing about the employer: personal mail and
// applicant-tracking systems that email on behalf of many companies. For these
// the match relies on the organization name instead.
const SHARED_SENDER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com',
  'greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'hire.lever.co', 'myworkday.com', 'workday.com',
  'icims.com', 'smartrecruiters.com', 'ashbyhq.com', 'jobvite.com', 'taleo.net', 'successfactors.com',
  'brassring.com', 'avature.net', 'eightfold.ai', 'handshake.com', 'joinhandshake.com', 'hirevue.com',
  'linkedin.com', 'indeed.com', 'oraclecloud.com', 'paradox.ai', 'phenompeople.com',
]);

// Two-letter second levels like co.uk / ac.jp keep three labels.
const SECOND_LEVEL = new Set(['co', 'ac', 'gov', 'edu', 'org', 'com', 'net', 'ne', 'or']);

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'at', 'in', 'on', 'with', 'your', 'you', 'our',
  'application', 'applications', 'status', 'update', 'candidate', 'careers', 'career', 'program',
  'position', 'role', 're', 'fw', 'fwd', 'thank', 'thanks', 'summer', 'fall', 'spring', 'winter',
]);

/**
 * "Mastercard Recruiting <no-reply@careers.mastercard.com>" → "mastercard.com".
 * Returns null for personal-mail and applicant-tracking domains.
 */
function senderDomain(from) {
  if (!from) return null;
  const address = (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase();
  const host = address.split('@')[1]?.replace(/[>\s]/g, '');
  if (!host) return null;

  const labels = host.split('.').filter(Boolean);
  const keep = labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2;
  const domain = labels.slice(-keep).join('.');
  if (SHARED_SENDER_DOMAINS.has(domain) || SHARED_SENDER_DOMAINS.has(host)) return null;
  return domain;
}

function tokens(text) {
  return new Set(
    String(text || '').toLowerCase().split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1 && !STOPWORDS.has(word) && !/^\d{4}$/.test(word)),
  );
}

/** Share of the incoming role's words that appear in a candidate's title. */
function titleScore(candidateTitle, incomingTokens) {
  if (!incomingTokens.size) return 0;
  const candidate = tokens(candidateTitle);
  let shared = 0;
  incomingTokens.forEach((word) => { if (candidate.has(word)) shared += 1; });
  return shared / incomingTokens.size;
}

/**
 * Picks the existing application event(s) an email is about.
 * Candidates are the user's open job/internship events from the same sender
 * domain or naming the same organization. Among those, the best title match
 * wins (so a "Systems" rejection doesn't close the "Software" application).
 * When the email names no role at all, every candidate scores 0 and they all
 * match, which is right for company-wide news like "we won't be moving forward".
 * With requireFullMatch, a candidate must contain every role word (used for
 * extra events closed alongside a thread's own event, where a partial match
 * like "Software" vs "Systems" would close the wrong application).
 *
 * @returns {Array<object>} matching events, best first
 */
function matchApplications(candidates, { domain, organization, title, subject }, { requireFullMatch = false } = {}) {
  const org = String(organization || '').trim().toLowerCase();
  const related = candidates.filter((event) => (
    (domain && event.sender_domain === domain)
    || (org.length >= 3 && String(event.title || '').toLowerCase().includes(org))
  ));
  // The role title is the signal; a subject line adds words like "interest"
  // that no event title contains, so it's only the fallback.
  const incoming = tokens(title || subject);
  if (org) tokens(org).forEach((word) => incoming.delete(word));
  if (requireFullMatch && incoming.size) {
    return related.filter((event) => titleScore(event.title, incoming) === 1);
  }
  if (related.length <= 1) return related;

  const scored = related
    .map((event) => ({ event, score: titleScore(event.title, incoming) }))
    .sort((a, b) => b.score - a.score || String(b.event.created_at).localeCompare(String(a.event.created_at)));
  const best = scored[0].score;
  return scored.filter((entry) => entry.score === best).map((entry) => entry.event);
}

function formatNoteDate(dateHeader) {
  const date = dateHeader ? new Date(dateHeader) : new Date();
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  return valid.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function actionItemObjects(texts) {
  return (texts || []).map((text) => ({ text, done: false }));
}

/** Adds new action items after the existing ones, skipping duplicates. */
function mergeActionItems(existing, texts) {
  const current = Array.isArray(existing) ? existing : [];
  const seen = new Set(current.map((item) => String(item.text).toLowerCase()));
  const added = actionItemObjects(texts).filter((item) => !seen.has(item.text.toLowerCase()));
  return [...current, ...added];
}

function rejectionUpdate(item) {
  return {
    status: 'rejected',
    stage: 'rejected',
    priority: 1,
    description: `Application rejected - ${formatNoteDate(item.email.date)}`,
    action_items: [],
    topics: null,
  };
}

/** Interview invite / offer: promote the event and add the next steps. */
function advancementUpdate(event, item) {
  const { analysis } = item;
  const stage = STAGE_ORDER[analysis.applicationStage] >= (STAGE_ORDER[event.stage] || 0)
    ? analysis.applicationStage
    : event.stage;
  const update = {
    stage,
    priority: 5,
    action_items: mergeActionItems(event.action_items, analysis.actionItems),
    description: analysis.reasoning || event.description,
    // A later step can revive an application that was wrongly closed.
    ...(event.status === 'rejected' ? { status: 'pending' } : {}),
  };
  // The interview/offer email usually carries the date that matters now.
  if (analysis.eventDate) {
    update.raw_date = analysis.eventDate;
    update.event_time = analysis.eventTime || null;
    if (analysis.location) update.location = analysis.location;
  }
  return update;
}

let warnedMissingColumns = false;

/** Runs a write; if the newer columns don't exist yet, retries without them. */
async function writeWithFallback(run, payload) {
  const { error } = await run(payload);
  if (!error) return null;
  const missing = NEWER_COLUMNS.filter((col) => error.message?.includes(`'${col}'`));
  if (!missing.length) return error;
  if (!warnedMissingColumns) {
    warnedMissingColumns = true;
    console.warn(`events is missing column(s) ${missing.join(', ')}; saving without them. Run the Supabase migration.`);
  }
  const trimmed = { ...payload };
  NEWER_COLUMNS.forEach((col) => delete trimmed[col]);
  const retry = await run(trimmed);
  return retry.error || null;
}

function updateEvent(supabase, id, payload) {
  return writeWithFallback((p) => supabase.from('events').update(p).eq('id', id), payload);
}

/**
 * Saves one analyzed email for a user.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {{ email: object, analysis: object }} item - from scanGmailEmails / scanOutlookEmails
 * @param {{ source: 'gmail'|'outlook', accountEmail: string|null }} options
 * @returns {Promise<'inserted'|'updated'|'error'>}
 */
async function saveScannedEmail(supabase, userId, item, { source, accountEmail }) {
  const { email, analysis } = item;
  const stage = analysis.applicationStage || null;
  const domain = senderDomain(email.from);
  const isAdvancement = stage === 'interviewing' || stage === 'offer';
  let threadEventId = null;

  // 1. Same thread → that event.
  if (email.threadId) {
    const { data: existing, error } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', userId)
      .eq('thread_id', email.threadId)
      .maybeSingle();
    if (error) {
      console.error('Supabase event lookup error:', error.message);
      return 'error';
    }
    if (existing) {
      const update = { email_count: (existing.email_count || 1) + 1, source_email: accountEmail };
      if (!existing.sender_domain && domain) update.sender_domain = domain;
      if (analysis.isRejection) {
        Object.assign(update, rejectionUpdate(item));
      } else if (isAdvancement) {
        Object.assign(update, advancementUpdate(existing, item));
      } else if ((analysis.priority || 3) > (existing.priority || 0)) {
        Object.assign(update, {
          title: analysis.eventTitle || email.subject,
          description: analysis.reasoning,
          priority: analysis.priority || 3,
          action_items: actionItemObjects(analysis.actionItems),
          topics: analysis.topicsOrContent || null,
          email_body: email.body || email.snippet || null,
        });
      }
      const updateError = await updateEvent(supabase, existing.id, update);
      if (updateError) console.error('Supabase event update error:', updateError.message);
      // A rejection also closes the application's events in other threads
      // (step 2); anything else is done.
      if (!analysis.isRejection || updateError) return updateError ? 'error' : 'updated';
      threadEventId = existing.id;
    }
  }

  // 2. Rejection / interview / offer in a new thread → the application's event.
  if (analysis.isRejection || isAdvancement) {
    const { data: candidates, error } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', userId)
      .in('scheduling_type', APPLICATION_TYPES)
      .neq('status', 'rejected');
    if (error) {
      console.error('Supabase application lookup error:', error.message);
    } else {
      const others = (candidates || []).filter((event) => event.id !== threadEventId);
      const matches = matchApplications(others, {
        domain,
        organization: analysis.organization,
        title: analysis.eventTitle,
        subject: email.subject,
      }, { requireFullMatch: Boolean(threadEventId) });
      // A rejection closes every matching event (reminders often sit in their
      // own threads); an advancement updates the single best match.
      const targets = analysis.isRejection ? matches : matches.slice(0, 1);
      if (targets.length) {
        for (const event of targets) {
          const update = analysis.isRejection ? rejectionUpdate(item) : advancementUpdate(event, item);
          if (!event.sender_domain && domain) update.sender_domain = domain;
          const updateError = await updateEvent(supabase, event.id, update);
          if (updateError) console.error('Supabase application update error:', updateError.message);
        }
        console.log(
          `${analysis.isRejection ? 'Rejected' : `Moved to ${stage}`}: ${targets.map((e) => e.title).join('; ')}`,
        );
        return 'updated';
      }
    }
  }
  if (threadEventId) return 'updated';

  // 3. Otherwise a new event.
  const insertError = await writeWithFallback((row) => supabase.from('events').insert(row), {
    user_id: userId,
    thread_id: email.threadId || null,
    email_count: 1,
    title: analysis.eventTitle || email.subject,
    description: analysis.isRejection ? rejectionUpdate(item).description : analysis.reasoning,
    start_time: null,
    raw_date: analysis.eventDate || null,
    event_time: analysis.eventTime || null,
    location: analysis.location || null,
    source,
    source_email: accountEmail,
    sender_domain: domain,
    scheduling_type: analysis.schedulingType || 'other',
    priority: analysis.isRejection ? 1 : (isAdvancement ? 5 : (analysis.priority || 3)),
    status: analysis.isRejection ? 'rejected' : 'pending',
    stage,
    action_items: actionItemObjects(analysis.actionItems),
    topics: analysis.topicsOrContent || null,
    email_body: email.body || email.snippet || null,
  });
  if (insertError) {
    console.error(`Supabase ${source} insert error:`, insertError.message);
    return 'error';
  }
  return 'inserted';
}

module.exports = { saveScannedEmail, senderDomain, matchApplications };
