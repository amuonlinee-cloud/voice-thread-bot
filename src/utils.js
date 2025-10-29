// src/utils.js
// helpers: Base36 short codes, url extraction, link support detection

const URL_REGEX = /https?:\/\/[^\s]+/i;

// Convert numeric id -> short code (Base36, uppercase, padded to length 6)
function encodeShortCode(id) {
  if (!id && id !== 0) return '';
  const n = Number(id);
  if (!Number.isFinite(n)) return '';
  const s = n.toString(36).toUpperCase();
  // pad to 6 chars to make copy-friendly; adjust length if you want shorter codes
  return s.padStart(6, '0');
}

// parse short code back to id (returns integer or null)
function decodeShortCode(code) {
  if (!code || typeof code !== 'string') return null;
  const clean = code.trim().replace(/^0+/, '').toLowerCase();
  if (!clean) return null;
  const parsed = parseInt(clean, 36);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

// Extract first URL from a text (or null)
function extractFirstUrl(text) {
  if (!text) return null;
  const m = text.match(URL_REGEX);
  return m ? m[0] : null;
}

// Supported social links: YouTube and TikTok (expand as needed)
function isSupportedLink(text) {
  const url = extractFirstUrl(text);
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // youtube (also youtu.be) and tiktok hosts
    if (host.includes('youtube.com') || host.includes('youtu.be') || host.includes('tiktok.com') || host.includes('vm.tiktok.com')) return true;
    return false;
  } catch (e) {
    return false;
  }
}

module.exports = {
  encodeShortCode,
  decodeShortCode,
  extractFirstUrl,
  isSupportedLink
};
