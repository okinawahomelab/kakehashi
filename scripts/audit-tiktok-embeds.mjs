// Check known public links with TikTok's documented oEmbed API. This does not
// discover links, test playback, or assess language or suitability.
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const rankings = JSON.parse(await readFile(new URL('top.json', root), 'utf8'));
const html = await readFile(new URL('index.html', root), 'utf8');
const block = html.match(/const curatedTikTokPosts = new Map\(\[([\s\S]*?)\]\);/);
if (!block || !Array.isArray(rankings.tt) || rankings.tt.length !== 100) throw new Error('Unexpected ranking or curated-link format');
const posts = new Map([...block[1].matchAll(/\["([A-Za-z0-9._]+)",\s*"(\d{16,22})"\]/g)].map(m => [m[1].toLowerCase(), m[2]]));
const out = { checkedAt: new Date().toISOString(), method: 'TikTok oEmbed; does not verify playback, language, or suitability', accounts: [] };
for (const creator of rankings.tt) {
  const handle = creator.id.toLowerCase();
  const id = posts.get(handle);
  if (!id) { out.accounts.push({ handle, status: 'missing_video_link' }); continue; }
  const url = `https://www.tiktok.com/@${handle}/video/${id}`;
  const api = new URL('https://www.tiktok.com/oembed'); api.searchParams.set('url', url);
  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(15000) });
    const body = await res.json();
    const matched = res.ok && String(body.embed_product_id) === id && body.provider_name === 'TikTok';
    out.accounts.push({ handle, url, status: matched ? 'oembed_confirmed' : 'oembed_unconfirmed', http: res.status });
  } catch (error) { out.accounts.push({ handle, url, status: 'request_failed', error: error.name }); }
  await new Promise(resolve => setTimeout(resolve, 500));
}
const path = process.argv[2];
if (!path) throw new Error('Provide an output JSON path');
await writeFile(path, JSON.stringify(out, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(Object.groupBy(out.accounts, a => a.status), (key, value) => Array.isArray(value) && key !== 'accounts' ? value.length : value));
