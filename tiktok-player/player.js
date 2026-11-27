(() => {
  const params = new URLSearchParams(location.search);
  const ids = params.getAll('v');
  const handles = params.getAll('u');
  const video = ids.length === 1 && handles.length === 0 && /^\d{16,22}$/.test(ids[0]);
  const profile = handles.length === 1 && ids.length === 0 && /^[A-Za-z0-9._]{1,24}$/.test(handles[0]);
  const message = document.getElementById('message');
  if (!video && !profile) {
    message.textContent = 'TikTok preview unavailable.';
    return;
  }
  const iframe = document.createElement('iframe');
  iframe.title = profile ? 'TikTok creator profile' : 'TikTok video';
  iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
  iframe.allowFullscreen = true;
  iframe.src = video ? 'https://www.tiktok.com/player/v1/' + ids[0]
    : 'https://www.tiktok.com/embed/@' + handles[0];
  document.body.replaceChildren(iframe);
})();
