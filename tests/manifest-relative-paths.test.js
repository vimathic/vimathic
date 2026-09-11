// tests/manifest-relative-paths.test.js
//
// public/site.webmanifest addresses its icons, its screenshot and its start_url
// the way the rest of the app addresses everything: relative to the page.
//
// The repository states this rule in two other places and tests it in one:
//   src/outputs.js:358-361            — the second-screen popup URL
//   plugins/vimathic-docs.js:253-261  — FIX(#41, r4), the document hero images
//   tests/outputs-capability.test.js  — pins the first of those
//
// The manifest was written with root-absolute paths and shipped that way while
// nothing linked it, so the rule was never tested against it. The r5 commit
// added <link rel="manifest"> to index.html, which made those four paths live —
// and on the two deploys README.md documents (a sub-path host such as
// https://user.github.io/vimathic/, and file://) "/android-chrome-192.png"
// resolves to the host root or the filesystem root. The icons 404, and Chrome
// withholds the install prompt the link was added to enable: a manifest whose
// icons cannot be fetched is not installable. The apex domain is the one deploy
// where the bug is invisible.
//
// Root-absolute is correct in exactly one place in this file and it is not here:
// og:image and canonical in index.html are absolute by necessity, because a
// crawler resolves them from outside any page context.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/site.webmanifest'), 'utf8'));

describe('the web manifest survives a sub-path and a file:// deploy', () => {

  const urlFields = [
    ...(manifest.icons ?? []).map((i, n) => [`icons[${n}].src`, i.src]),
    ...(manifest.screenshots ?? []).map((s, n) => [`screenshots[${n}].src`, s.src]),
    ['start_url', manifest.start_url],
  ];

  test('every URL in the manifest is relative', () => {
    assert.ok(urlFields.length >= 4, 'expected icons, a screenshot and start_url to be present');
    for (const [field, value] of urlFields) {
      assert.ok(typeof value === 'string' && value.length > 0, `${field} is missing`);
      assert.doesNotMatch(value, /^\//,
        `${field} is "${value}" — root-absolute resolves to the host root under a sub-path deploy ` +
        'and to the filesystem root under file://, so the icon 404s and the install prompt is withheld');
      assert.doesNotMatch(value, /^[a-z][a-z0-9+.-]*:/i,
        `${field} is "${value}" — an absolute URL pins the manifest to one origin`);
    }
  });

  test('every file the manifest names is actually shipped in public/', () => {
    for (const [field, value] of urlFields) {
      if (value === './' || value === '.') continue;          // start_url is the page, not a file
      const rel = value.replace(/^\.\//, '');
      assert.ok(fs.existsSync(path.join(ROOT, 'public', rel)),
        `${field} names ${rel}, which is not in public/`);
    }
  });

  test('index.html links the manifest — an unlinked manifest is never read', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.match(html, /<link\s+rel="manifest"\s+href="\.\/site\.webmanifest">/,
      'the manifest shipped unlinked from 1.0 until r5; keep the link, and keep it relative too');
  });

  test('the theme-color meta agrees with the manifest', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const meta = html.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/);
    assert.ok(meta, 'index.html declares no theme-color');
    assert.equal(meta[1].toLowerCase(), String(manifest.theme_color).toLowerCase(),
      'the address bar is painted from the meta before the manifest is read; two values means two colours');
  });
});
