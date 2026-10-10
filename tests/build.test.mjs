import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
let out;

const htmlFiles = () =>
  readdirSync(out, { recursive: true })
    .filter((f) => f.endsWith('.html'))
    .map((f) => join(out, f));

describe('build output', () => {
  before(() => {
    out = mkdtempSync(join(tmpdir(), 'misacorp-build-'));
    execFileSync(process.execPath, [join(ROOT, 'scripts/build.mjs')], {
      cwd: ROOT,
      env: { ...process.env, OUT_DIR: out, BASE_PATH: '/' },
      stdio: 'pipe',
    });
  });
  after(() => rmSync(out, { recursive: true, force: true }));

  test('index.html has the required SEO basics', () => {
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    assert.match(html, /<html lang="[a-z-]+"/i);
    assert.match(html, /<title>[^<]+<\/title>/i);
    assert.match(html, /<meta name="description" content="[^"]+"/i);
    assert.match(html, /<link rel="canonical" href="https:\/\/misacorp\.dev\/"/i);
  });

  test('all local src/href references resolve to files in the output', () => {
    for (const file of htmlFiles()) {
      const html = readFileSync(file, 'utf8');
      for (const [, url] of html.matchAll(/\s(?:src|href)="([^"]+)"/gi)) {
        if (!url.startsWith('/') || url.startsWith('//')) continue; // external, mailto:, #hash
        const path = decodeURIComponent(url.split(/[?#]/)[0]);
        const target = join(out, path);
        const ok = path.endsWith('/') ? existsSync(join(target, 'index.html')) : existsSync(target);
        assert.ok(ok, `${file} references missing ${url}`);
      }
    }
  });

  test('JS and CSS assets carry a content hash', () => {
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    assert.match(html, /src="\/assets\/main-[A-Z0-9]{8}\.js"/);
    const assets = readdirSync(join(out, 'assets'));
    assert.ok(assets.some((f) => /^main-[A-Z0-9]{8}\.js$/.test(f)));
    assert.ok(!assets.includes('main.js'));
  });

  test('CNAME is misacorp.dev', () => {
    assert.equal(readFileSync(join(out, 'CNAME'), 'utf8').trim(), 'misacorp.dev');
  });

  test('robots.txt and sitemap.xml are present and consistent', () => {
    assert.match(
      readFileSync(join(out, 'robots.txt'), 'utf8'),
      /Sitemap: https:\/\/misacorp\.dev\/sitemap\.xml/,
    );
    const sitemap = readFileSync(join(out, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /<loc>https:\/\/misacorp\.dev\/<\/loc>/);
    assert.doesNotMatch(sitemap, /404/);
  });

  test('no placeholder lorem ipsum text', () => {
    for (const file of htmlFiles()) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /lorem ipsum/i, file);
    }
  });
});
