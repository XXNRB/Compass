// ============================================================================
// Compass - Connected email accounts
// Stores every mailbox a user has connected (several Gmail accounts, Outlook)
// with its OAuth tokens, so scans can cover all of them.
// ============================================================================

const { supabase } = require('../config/supabase');


/**
 * Inserts or refreshes the tokens for one (user, email, provider) account.
 * Existing rows keep their refresh_token if the new token set lacks one —
 * Google only returns it on the first consent. Returns true if the row was saved.
 */
async function upsertConnectedEmail(userId, email, provider, tokens) {
  if (!userId || !email) return false;

  const { data: existing, error: lookupError } = await supabase
    .from('connected_emails')
    .select('id, tokens')
    .eq('user_id', userId)
    .eq('email', email)
    .eq('provider', provider)
    .maybeSingle();

  if (lookupError) {
    console.error('Supabase connected email lookup error:', lookupError.message);
    return false;
  }

  if (existing) {
    const merged = { ...existing.tokens, ...tokens };
    if (!tokens.refresh_token && existing.tokens?.refresh_token) {
      merged.refresh_token = existing.tokens.refresh_token;
    }
    const { error } = await supabase
      .from('connected_emails')
      .update({ tokens: merged })
      .eq('id', existing.id);
    if (error) console.error('Supabase connected email update error:', error.message);
    return !error;
  }

  const { error } = await supabase
    .from('connected_emails')
    .insert({ user_id: userId, email, provider, tokens });
  if (error) console.error('Supabase connected email insert error:', error.message);
  return !error;
}


/**
 * Lists a user's connected accounts. Tokens are only included when asked for,
 * so route handlers can't leak them to the browser by accident.
 */
async function listConnectedEmails(userId, { provider, withTokens = false } = {}) {
  let query = supabase
    .from('connected_emails')
    .select(withTokens ? 'id, email, provider, tokens' : 'id, email, provider')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (provider) query = query.eq('provider', provider);

  const { data, error } = await query;
  if (error) {
    console.error('Supabase connected emails fetch error:', error.message);
    return [];
  }
  return data || [];
}


/**
 * Saves refreshed tokens for an account (called when googleapis auto-refreshes).
 */
async function updateConnectedEmailTokens(id, tokens) {
  const { error } = await supabase
    .from('connected_emails')
    .update({ tokens })
    .eq('id', id);
  if (error) console.error('Supabase connected email token refresh error:', error.message);
}


module.exports = { upsertConnectedEmail, listConnectedEmails, updateConnectedEmailTokens };
