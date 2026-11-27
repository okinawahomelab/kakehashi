// Treat search results as untrusted; accept only individual public post URLs.
export function extractResults(platform, results) {
  const seen = new Set();
  return (Array.isArray(results) ? results : []).flatMap(item => {
    let url; try { url = new URL(item?.url); } catch { return []; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return [];
    const host = url.hostname.toLowerCase();
    let match;
    if (platform === 'instagram' && (host === 'instagram.com' || host === 'www.instagram.com')) {
      match = url.pathname.match(/^\/reel\/([A-Za-z0-9_-]{5,20})\/?$/);
      if (!match || seen.has(match[1])) return [];
      seen.add(match[1]);
      return [{ id: match[1], handle: '', name: 'Instagram Reel', title: String(item.title || '').slice(0, 200) }];
    }
    if (platform === 'tiktok' && (host === 'tiktok.com' || host === 'www.tiktok.com')) {
      match = url.pathname.match(/^\/@([A-Za-z0-9._]{1,30})\/video\/(\d{16,22})\/?$/);
      if (!match || seen.has(match[2])) return [];
      seen.add(match[2]);
      return [{ id: match[2], handle: match[1], name: match[1], title: String(item.title || '').slice(0, 200) }];
    }
    return [];
  }).slice(0, 12);
}
