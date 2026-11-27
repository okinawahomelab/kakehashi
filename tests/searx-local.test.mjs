import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractResults } from '../scripts/searx-local.mjs';

test('local SearXNG adapter accepts only individual platform video URLs', () => {
  const hits = [
    { url: 'https://www.instagram.com/reel/DdGsEv1ugPh/?x=1', title: 'A reel' },
    { url: 'https://instagram.com/reel/DdGsEv1ugPh/' },
    { url: 'https://instagram.com.evil.test/reel/DdGsEv1ugPh/' },
    { url: 'https://www.tiktok.com/@creator/video/7706179046610062610', title: 'A video' },
    { url: 'https://www.tiktok.com/@creator/video/abc' },
    { url: 'http://www.tiktok.com/@creator/video/7706179046610062610' },
  ];
  assert.deepEqual(extractResults('instagram', hits).map(x => x.id), ['DdGsEv1ugPh']);
  assert.deepEqual(extractResults('tiktok', hits).map(x => [x.handle, x.id]), [['creator', '7706179046610062610']]);
  assert.deepEqual(extractResults('instagram', null), []);
});
