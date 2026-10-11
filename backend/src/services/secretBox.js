// ============================================================================
// Compass - Encryption for secrets stored in Supabase
// AES-256-GCM with a server-held key, so a leaked database row alone doesn't
// expose the secret. Used for the Canvas session cookie.
// ============================================================================

const crypto = require('crypto');

const VERSION = 'v1';

/**
 * Reads the 32-byte key from SECRETS_KEY (base64 or 64 hex characters).
 * Throws when it's missing or malformed so nothing is ever stored in the clear.
 */
function loadKey() {
  const raw = (process.env.SECRETS_KEY || '').trim();
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('SECRETS_KEY must be set to a 32-byte key (base64 or hex)');
  }
  return key;
}

function isConfigured() {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/** "v1:<iv>:<tag>:<ciphertext>", all base64. */
function encrypt(plaintext) {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

function decrypt(payload) {
  const [version, iv, tag, ciphertext] = String(payload || '').split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Unrecognized encrypted value');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isConfigured };
