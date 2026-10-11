import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
let out;
let index;
let notFound;

const read = (file) => readFileSync(join(out, file), 'utf8');
const imgTags = (html) => html.match(/<img\b[^>]*>/gi) ?? [];
const hasAttr = (tag, name) => new RegExp(`\\s${name}(\\s*=|\\s|>|/)`, 'i').test(tag);

describe('site', () => {
  before(() => {
    out = mkdtempSync(join(tmpdir(), 'misacorp-site-'));
    execFileSync(process.execPath, [join(ROOT, 'scripts/build.mjs')], {
      cwd: ROOT,
      env: { ...process.env, OUT_DIR: out, BASE_PATH: '/' },
      stdio: 'pipe',
    });
    index = read('index.html');
    notFound = read('404.html');
  });
  after(() => rmSync(out, { recursive: true, force: true }));

  // The CSS is inlined into index.html; fall back to the emitted file if that ever changes.
  const css = () =>
    index.match(/<style>([\s\S]*?)<\/style>/)?.[1] ??
    readdirSync(join(out, 'assets'))
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(join(out, 'assets', f), 'utf8'))
      .join('\n');

  test('parallax layers exist in back-to-front order with --depth values', () => {
    const hero = index.match(/<header class="hero">([\s\S]*?)<\/header>/)?.[1];
    assert.ok(hero, 'hero header missing');
    const order = [...hero.matchAll(/class="layer layer--([a-z0-9-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, [
      'background',
      'title',
      'mountains-1',
      'mountains-2',
      'mountains-3',
      'mountains-4',
      'trees',
    ]);

    const depths = { background: 0.8, title: 0.75, 'mountains-1': 0.7, 'mountains-2': 0.55 };
    Object.assign(depths, { 'mountains-3': 0.38, 'mountains-4': 0.14 });
    const sheet = css();
    for (const [layer, depth] of Object.entries(depths)) {
      const m = sheet.match(new RegExp(`\\.layer--${layer}\\{--depth:\\s*([\\d.]+)\\}`));
      assert.ok(m, `no --depth for ${layer}`);
      assert.equal(Number(m[1]), depth, `--depth of ${layer}`);
    }
    assert.doesNotMatch(sheet, /\.layer--trees\{--depth/, 'front trees must stay static');
    // Depths must strictly decrease from back to front.
    const values = order.slice(0, -1).map((l) => depths[l]);
    assert.deepEqual(
      values,
      [...values].sort((a, b) => b - a),
    );
  });

  test('CSS scroll-driven animation sits inside @supports and honours reduced motion', () => {
    const sheet = css();
    assert.match(
      sheet,
      /@supports\s*\(animation-timeline:\s*scroll\(\)\)\{[^@]*animation-timeline:/,
    );
    assert.match(sheet, /@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
    // Nothing outside the no-preference media query may drive the layers.
    const outside = sheet.replace(
      /@media\s*\(prefers-reduced-motion:\s*no-preference\)\{[\s\S]*\}$/,
      '',
    );
    assert.doesNotMatch(outside, /animation-timeline/);
    assert.match(sheet, /scroll-behavior:\s*smooth/);
  });

  test('built JS has no jQuery and stays tiny', () => {
    const files = readdirSync(join(out, 'assets')).filter((f) => f.endsWith('.js'));
    assert.ok(files.length > 0);
    for (const f of files) {
      const js = readFileSync(join(out, 'assets', f), 'utf8');
      assert.doesNotMatch(js, /jquery|\$\(/i, f);
      assert.ok(js.length < 4096, `${f} is ${js.length} B`);
    }
    assert.doesNotMatch(index, /jquery|googleapis|unpkg/i);
  });

  test('JSON-LD parses and describes the business without invented details', () => {
    const raw = index.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(raw, 'JSON-LD missing');
    const data = JSON.parse(raw);
    assert.equal(data['@context'], 'https://schema.org');
    assert.equal(data['@type'], 'ProfessionalService');
    assert.equal(data.name, 'Misacorp Visuals');
    assert.equal(data.url, 'https://misacorp.dev/');
    assert.equal(data.email, 'hello@misacorp.dev');
    assert.equal(data.taxID, '2549090-7');
    assert.equal(data.vatID, undefined);
    assert.equal(data.address?.['@type'], 'PostalAddress');
    assert.equal(data.address.addressLocality, 'Tampere');
    assert.equal(data.address.addressCountry, 'FI');
    assert.equal(data.address.streetAddress, undefined);
    assert.equal(data.telephone, undefined);
  });

  test('footer names the business, its Business ID and its municipality', () => {
    const footer = index.match(/<footer>([\s\S]*?)<\/footer>/)?.[1];
    assert.ok(footer, 'footer missing');
    assert.match(footer, /Misacorp Visuals/);
    assert.match(footer, /2549090-7/);
    assert.match(footer, /Tampere/);
  });

  test('head metadata: description length, social cards, favicons', () => {
    const desc = index.match(/<meta name="description" content="([^"]+)"/)?.[1];
    assert.ok(desc && desc.length <= 155, `description is ${desc?.length} chars`);
    assert.match(index, /<meta name="theme-color" content="#EFE7CE"/i);
    assert.match(
      index,
      /<meta property="og:image" content="https:\/\/misacorp\.dev\/og-image\.png"/,
    );
    assert.match(index, /<meta name="twitter:card" content="[a-z_]+"/);
    for (const href of [
      '/favicon.svg',
      '/favicon-32.png',
      '/favicon-16.png',
      '/apple-touch-icon.png',
    ]) {
      assert.ok(index.includes(`href="${href}"`), `${href} not linked`);
    }
  });

  test('404.html is noindex and links home', () => {
    assert.match(notFound, /<meta name="robots" content="noindex"/);
    assert.match(notFound, /<a href="\/"/);
    assert.equal((notFound.match(/<h1\b/g) ?? []).length, 1);
  });

  test('every <img> has alt, width and height; hero images are not lazy', () => {
    const tags = [...imgTags(index), ...imgTags(notFound)];
    assert.ok(tags.length >= 7, 'expected hero images');
    for (const tag of tags) {
      for (const attr of ['alt', 'width', 'height'])
        assert.ok(hasAttr(tag, attr), `${attr}: ${tag}`);
      assert.doesNotMatch(tag, /loading="lazy"/, tag);
    }
  });

  test('exactly one <h1>, one <main>, skip link and footer', () => {
    assert.equal((index.match(/<h1\b/g) ?? []).length, 1);
    assert.equal((index.match(/<main\b/g) ?? []).length, 1);
    assert.match(index, /<a class="skip-link" href="#main">/);
    assert.match(index, /<main id="main">/);
    assert.match(index, /<footer>/);
    assert.match(index, /href="mailto:hello@misacorp\.dev"/);
    for (const id of ['about', 'services', 'contact'])
      assert.match(index, new RegExp(`id="${id}"`));
    assert.match(index, /<a class="scroll-down" href="#about">/);
  });
});
