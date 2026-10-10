// Static site build: public/ + src/ -> dist/. Zero dependencies beyond esbuild.
//
// Env vars:
//   BASE_PATH  URL prefix for rewritten links. Default "/". Use "/misacorp-visuals/" to preview
//              on https://misacorp.github.io/misacorp-visuals/ before the custom domain works.
//              Canonical/og/sitemap URLs always use SITE_URL regardless of BASE_PATH.
//   OUT_DIR    Output directory (relative to repo root or absolute). Default "dist".
//
// HTML processing limits (regex-based on purpose, no parser):
//   - Author root-absolute URLs ("/scripts/main.js", "/assets/hero.jpg"). Relative URLs are left alone.
//   - Rewritten: src, href, poster, data-src, srcset, and content of og:image / twitter:image metas.
//     NOT rewritten: URLs inside inline <script>/<style>, JSON-LD, or CSS (esbuild handles url() in CSS).
//   - Tag matching uses [^>]*, so a literal ">" inside an attribute value is not supported.
//   - srcset candidates must not contain commas inside URLs (so no data: URIs).
//   - Images referenced both from CSS and src/assets get hashed twice (two copies in dist).
//   - HTML minification only trims whitespace around block-level tags and strips comments.
//     <pre>, <textarea>, <script>, <style> contents and IE conditional comments are untouched.

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const BUDGET_GZIP_BYTES = 50 * 1024; // total gzip of all HTML + CSS + JS in the output
const SITE_URL = 'https://misacorp.dev';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const OUT = resolve(ROOT, process.env.OUT_DIR || 'dist');
const BASE_PATH = `/${(process.env.BASE_PATH || '/').replace(/^\/+|\/+$/g, '')}/`.replace(
  '//',
  '/',
);

const BLOCK_TAGS =
  'html|head|body|meta|link|title|base|script|style|noscript|template|main|header|footer|nav|section|article|aside|div|p|h[1-6]|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|th|td|caption|figure|figcaption|form|fieldset|legend|hr|pre|blockquote|textarea';

const posix = (p) => p.split(sep).join('/');
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);
const walk = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name))
    : [];

/** Maps src-relative path ("scripts/main.js") -> output-relative hashed path ("assets/main-AB12CD34.js"). */
const manifest = new Map();

function clean() {
  if (OUT === ROOT || ROOT.startsWith(OUT + sep) || OUT === SRC)
    throw new Error(`Refusing to clean ${OUT}`);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  if (existsSync(join(ROOT, 'public'))) cpSync(join(ROOT, 'public'), OUT, { recursive: true });
}

async function bundle() {
  const entryPoints = ['scripts/main.js', 'styles/main.css']
    .map((p) => join(SRC, p))
    .filter(existsSync);
  const { metafile } = await build({
    absWorkingDir: ROOT,
    entryPoints,
    outdir: join(OUT, 'assets'),
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    legalComments: 'none',
    entryNames: '[name]-[hash]',
    assetNames: '[name]-[hash]',
    publicPath: `${BASE_PATH}assets`, // url() in CSS stays correct when CSS is inlined into HTML
    loader: Object.fromEntries(
      ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.woff', '.woff2'].map((e) => [
        e,
        'file',
      ]),
    ),
    metafile: true,
    logLevel: 'warning',
  });
  for (const [outFile, meta] of Object.entries(metafile.outputs)) {
    if (!meta.entryPoint) continue;
    manifest.set(
      posix(relative(SRC, resolve(ROOT, meta.entryPoint))),
      posix(relative(OUT, resolve(ROOT, outFile))),
    );
  }
}

function copyAssets() {
  const dir = join(SRC, 'assets');
  for (const file of walk(dir)) {
    const rel = posix(relative(dir, file));
    const ext = extname(rel);
    const hashed = `assets/${rel.slice(0, -ext.length || undefined)}-${hash(readFileSync(file))}${ext}`;
    mkdirSync(dirname(join(OUT, hashed)), { recursive: true });
    cpSync(file, join(OUT, hashed));
    manifest.set(`assets/${rel}`, hashed);
  }
}

/** Rewrite one URL: root-absolute build outputs -> hashed + BASE_PATH; other root-absolute URLs -> BASE_PATH only. */
function resolveUrl(value, htmlFile) {
  const [, rawPath, tail = ''] = value.match(/^([^?#]*)([?#].*)?$/);
  const absolute = rawPath.startsWith(`${SITE_URL}/`);
  const path = absolute ? rawPath.slice(SITE_URL.length) : rawPath;
  if (!path.startsWith('/') || path.startsWith('//')) return value; // relative, external, mailto:, #hash
  const key = path.slice(1);
  const hashed = manifest.get(key);
  if (hashed) return `${absolute ? `${SITE_URL}/` : BASE_PATH}${hashed}${tail}`;
  if (/^(assets|scripts|styles)\//.test(key) && !existsSync(join(OUT, key))) {
    throw new Error(`${htmlFile}: "${value}" does not match any built asset`);
  }
  return absolute ? value : `${BASE_PATH}${key}${tail}`;
}

function rewriteUrls(html, file) {
  const fix = (v) => resolveUrl(v, file);
  return html
    .replace(
      /(\s(?:src|href|poster|data-src)\s*=\s*)(["'])(.*?)\2/gi,
      (_, a, q, v) => `${a}${q}${fix(v)}${q}`,
    )
    .replace(/(\ssrcset\s*=\s*)(["'])(.*?)\2/gi, (_, a, q, v) => {
      const list = v.split(',').map((c) => c.trim().replace(/^(\S+)/, (u) => fix(u)));
      return `${a}${q}${list.join(', ')}${q}`;
    })
    .replace(/<meta\b[^>]*>/gi, (tag) =>
      /(?:property|name)\s*=\s*["'](?:og:image(?::url|:secure_url)?|twitter:image)["']/i.test(tag)
        ? tag.replace(/(\scontent\s*=\s*)(["'])(.*?)\2/i, (_, a, q, v) => `${a}${q}${fix(v)}${q}`)
        : tag,
    );
}

function minifyHtml(html) {
  return html
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`\\s*(</?(?:${BLOCK_TAGS})\\b[^>]*>)\\s*`, 'gi'), '$1')
    .replace(/(<!doctype[^>]*>)\s+/i, '$1')
    .trim();
}

/** Opt-in: <link rel="stylesheet" href="/styles/main.css" data-inline> becomes <style>...</style>. */
function inlineCss(html, inlined) {
  return html.replace(/<link\b[^>]*\bdata-inline\b[^>]*>/gi, (tag) => {
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    const rel = href?.startsWith(BASE_PATH) ? href.slice(BASE_PATH.length) : '';
    if (!rel.endsWith('.css') || !existsSync(join(OUT, rel)))
      throw new Error(`Cannot inline: ${tag}`);
    inlined.add(rel);
    return `<style>${readFileSync(join(OUT, rel), 'utf8').trim()}</style>`;
  });
}

function processHtml() {
  const pages = [];
  const inlined = new Set();
  const linked = new Set();
  for (const file of walk(SRC).filter((f) => f.endsWith('.html'))) {
    const rel = posix(relative(SRC, file));
    // Park raw-text element bodies behind placeholders so nothing below can touch them.
    const parked = [];
    let html = readFileSync(file, 'utf8').replace(
      /(<(pre|textarea|script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
      (_, open, _t, body, close) => {
        parked.push(body);
        return `${open}%%PARKED:${parked.length - 1}%%${close}`;
      },
    );
    html = minifyHtml(rewriteUrls(html, rel)).replace(/%%PARKED:(\d+)%%/g, (_, i) => parked[i]);
    html = inlineCss(html, inlined);
    for (const m of html.matchAll(/<link\b[^>]*href\s*=\s*["']([^"']+\.css)["']/gi))
      linked.add(m[1].slice(BASE_PATH.length));
    mkdirSync(dirname(join(OUT, rel)), { recursive: true });
    writeFileSync(join(OUT, rel), html);
    pages.push(rel);
  }
  for (const css of inlined) if (!linked.has(css)) rmSync(join(OUT, css)); // fully inlined: drop unused file
  return pages;
}

function writeSitemap(pages) {
  if (existsSync(join(OUT, 'sitemap.xml'))) return; // public/sitemap.xml wins
  const urls = pages
    .filter((p) => p !== '404.html')
    .sort()
    .map((p) => `${SITE_URL}/${p.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')}`);
  const body = urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n');
  writeFileSync(
    join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
  );
}

function report() {
  let budgeted = 0;
  console.log(`\n${'file'.padEnd(44)}${'bytes'.padStart(10)}${'gzip'.padStart(10)}`);
  for (const file of walk(OUT).sort()) {
    const buf = readFileSync(file);
    const gz = gzipSync(buf, { level: 9 }).length;
    if (/\.(html|css|js)$/.test(file)) budgeted += gz;
    console.log(
      `${posix(relative(OUT, file)).padEnd(44)}${String(buf.length).padStart(10)}${String(gz).padStart(10)}`,
    );
  }
  console.log(`\nHTML+CSS+JS gzip: ${budgeted} B / budget ${BUDGET_GZIP_BYTES} B`);
  if (budgeted > BUDGET_GZIP_BYTES) {
    console.error(`Budget exceeded by ${budgeted - BUDGET_GZIP_BYTES} B`);
    process.exitCode = 1;
  }
}

clean();
await bundle();
copyAssets();
writeSitemap(processHtml());
report();
console.log(`Built ${relative(ROOT, OUT) || '.'} (BASE_PATH=${BASE_PATH})`);
