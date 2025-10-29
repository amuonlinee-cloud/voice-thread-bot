// src/linkHandler.js
// Usage: const { normalizeVideoUrl } = require('./linkHandler');
// normalizeVideoUrl returns { platform, videoId, canonicalLink } or null.

const { URL } = require('url');
/**
 * Node 18+ has global fetch. If your Node version doesn't, install node-fetch
 * and uncomment the following line:
 * const fetch = require('node-fetch');
 */

async function followOnce(url) {
  // fetch and return final url after redirects (fetch follows redirects by default)
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', timeout: 10000 });
    // Some servers reject HEAD - fallback to GET
    if (!res.ok && res.status >= 400) {
      const r2 = await fetch(url, { method: 'GET', redirect: 'follow', timeout: 10000 });
      return r2.url;
    }
    return res.url || url;
  } catch (e) {
    // fallback: return original url (we still attempt parsing)
    return url;
  }
}

function extractTikTokIdFromPath(pathname) {
  // Several possible patterns:
  // /@username/video/1234567890123456789
  // /v/1234567890123456789.html
  // /video/1234567890123456789
  // sometimes there's trailing .html
  const m1 = pathname.match(/\/@[^\/]+\/video\/(\d+)/);
  if (m1) return m1[1];
  const m2 = pathname.match(/\/v\/(\d+)/);
  if (m2) return m2[1];
  const m3 = pathname.match(/\/video\/(\d+)/);
  if (m3) return m3[1];
  // fallback numeric anywhere
  const m4 = pathname.match(/(\d{6,})/);
  if (m4) return m4[1];
  return null;
}

function extractYouTubeIdFromUrl(urlObj) {
  // youtube.com/watch?v=ID
  // youtu.be/ID
  // youtube.com/shorts/ID
  const host = urlObj.hostname.toLowerCase();
  if (host.includes('youtu.be')) {
    const id = urlObj.pathname.split('/').filter(Boolean)[0];
    return id || null;
  }
  if (host.includes('youtube.com') || host.includes('m.youtube.com')) {
    const p = urlObj.pathname;
    if (p.startsWith('/watch')) {
      return urlObj.searchParams.get('v') || null;
    }
    // /shorts/ID or /embed/ID
    const m = p.match(/\/(shorts|embed)\/([^\/\?&]+)/);
    if (m) return m[2];
    // fallback: any candidate segment
    const seg = p.split('/').filter(Boolean).pop();
    if (seg && seg.length >= 6) return seg;
  }
  return null;
}

/**
 * Normalize an incoming social video link (TikTok or YouTube).
 * Returns { platform: 'tiktok'|'youtube', videoId: string, canonicalLink: string }
 * or null if unknown.
 */
async function normalizeVideoUrl(rawUrl) {
  if (!rawUrl) return null;
  let url = rawUrl.trim();

  // Follow short redirects once for links like vt.tiktok.com / vm.tiktok.com / t.co etc.
  try {
    // if it looks like a short domain, follow; also follow for any tiktok host
    const u0 = new URL(url);
    const shortHosts = ['vm.tiktok.com', 'vt.tiktok.com', 't.co', 'bit.ly', 'tinyurl.com'];
    if (shortHosts.includes(u0.hostname.toLowerCase()) || u0.hostname.toLowerCase().endsWith('tiktok.com')) {
      url = await followOnce(url);
    }
  } catch (e) {
    // if invalid URL, return null
    return null;
  }

  // parse final URL
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch (e) {
    return null;
  }
  const host = urlObj.hostname.toLowerCase();

  // --- TikTok ---
  if (host.endsWith('tiktok.com') || host.endsWith('tiktokcdn.com')) {
    // sometimes a query or different subdomain - extract id from path
    const id = extractTikTokIdFromPath(urlObj.pathname);
    if (!id) return null;
    // canonical link prefer www.tiktok.com/@username/video/ID if username present
    const usernameMatch = urlObj.pathname.match(/\/@([^\/]+)\//);
    const canonical = usernameMatch ? `https://www.tiktok.com/@${usernameMatch[1]}/video/${id}` : `https://www.tiktok.com/video/${id}`;
    return { platform: 'tiktok', videoId: String(id), canonicalLink: canonical };
  }

  // --- YouTube ---
  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    const id = extractYouTubeIdFromUrl(urlObj);
    if (!id) return null;
    const canonical = `https://www.youtube.com/watch?v=${id}`;
    return { platform: 'youtube', videoId: String(id), canonicalLink: canonical };
  }

  // unknown platform
  return null;
}

module.exports = { normalizeVideoUrl };
