// Zero-dependency dev server: builds, serves dist/ on http://localhost:8080, rebuilds on change.
// PORT env var overrides the port. Tiny SSE live reload is injected into served HTML (dev only).

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};
const RELOAD_SNIPPET =
  '<script>new EventSource("/__reload").onmessage=()=>location.reload()</script>';

/** Map a URL path to a file inside dist/, or null. Mirrors GitHub Pages: /x -> x.html, /dir/ -> dir/index.html. */
function locate(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const target = resolve(DIST, `.${normalize(`/${decoded}`)}`);
  if (target !== DIST && !target.startsWith(DIST + sep)) return null; // path traversal
  const candidates = [target, join(target, 'index.html'), `${target}.html`];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

const clients = new Set();

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/__reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  let file = locate(pathname);
  let status = 200;
  if (!file) {
    file = join(DIST, '404.html');
    status = 404;
    if (!existsSync(file)) {
      res.writeHead(404, { 'Content-Type': MIME['.txt'] }).end('404 Not Found');
      return;
    }
  }
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  let body;
  try {
    body = readFileSync(file);
  } catch {
    res.writeHead(503, { 'Content-Type': MIME['.txt'] }).end('Rebuilding, retry');
    return;
  }
  res.writeHead(status, headers);
  res.end(type.startsWith('text/html') ? `${body}${RELOAD_SNIPPET}` : body);
});

let building = false;
let queued = false;
function rebuild() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  const child = spawn(process.execPath, [join(ROOT, 'scripts/build.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  child.on('close', (code) => {
    building = false;
    if (code === 0) for (const c of clients) c.write('data: reload\n\n');
    else console.error(`Build exited with code ${code}`);
    if (queued) {
      queued = false;
      rebuild();
    }
  });
}

let timer;
for (const dir of ['src', 'public']) {
  if (!existsSync(join(ROOT, dir))) continue;
  watch(join(ROOT, dir), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  });
}

rebuild();
server.listen(PORT, () =>
  console.log(`Dev server: http://localhost:${PORT} (watching src/ and public/)`),
);
