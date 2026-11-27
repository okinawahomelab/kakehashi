// Deploy on a dedicated, credential-free origin distinct from Kakehashi.
// This service contains no user data and accepts only a TikTok post ID or handle.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get('v') || '';
    const handle = url.searchParams.get('u') || '';
    const video = /^\d{16,22}$/.test(id) && !handle;
    const profile = /^[A-Za-z0-9._]{1,24}$/.test(handle) && !id;
    if (request.method !== 'GET' || url.pathname !== '/' || (!video && !profile)) {
      return new Response('Player unavailable', { status: 404, headers: { 'cache-control': 'no-store' } });
    }
    const target = video ? 'player/v1/' + id : 'embed/@' + handle;
    const html = '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>TikTok video</title><style>html,body{margin:0;width:100%;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style>' +
      '<iframe title="TikTok video" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen ' +
      'src="https://www.tiktok.com/' + target + '"></iframe></html>';
    return new Response(html, { headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-src https://www.tiktok.com; base-uri 'none'; form-action 'none'; object-src 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff'
    } });
  }
};
