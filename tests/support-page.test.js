// tests/support-page.test.js
//
// The About modal's Roadmap tab is Support now (owner's decision, 23.11.2026):
// the development plan is out, and the page has its old name back — it was
// documents/support.md until 15.05, when it was folded into the roadmap.
//
// Run:
//   node --test tests/support-page.test.js
//
// The modal's tabs come from the same DOCS array the app imports, built here by
// the docs plugin's own load() over the real documents/ folder; the static site
// is emitted by its own closeBundle() into a throwaway copy, so nothing is
// written into the repository.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let vimathicDocs;
before(async () => { ({ vimathicDocs } = await import('../plugins/vimathic-docs.js')); });

const TMPS = [];
after(() => { for (const d of TMPS) fs.rmSync(d, { recursive: true, force: true }); });

/** The DOCS array the About modal receives. */
function modalDocs() {
  const code = vimathicDocs({ dir: path.join(ROOT, 'documents') }).load('\0virtual:vimathic-docs');
  return JSON.parse(code.replace(/^export default /, '').replace(/;\s*$/, ''));
}

describe('the About modal has a Support tab and no roadmap', () => {

  test('Support stands where Roadmap stood, and there is no Roadmap tab', () => {
    const docs = modalDocs();
    const support = docs.find(d => d.slug === 'support');
    assert.ok(support, 'the modal has no support document');
    assert.equal(support.title, 'Support');
    assert.equal(support.order, 4, 'the tab moved from where Roadmap stood');
    assert.equal(support.group, null, 'Roadmap was a top-level tab, not inside a group menu');
    assert.ok(!docs.some(d => d.slug === 'roadmap' || /roadmap/i.test(d.title)),
      'a Roadmap tab is still in the modal');
  });

  test('the page carries no development plan', () => {
    const md = read('documents/support.md');
    for (const [re, what] of [
      [/\b(NOW|NEXT|LATER)\b/,                       'the NOW / NEXT / LATER plan'],
      [/Mobile|iOS|Android|App Store|Google Play/,   'the mobile app'],
      [/roadmap|what comes next|planned|next step/i, 'the roadmap'],
    ]) {
      assert.doesNotMatch(md, re, `documents/support.md still carries ${what}`);
    }
  });

  test('…and keeps the support itself', () => {
    const md = read('documents/support.md');
    assert.match(md, /\(https:\/\/ko-fi\.com\/smelentyev\)/, 'the Ko-fi link is gone');
    assert.match(md, /## Other ways that aren't money/, 'the non-money ways to help are gone');
    assert.match(md, /vimathic\.info@proton\.me/, 'the contact line is gone');
    assert.match(md, /srcset="\.\/support-hero\.webp"/, 'the hero image is gone');
  });

  test('nothing still sends a reader to the roadmap', () => {
    const files = [
      'README.md', 'DISCLAIMER.md', 'SECURITY.md', 'CONTRIBUTING.md',
      ...fs.readdirSync(path.join(ROOT, 'documents')).filter(n => n.endsWith('.md')).map(n => `documents/${n}`),
    ];
    const offenders = [];
    for (const rel of files) {
      read(rel).split('\n').forEach((line, i) => {
        if (/roadmap\.md|\[Roadmap\]|\bon the roadmap\b/i.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
        }
      });
    }
    assert.deepEqual(offenders, [], `still pointing at the roadmap:\n  ${offenders.join('\n  ')}`);
  });
});

describe('the static docs site follows the rename', () => {

  /** closeBundle() over a copy of the real documents/, in a throwaway dir. */
  function emitReal() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vimathic-support-'));
    TMPS.push(dir);
    fs.cpSync(path.join(ROOT, 'documents'), path.join(dir, 'documents'), { recursive: true });
    const plugin = vimathicDocs({ dir: path.join(dir, 'documents') });
    const cwd = process.cwd();
    try { process.chdir(dir); plugin.closeBundle(); } finally { process.chdir(cwd); }
    return rel => fs.readFileSync(path.join(dir, rel), 'utf8');
  }

  test('support.html is emitted and listed; the sitemap and llms.txt name no roadmap', () => {
    const out = emitReal();
    assert.match(out('dist/docs/support.html'), /<title>Support — VIMATHIC<\/title>/);
    const sitemap = out('dist/sitemap.xml');
    assert.match(sitemap, /\/docs\/support\.html/);
    assert.doesNotMatch(sitemap, /roadmap/);
    const llms = out('dist/llms.txt');
    assert.match(llms, /- \[Support\]\(https:\/\/vimathic\.com\/docs\/support\.html\)/);
    assert.doesNotMatch(llms, /roadmap/i);
  });

  test('an old link to docs/roadmap.html still lands on Support', () => {
    // public/ is copied into dist/ as it stands, so this file is what a
    // bookmark or an outside link to the old page gets from now on.
    const stub = read('public/docs/roadmap.html');
    const target = stub.match(/http-equiv="refresh" content="0; url=\.\/([a-z-]+)\.html"/);
    assert.ok(target, 'public/docs/roadmap.html no longer redirects');
    assert.equal(target[1], 'support');
    assert.ok(fs.existsSync(path.join(ROOT, 'documents', `${target[1]}.md`)),
      'the redirect points at a page the docs build does not emit');
    assert.match(stub, /<a href="\.\/support\.html">/, 'no plain link for a browser that ignores the refresh');
    assert.match(stub, /<meta name="robots" content="noindex/, 'the old address would be indexed beside the new one');
    assert.match(stub, /<link rel="canonical" href="https:\/\/vimathic\.com\/docs\/support\.html">/);
  });
});
