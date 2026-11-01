// پروکسی تست: همان کاری را می‌کند که Caddy در پروژه می‌کند
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import httpProxy from 'http-proxy';
const DIST = process.argv[2];
const px = httpProxy.createProxyServer({ ws: true });
px.on('error', (e, req, res) => { try { res.writeHead(502); res.end('bad gateway'); } catch {} });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
function route(url, method = "GET") {
  if (url.startsWith('/_synapse/admin')) return 'deny';
  if (/^\/_matrix\/client\/[^/]+\/user_directory\//.test(url)) return 'http://127.0.0.1:3000';
  if (method === "GET" && /^\/_matrix\/client\/[^/]+\/(sync|initialSync|events\/[^/]+|rooms\/[^/]+\/(messages|members|joined_members|state(\/.*)?|context\/.*|event\/.*|relations\/.*))\/?$/.test(url.split('?')[0])) return 'http://127.0.0.1:3000';
  if ((method === 'POST' || method === 'PUT') && /^\/_matrix\/media\/[^/]+\/(upload|create)(\/.*)?$/.test(url.split('?')[0])) return 'http://127.0.0.1:3000';
  if (url.startsWith('/_matrix')) return 'http://127.0.0.1:8008';
  if (url.startsWith('/api/')) return 'http://127.0.0.1:3000';
  if (url.startsWith('/livekit/')) return 'http://127.0.0.1:7880';
  return null;
}
const server = http.createServer((req, res) => {
  const t = route(req.url, req.method);
  if (t === 'deny') { res.writeHead(403); return res.end(); }
  if (t) { if (t.endsWith('7880')) req.url = req.url.replace(/^\/livekit/, '') || '/'; return px.web(req, res, { target: t }); }
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(DIST) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { ...(process.env.CSP_ON ? {'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ws://localhost:8080; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'", 'x-frame-options':'DENY'} : {}), 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
server.on('upgrade', (req, sock, head) => {
  const t = route(req.url);
  if (t && t !== 'deny') { if (t.endsWith('7880')) req.url = req.url.replace(/^\/livekit/, ''); px.ws(req, sock, head, { target: t }); } else sock.destroy();
});
server.listen(8080, () => console.log('proxy on 8080'));
