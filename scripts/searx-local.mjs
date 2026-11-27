// Local-only experiment. This is not a public proxy or production server.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 39161;
const origin = `http://127.0.0.1:${port}`;
const searx = process.env.KAKEHASHI_SEARX_URL;

import { extractResults } from '../lib/social-results.js';
export { extractResults };

async function socialSearch(platform, query) {
  const target = new URL('/search', searx);
  target.searchParams.set('q', `site:${platform}.com${platform === 'instagram' ? '/reel/' : ''} ${query}`);
  target.searchParams.set('format', 'json');
  const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('SearXNG unavailable');
  const body = await response.json();
  if (!Array.isArray(body.results)) throw new Error('Invalid SearXNG response');
  const items = extractResults(platform, body.results);
  if (!items.length && Array.isArray(body.unresponsive_engines) && body.unresponsive_engines.length) throw new Error('Search engines unavailable');
  return { platform, items };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!searx) throw new Error('Set KAKEHASHI_SEARX_URL to your trusted SearXNG instance.');
  const upstream = new URL(searx);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password) throw new Error('Invalid SearXNG URL');
  http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(body);
    try {
      if (req.headers.host !== `127.0.0.1:${port}` || req.method !== 'GET') return send(403, '{}');
      const site = req.headers['sec-fetch-site'];
      if ((req.headers.origin && req.headers.origin !== origin) || (site && site !== 'same-origin' && site !== 'none')) return send(403, '{}');
      const url = new URL(req.url, origin);
      if (url.pathname === '/search') {
        const platform = url.searchParams.get('social');
        if (platform) {
          const query = (url.searchParams.get('q') || '').trim().slice(0, 80);
          if (!['instagram', 'tiktok'].includes(platform) || !query || [...url.searchParams.keys()].some(k => !['social', 'q'].includes(k))) return send(400, '{}');
          return send(200, JSON.stringify(await socialSearch(platform, query)));
        }
        // Optional existing local YouTube preview; never forward to the public site.
        const out = await fetch('http://127.0.0.1:39155/search' + url.search, { signal: AbortSignal.timeout(15000) });
        return send(out.status, Buffer.from(await out.arrayBuffer()));
      }
      if (!['/', '/index.html', '/top.json', '/privacy.html'].includes(url.pathname) && !/^\/assets\/[A-Za-z0-9_.-]+$/.test(url.pathname)) return send(404, '{}');
      const file = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      let body = await readFile(file);
      if (url.pathname === '/' || url.pathname === '/index.html') body = Buffer.from(body.toString().replace('through SocialKit (two requests per search; 20 per month shared)', 'through the local SearXNG test service'));
      if (url.pathname === '/privacy.html') body = Buffer.from(body.toString().replace(/<p>If the website operator enables optional Instagram and TikTok search[\s\S]*?<\/p>/, '<p>In this local test, optional Instagram and TikTok searches are sent to the configured SearXNG instance and its upstream search engines. Your choice is stored in this browser. Results may load Instagram or TikTok embeds.</p>'));
      const type = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' }[extname(file)] || 'application/octet-stream';
      send(200, body, type);
    } catch { send(502, JSON.stringify({ error: 'Local search unavailable' })); }
  }).listen(port, '127.0.0.1', () => console.log(`Local-only preview: ${origin}/`));
}
