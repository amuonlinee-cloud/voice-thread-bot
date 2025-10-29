// src/utils.js
// Helpers: short-code encoding (Base36), URL extraction, link normalization (TikTok/YouTube),
// simple supported-link detection.

const { URL } = require('url');

function encodeShortCode(id) {
  if (!id && id !== 0) return '';
  // Use base36, uppercase, pad to 6 characters (adjust pad length if you want)
  const s = Number(id).toString(36).toUpperCase();
  return s.padStart(6, '0');
}

function decodeShortCode(code) {
  if (!code) return null;
  // allow with/without padding
  const cleaned = String(code).replace(/[^0-9A-Z]/ig, '').toLowerCase();
  try {
    const v = parseInt(cleaned, 36);
    if (Number.isNaN(v)) return null;
    return v;
  } catch (e) {
    return null;
  }
}

function extractFirstUrl(text) {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/i;
  const m = text.match(urlRegex);
  if (!m) return null;
  let u = m[1];
  // Trim trailing punctuation
  u = u.replace(/[),.!?;:'"]+$/, '');
  return u;
}

function isSupportedLink(text) {
  const url = extractFirstUrl(text);
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host.includes('tiktok.com') || host.includes('vt.tiktok.com') || host.includes('vm.tiktok.com') || host.includes('youtu.be') || host.includes('youtube.com') || host.includes('youtube-nocookie.com');
  } catch (e) {
    return false;
  }
}

// Normalize video URL to canonical (platform + videoId + canonicalLink) or return null
async function normalizeVideoUrl(rawUrl) {
  if (!rawUrl) return null;
  let url = rawUrl.trim();

  // quick sanity
  try { new URL(url); } catch (e) { return null; }

  // Try following redirect once for short links (HEAD then GET fallback)
  async function followOnce(u) {
    try {
      const res = await fetch(u, { method: 'HEAD', redirect: 'follow' });
      if (res && res.url) {
        // some HEAD endpoints give same url but some return 405 - fallback handled below
        if (res.ok) return res.url;
      }
      // fallback GET if HEAD failed
      const r2 = await fetch(u, { method: 'GET', redirect: 'follow' });
      return r2.url || u;
    } catch (e) {
      return u;
    }
  }

  try {
    const parsed = new URL(url);
    const shortHosts = ['vm.tiktok.com', 'vt.tiktok.com', 't.co', 'bit.ly', 'tinyurl.com'];
    if (shortHosts.includes(parsed.hostname.toLowerCase()) || parsed.hostname.toLowerCase().endsWith('tiktok.com')) {
      url = await followOnce(url);
    }
  } catch (e) {
    // ignore
  }

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch (e) {
    return null;
  }
  const host = urlObj.hostname.toLowerCase();

  // TikTok patterns
  if (host.includes('tiktok.com') || host.includes('tiktokcdn.com')) {
    // Try to extract numeric id from path
    const pathname = urlObj.pathname || '';
    // possible patterns: /@username/video/123..., /video/123..., /v/123..., contains digits.
    const m1 = pathname.match(/\/@[^\/]+\/video\/(\d+)/);
    if (m1 && m1[1]) {
      const id = m1[1];
      const usernameMatch = pathname.match(/\/@([^\/]+)\//);
      const canonical = usernameMatch ? `https://www.tiktok.com/@${usernameMatch[1]}/video/${id}` : `https://www.tiktok.com/video/${id}`;
      return { platform: 'tiktok', videoId: String(id), canonicalLink: canonical };
    }
    const m2 = pathname.match(/\/video\/(\d+)/);
    if (m2 && m2[1]) {
      const id = m2[1];
      const canonical = `https://www.tiktok.com/video/${id}`;
      return { platform: 'tiktok', videoId: String(id), canonicalLink: canonical };
    }
    const m3 = pathname.match(/\/v\/(\d+)/);
    if (m3 && m3[1]) {
      const id = m3[1];
      return { platform: 'tiktok', videoId: String(id), canonicalLink: `https://www.tiktok.com/video/${id}` };
    }
    const fallback = pathname.match(/(\d{6,})/);
    if (fallback && fallback[1]) {
      const id = fallback[1];
      return { platform: 'tiktok', videoId: String(id), canonicalLink: `https://www.tiktok.com/video/${id}` };
    }
    return null;
  }

  // YouTube patterns
  if (host.includes('youtube.com') || host.includes('youtu.be') || host.includes('youtube-nocookie.com')) {
    // youtu.be/ID
    if (host.includes('youtu.be')) {
      const seg = urlObj.pathname.split('/').filter(Boolean)[0];
      if (seg) return { platform: 'youtube', videoId: seg, canonicalLink: `https://www.youtube.com/watch?v=${seg}` };
      return null;
    }
    // youtube.com/watch?v=ID
    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const v = urlObj.searchParams.get('v');
      if (v) return { platform: 'youtube', videoId: v, canonicalLink: `https://www.youtube.com/watch?v=${v}` };
      // /shorts/ID or /embed/ID
      const m = urlObj.pathname.match(/\/(shorts|embed)\/([^\/\?&]+)/);
      if (m && m[2]) return { platform: 'youtube', videoId: m[2], canonicalLink: `https://www.youtube.com/watch?v=${m[2]}` };
      // fallback to last path segment
      const seg = urlObj.pathname.split('/').filter(Boolean).pop();
      if (seg && seg.length >= 6) return { platform: 'youtube', videoId: seg, canonicalLink: `https://www.youtube.com/watch?v=${seg}` };
      return null;
    }
  }

  return null;
}

module.exports = {
  encodeShortCode,
  decodeShortCode,
  extractFirstUrl,
  isSupportedLink,
  normalizeVideoUrl
};
