import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import player from '../tiktok-player/worker.js';

test('isolated TikTok wrapper accepts only an individual numeric post ID', async () => {
  const response = await player.fetch(new Request('https://player.example/?v=6829922167224913154'));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /https:\/\/www\.tiktok\.com\/player\/v1\/6829922167224913154/);
  assert.match(response.headers.get('content-security-policy'), /frame-src https:\/\/www\.tiktok\.com/);
  assert.equal(response.headers.get('set-cookie'), null);
  const profile = await player.fetch(new Request('https://player.example/?u=kano9x'));
  assert.match(await profile.text(), /https:\/\/www\.tiktok\.com\/embed\/@kano9x/);
  for (const path of ['/?v=abc', '/?u=bad%2Fpath', '/?u=kano9x&v=6829922167224913154', '/?v=1234567890123456%22%3E%3Cscript%3E', '/other?v=6829922167224913154']) {
    assert.equal((await player.fetch(new Request('https://player.example' + path))).status, 404);
  }
});

test('app requires a separate secure player origin and numeric video ID', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function isolatedTikTokPlayer(');
  const end = html.indexOf('\nfunction closeDetail(', start);
  assert.ok(start >= 0 && end > start);
  const fn = html.slice(start, end);
  assert.match(html, /frame\.setAttribute\("sandbox", tiktokSandbox\(postId\)\)/);
  const check = (origin, id) => runInNewContext(
    `const TIKTOK_PLAYER_ORIGIN = ${JSON.stringify(origin)}; ${fn}; isolatedTikTokPlayer(${JSON.stringify(id)})`,
    { URL, location: { origin: 'https://app.example' } }
  );
  assert.equal(check('https://app.example', '6829922167224913154'), null);
  assert.equal(check('http://other.example', '6829922167224913154'), null);
  assert.equal(check('https://player.example', 'bad-id'), null);
  assert.equal(check('https://player.example', '6829922167224913154'), 'https://player.example/?v=6829922167224913154');
});

test('TikTok profile popups cannot inherit the app origin', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function tiktokSandbox(');
  const end = html.indexOf('\nfunction closeDetail(', start);
  assert.ok(start >= 0 && end > start);
  const fn = html.slice(start, end);
  const flags = postId => runInNewContext(`${fn}; tiktokSandbox(${JSON.stringify(postId)})`).split(' ');
  assert.ok(flags('').includes('allow-popups'));
  assert.ok(!flags('').includes('allow-same-origin'));
  assert.ok(!flags('').includes('allow-popups-to-escape-sandbox'));
  assert.ok(flags('6829922167224913154').includes('allow-same-origin'));
  assert.ok(!flags('6829922167224913154').includes('allow-popups'));
  assert.ok(!flags('6829922167224913154').includes('allow-popups-to-escape-sandbox'));
});

test('browser blocks a synthetic TikTok popup from reading app storage',
  { skip: process.env.KAKEHASHI_BROWSER_SECURITY !== '1' }, () => {
    const script = fileURLToPath(new URL('./tiktok_popup_security.py', import.meta.url));
    const result = spawnSync('python3', [script], { encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

test('static TikTok wrapper loads only validated TikTok players', () => {
  const source = readFileSync(new URL('../tiktok-player/player.js', import.meta.url), 'utf8');
  const render = search => {
    const message = { textContent: '' };
    let rendered = null;
    const document = {
      getElementById: () => message,
      createElement: () => ({}),
      body: { replaceChildren: frame => { rendered = frame; } }
    };
    runInNewContext(source, { URLSearchParams, location: { search }, document });
    return { message: message.textContent, frame: rendered };
  };
  assert.equal(render('?v=6829922167224913154').frame.src, 'https://www.tiktok.com/player/v1/6829922167224913154');
  assert.equal(render('?u=kano9x').frame.src, 'https://www.tiktok.com/embed/@kano9x');
  for (const invalid of ['?u=bad%2Fpath', '?v=abc', '?u=kano9x&v=6829922167224913154', '?v=6829922167224913154&v=1234567890123456']) {
    assert.equal(render(invalid).frame, null);
    assert.equal(render(invalid).message, 'TikTok preview unavailable.');
  }
  const headers = readFileSync(new URL('../tiktok-player/_headers', import.meta.url), 'utf8');
  assert.match(headers, /script-src 'self'/);
  assert.match(headers, /frame-src https:\/\/www\.tiktok\.com/);
});
