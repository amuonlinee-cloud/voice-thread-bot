// src/linkHandler.js
export function normalizeSocialLink(url) {
  if (!url) return url;
  url = url.trim();
  try {
    const u = new URL(url);
    // Remove tracking params for cleanliness
    // For YouTube preserve the video id
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/watch?v=${v}`;
      // fallback
      u.search = '';
      return u.toString();
    }
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace('/', '');
      if (id) return `https://youtu.be/${id}`;
      u.search = '';
      return u.toString();
    }
    // remove mobile prefixes
    const host = u.hostname.replace(/^m\./i, '').replace(/^mobile\./i, '');
    u.hostname = host;
    u.search = '';
    // strip trailing slash
    return u.toString().replace(/\/+$/, '');
  } catch (e) {
    return url;
  }
}