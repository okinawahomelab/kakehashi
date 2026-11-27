"""Local synthetic popup isolation regression. Requires Node and Chrome/Chromium."""
import http.server, threading, subprocess, tempfile, shutil, time, re, os, json
from pathlib import Path
hits=[]
popup_loads=[]
popup_done=[]
frame_loads=[]
class S(http.server.ThreadingHTTPServer): allow_reuse_address=True
class H(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  p=self.server.server_port
  if p==ports[0] and self.path=='/probe':
   self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'popup_loads':len(popup_loads),'frame_loads':len(frame_loads),'popup_done':len(popup_done)}).encode());return
  if p==ports[0] and self.path=='/done':
   popup_done.append(1);self.send_response(204);self.end_headers();return
  if p==ports[0] and self.path.startswith('/stolen'):
   hits.append(self.path);self.send_response(204);self.end_headers();return
  if p==ports[0] and self.path=='/evil':
   popup_loads.append(1)
   body=b'''<script>(async()=>{try{const value=localStorage.getItem("dummy");await fetch("/stolen?value="+encodeURIComponent(value),{mode:"no-cors",keepalive:true})}catch(e){}await fetch("/done",{mode:"no-cors",keepalive:true})})()</script>'''
  elif p==ports[0]:
   body=('<script>localStorage.setItem("dummy","marker")</script><iframe sandbox="'+sandbox+'" src="http://127.0.0.1:'+str(ports[1])+'/"></iframe>').encode()
  elif p==ports[1]:
   frame_loads.append(1)
   body=('<iframe src="http://127.0.0.1:'+str(ports[2])+'/"></iframe>').encode()
  else:
   frame_loads.append(1)
   body=('<button onclick="window.open(\'http://127.0.0.1:'+str(ports[0])+'/evil\',\'_blank\')">Simulate thumbnail</button>').encode()
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8')
  if p==ports[1]:self.send_header('Content-Security-Policy',"default-src 'none'; frame-src http://127.0.0.1:"+str(ports[2])+"; base-uri 'none'; form-action 'none'; object-src 'none'")
  self.end_headers();self.wfile.write(body)
servers=[S(('127.0.0.1',0),H) for _ in range(3)];ports=[s.server_port for s in servers]
for s in servers:threading.Thread(target=s.serve_forever,daemon=True).start()
chrome=os.environ.get('CHROME') or shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chromium-browser') or '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
source = (Path(__file__).resolve().parents[1] / 'index.html').read_text()
match = re.search(r'function tiktokSandbox\(postId\)\s*\{[^}]*\}', source)
if not match:
 raise RuntimeError('TikTok sandbox helper not found')
safe = subprocess.check_output(['node', '-e', match.group(0) + '; process.stdout.write(tiktokSandbox(""))'], text=True)
unsafe = safe + ' allow-same-origin'
try:
 for sandbox,expected in [(unsafe, True), (safe, False)]:
  hits.clear()
  popup_loads.clear()
  popup_done.clear()
  frame_loads.clear()
  with tempfile.TemporaryDirectory() as d:
   process = subprocess.Popen([chrome, '--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio', '--remote-debugging-port=0', '--user-data-dir='+d, 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
   try:
    active = Path(d) / 'DevToolsActivePort'
    deadline = time.monotonic() + 15
    while not active.exists() and time.monotonic() < deadline:
     if process.poll() is not None: raise RuntimeError('Chrome exited during startup')
     time.sleep(.1)
    port = active.read_text().splitlines()[0]
    subprocess.run(['node', str(Path(__file__).with_name('tiktok_popup_click.mjs')), port, 'http://127.0.0.1:'+str(ports[0])+'/'], timeout=20, check=True)
   finally:
    process.terminate()
    try: process.wait(timeout=5)
    except subprocess.TimeoutExpired: process.kill(); process.wait()
  print('sandbox:',sandbox,'leaked:',bool(hits),flush=True)
  assert popup_loads, 'synthetic popup did not reach the app-origin fixture'
  assert popup_done, 'synthetic popup script did not finish'
  assert bool(hits)==expected
finally:
 for s in servers:s.shutdown();s.server_close()
