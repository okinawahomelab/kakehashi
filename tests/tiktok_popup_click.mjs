// Drive only the local synthetic fixture in tiktok_popup_security.py.
const [port, url] = process.argv.slice(2);
if (typeof WebSocket !== 'function') throw new Error('This browser test requires Node 22 or newer with WebSocket support');
const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  message.error ? reject(new Error(message.error.message)) : resolve(message.result);
};
function call(method, params = {}, sessionId) {
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    ws.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
const { targetId } = await call('Target.createTarget', { url });
const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
let framesReady = false;
for (let attempt = 0; attempt < 40 && !framesReady; attempt++) {
  try {
    const status = await fetch(new URL('/probe', url)).then(r => r.json());
    framesReady = status.frame_loads >= 2;
  } catch {}
  if (!framesReady) await new Promise(resolve => setTimeout(resolve, 200));
}
if (!framesReady) throw new Error('Synthetic frames never loaded');
await new Promise(resolve => setTimeout(resolve, 300));
for (const type of ['mousePressed', 'mouseReleased']) {
  await call('Input.dispatchMouseEvent', { type, x: 40, y: 40, button: 'left', clickCount: 1 }, sessionId);
}
let completed = false;
for (let attempt = 0; attempt < 40 && !completed; attempt++) {
  const status = await fetch(new URL('/probe', url)).then(r => r.json());
  completed = status.popup_done > 0;
  if (!completed) await new Promise(resolve => setTimeout(resolve, 200));
}
if (!completed) throw new Error('Synthetic popup script never completed');
await call('Target.closeTarget', { targetId });
ws.close();
