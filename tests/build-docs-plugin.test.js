// tests/build-docs-plugin.test.js
//
// Contract tests for the docs build plugin — the parse it performs on
// documents/*.md and the four artifacts it emits beside the bundle.
//
// Run:
//   node --test tests/build-docs-plugin.test.js
//
// ── Why these exist ───────────────────────────────────────────────────────────
// tests/docs-plugin-order.test.js covers one field of one document. Everything
// else this plugin does — the description fallback, the frontmatter fences, the
// static pages, the sitemap, llms.txt — reached users without a single test
// looking at it, and the round-4 audit found six defects sitting in that gap.
// Each test below names the one it pins.
//
// The plugin imports only node:fs, node:path and micromark, so it runs here
// without Vite: `load()` is called directly for the modal-side array, and
// `closeBundle()` is called with the working directory pointed at a fixture so
// nothing is written into the repository.

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

/** A throwaway project dir with a documents/ folder holding the given files. */
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vimathic-docs-'));
  TMPS.push(dir);
  fs.mkdirSync(path.join(dir, 'documents'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, 'documents', name), body, 'utf8');
  }
  return dir;
}

/** The DOCS array the modal receives, keyed by slug. */
function loadDocs(dir) {
  const plugin = vimathicDocs({ dir: path.join(dir, 'documents') });
  const code = plugin.load('\0virtual:vimathic-docs');
  const docs = JSON.parse(code.replace(/^export default /, '').replace(/;\s*$/, ''));
  return { docs, bySlug: Object.fromEntries(docs.map(d => [d.slug, d])) };
}

/** Run the real closeBundle() with cwd in the fixture, then read dist/ back. */
function emit(dir, opts = {}) {
  const plugin = vimathicDocs({ dir: path.join(dir, 'documents'), ...opts });
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    plugin.closeBundle();
  } finally {
    process.chdir(cwd);
  }
  return {
    read: rel => fs.readFileSync(path.join(dir, rel), 'utf8'),
    exists: rel => fs.existsSync(path.join(dir, rel)),
  };
}

const fm = (front, body) => `---\n${front}\n---\n\n${body}\n`;

// ─────────────────────────────────────────────────────────────────────────────

describe('the description fallback produces text, not half-rendered HTML', () => {

  // FIX(#38, r4). A document with no `description:` gets one derived from its
  // first paragraph — but the paragraph came out of micromark, where `&` is
  // already `&amp;`, `"` is `&quot;` and the author's line break is still in
  // place. Stripping tags is not decoding, so the entity codes and the newline
  // travelled into <meta content="..."> (double-escaped) and into llms.txt,
  // where the newline splits one link entry across two lines.
  const dir = () => fixture({
    'audio-and-midi.md': fm('title: Audio & MIDI\norder: 1',
      'Route audio & MIDI together — the "Learn" button maps a knob to any param.\nIt is the one feature nobody finds unaided.'),
    'plain.md': fm('title: Plain\norder: 2\ndescription: Presets & clips, the "live" way.', 'Body.'),
    'long.md': fm('title: Long\norder: 3', 'x'.repeat(400)),
  });

  test('entities are decoded and the line break is collapsed', () => {
    const { bySlug } = loadDocs(dir());
    assert.equal(
      bySlug['audio-and-midi'].description,
      'Route audio & MIDI together — the "Learn" button maps a knob to any param. ' +
      'It is the one feature nobody finds unaided.',
      'the derived description is plain text, so it carries no entity codes and no newline',
    );
  });

  test('control — an explicit frontmatter description is passed through as written', () => {
    const { bySlug } = loadDocs(dir());
    assert.equal(bySlug['plain'].description, 'Presets & clips, the "live" way.');
  });

  test('control — the rendered HTML keeps its escaping', () => {
    const { bySlug } = loadDocs(dir());
    assert.match(bySlug['audio-and-midi'].html, /&amp;/,
      'only the plain-text description is decoded; the html is markup and stays escaped');
  });

  test('control — a long first paragraph is still truncated to 160 characters', () => {
    const { bySlug } = loadDocs(dir());
    assert.ok(bySlug['long'].description.length <= 160, bySlug['long'].description.length);
    assert.ok(bySlug['long'].description.endsWith('...'));
  });
});

describe('frontmatter is read whatever the line endings are', () => {

  // FIX(#39, r4). The fence regex demanded bare LF, so a CRLF working tree —
  // which is what git's Windows default hands a contributor on checkout —
  // matched nothing: every document lost its title, order, group and
  // description and printed its own YAML block as body text.
  const crlf = s => s.replace(/\n/g, '\r\n');
  const dir = () => fixture({
    'crlf.md': crlf(fm('title: CRLF Doc\norder: 2\ngroup: getting-started\ndescription: Written on Windows.', 'Body of the CRLF doc.')),
    'lf.md':   fm('title: LF Doc\norder: 3\ngroup: getting-started\ndescription: Written on Linux.', 'Body of the LF doc.'),
    'bare.md': 'No frontmatter here.\n',
  });

  test('a CRLF document keeps its title, order, group and description', () => {
    const { bySlug } = loadDocs(dir());
    const d = bySlug['crlf'];
    assert.equal(d.title, 'CRLF Doc');
    assert.equal(d.order, 2);
    assert.equal(d.group, 'getting-started');
    assert.equal(d.description, 'Written on Windows.');
  });

  test('a CRLF document does not render its own frontmatter as body text', () => {
    const { bySlug } = loadDocs(dir());
    assert.doesNotMatch(bySlug['crlf'].html, /title:/,
      'an unmatched fence leaves the YAML in the body, where micromark makes an <h2> of it');
    assert.match(bySlug['crlf'].html, /Body of the CRLF doc\./);
  });

  test('control — the LF twin parses to the same shape', () => {
    const { bySlug } = loadDocs(dir());
    assert.equal(bySlug['lf'].title, 'LF Doc');
    assert.equal(bySlug['lf'].order, 3);
    assert.equal(bySlug['lf'].group, 'getting-started');
    assert.doesNotMatch(bySlug['lf'].html, /title:/);
  });

  test('control — a document with no frontmatter keeps all of its body', () => {
    const { bySlug } = loadDocs(dir());
    assert.equal(bySlug['bare'].title, 'Bare', 'the title-cased slug is the fallback');
    assert.match(bySlug['bare'].html, /No frontmatter here\./);
  });
});

describe('`order` is read as a number or not at all', () => {

  // FIX(#40, r4). parseInt stops at the first character it cannot use, so
  // `order: 4.5` arrived as 4 — a silent tie with whatever already holds 4,
  // broken by an unrelated document's title — and `order: 6 spaces` arrived
  // as 6. Both slip past the Number.isFinite guard, which only ever sees the
  // truncated result.
  const dir = () => fixture({
    'frac.md':    fm('title: Frac\norder: 4.5', 'Body.'),
    'garbage.md': fm('title: Garbage\norder: 6 spaces', 'Body.'),
    'zero.md':    fm('title: Zero\norder: 0', 'Body.'),
    'twelve.md':  fm('title: Twelve\norder: 12', 'Body.'),
    'none.md':    fm('title: None', 'Body.'),
  });

  test('a fractional order survives instead of truncating into a collision', () => {
    assert.equal(loadDocs(dir()).bySlug['frac'].order, 4.5);
  });

  test('a value that is not a number falls back to the default', () => {
    assert.equal(loadDocs(dir()).bySlug['garbage'].order, 1000,
      '"6 spaces" is not an order; accepting it as 6 is the same silent truncation');
  });

  test('control — 0, a plain integer and a missing order are unchanged', () => {
    const { bySlug } = loadDocs(dir());
    assert.equal(bySlug['zero'].order, 0);
    assert.equal(bySlug['twelve'].order, 12);
    assert.equal(bySlug['none'].order, 1000);
  });
});

describe('document assets are addressed relative to the page that shows them', () => {

  // FIX(#41, r4). documents/roadmap.md pointed its hero at /support-hero.webp
  // and /support-hero.png. Root-absolute resolves to the filesystem root when
  // dist/index.html is opened over file://, which README.md documents as a
  // supported way to run the app, so the Roadmap tab showed its alt text.
  const dir = () => fixture({
    'index.md': fm('title: Overview\norder: 0\ndescription: Overview.', 'See [roadmap](./roadmap.md).'),
    'roadmap.md': fm('title: Roadmap\norder: 4\ndescription: What comes next.',
      '<picture>\n  <source srcset="./support-hero.webp" type="image/webp">\n  <img src="./support-hero.png" alt="hero">\n</picture>\n\nSee [overview](./index.md).'),
  });

  test('no shipped document addresses an asset from the site root', () => {
    for (const f of fs.readdirSync(path.join(ROOT, 'documents')).filter(n => n.endsWith('.md'))) {
      const md = read(path.join('documents', f));
      assert.doesNotMatch(md, /\b(src|srcset)="\//,
        `${f}: a root-absolute asset is broken under file:// and under any sub-path deploy`);
    }
  });

  test('the static docs page climbs out of dist/docs/ to reach the asset', () => {
    const out = emit(dir());
    const page = out.read('dist/docs/roadmap.html');
    assert.match(page, /srcset="\.\.\/support-hero\.webp"/);
    assert.match(page, /src="\.\.\/support-hero\.png"/);
  });

  test('control — cross-document links still become .html on the static pages', () => {
    const out = emit(dir());
    assert.match(out.read('dist/docs/roadmap.html'), /href="\.\/index\.html"/,
      'the .md→.html rewrite must not be caught by the asset rewrite');
  });

  test('control — the modal copy keeps the .md links the modal handles', () => {
    const { bySlug } = loadDocs(dir());
    assert.match(bySlug['roadmap'].html, /href="\.\/index\.md"/);
    assert.match(bySlug['roadmap'].html, /srcset="\.\/support-hero\.webp"/,
      'inside dist/index.html the asset sits next to the page, so ./ is right there');
  });
});

describe('the plugin documents the array it actually hands the modal', () => {

  // FIX(#45, r4). The header block promised `{ slug, title, html, order, raw,
  // description }`. load() drops `raw` on the way out and ships `group`, which
  // is the field the About modal branches on to build its dropdown tabs — so
  // the one field a consumer must know about was the one left undocumented.
  const documentedFields = () => {
    const src = read('plugins/vimathic-docs.js');
    const m = src.match(/DOCS is an array of \{([^}]*)\}/);
    assert.ok(m, 'the consumer contract comment is gone from the plugin header');
    return m[1].split(',').map(s => s.trim()).filter(Boolean).sort();
  };

  test('the commented contract lists exactly the fields load() emits', () => {
    const plugin = vimathicDocs({ dir: path.join(ROOT, 'documents') });
    const docs = JSON.parse(plugin.load('\0virtual:vimathic-docs')
      .replace(/^export default /, '').replace(/;\s*$/, ''));
    assert.deepEqual(documentedFields(), Object.keys(docs[0]).sort());
  });

  test('control — `raw` is still stripped before the array is bundled', () => {
    const { docs } = loadDocs(fixture({ 'a.md': fm('title: A\norder: 1', 'Body.') }));
    assert.ok(!('raw' in docs[0]), 'the markdown source would roughly double the docs payload');
  });
});

describe('llms.txt counts the deploy the way the human documents do', () => {

  // FIX(#46, r4). llms.txt said "a single HTML file plus four companion files"
  // — five in total — while SECURITY.md and documents/index.md both say four
  // files including index.html. The count is hand-maintained prose, which is
  // what FIX(#30) asked to be re-checked against its sources; an enumeration
  // cannot drift by one the way a bare number can.
  const NUMBER_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];

  /** The self-contained files SECURITY.md names, index.html excluded. */
  function companionsPerSecurityMd() {
    const md = read('SECURITY.md');
    const m = md.match(/self-contained files:([\s\S]*?)\n\s*\n/);
    assert.ok(m, 'SECURITY.md no longer lists the files a deploy consists of');
    const files = [...m[1].matchAll(/`([^`]+)`/g)].map(x => x[1]);
    assert.ok(files.includes('index.html'), files.join(', '));
    return files.filter(f => f !== 'index.html');
  }

  test('the companion count agrees with SECURITY.md', () => {
    const out = emit(fixture({ 'a.md': fm('title: A\norder: 1', 'Body.') }));
    const expected = `plus ${NUMBER_WORD[companionsPerSecurityMd().length]} companion files`;
    assert.match(out.read('dist/llms.txt'), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('the companions are named, so the next drift is visible', () => {
    const txt = emit(fixture({ 'a.md': fm('title: A\norder: 1', 'Body.') })).read('dist/llms.txt');
    assert.match(txt, /Web Worker/);
    assert.match(txt, /second-screen/);
    assert.match(txt, /intro track/);
  });

  test('control — the bundle size figure FIX(#30, r2) corrected is still stated', () => {
    const txt = emit(fixture({ 'a.md': fm('title: A\norder: 1', 'Body.') })).read('dist/llms.txt');
    assert.match(txt, /~1\.1 MB/);
  });
});

describe('sitemap <lastmod> is the date the document changed', () => {

  // FIX(#47, r4). One `new Date()` was stamped onto every URL, so each deploy
  // told every crawler that all fifteen pages had changed that day — and
  // Cloudflare Pages rebuilds on every push to main, including pushes that
  // touch no document at all.
  const dir = () => {
    const d = fixture({
      'index.md': fm('title: Overview\norder: 0\ndescription: Overview.', 'Body.'),
      'old.md':   fm('title: Old\norder: 1\ndescription: Old.', 'Body.'),
      'newer.md': fm('title: Newer\norder: 2\ndescription: Newer.', 'Body.'),
    });
    const at = (name, iso) => {
      const t = new Date(iso + 'T12:00:00Z');
      fs.utimesSync(path.join(d, 'documents', name), t, t);
    };
    at('old.md', '2024-03-04');
    at('newer.md', '2025-11-12');
    return d;
  };

  /** { url → lastmod } out of the emitted sitemap. */
  function lastmods(xml) {
    return Object.fromEntries([...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)]
      .map(m => [m[1], m[2]]));
  }

  test('two documents of different ages get different dates', () => {
    const m = lastmods(emit(dir()).read('dist/sitemap.xml'));
    assert.equal(m['https://vimathic.com/docs/old.html'], '2024-03-04');
    assert.equal(m['https://vimathic.com/docs/newer.html'], '2025-11-12');
  });

  test('control — the site root is the build date, because the bundle is rebuilt each deploy', () => {
    const m = lastmods(emit(dir()).read('dist/sitemap.xml'));
    assert.equal(m['https://vimathic.com/'], new Date().toISOString().slice(0, 10));
  });

  test('control — every URL still carries one well-formed lastmod', () => {
    const xml = emit(dir()).read('dist/sitemap.xml');
    const m = lastmods(xml);
    assert.equal(Object.keys(m).length, (xml.match(/<url>/g) || []).length);
    assert.equal(Object.keys(m).length, 4, 'root, /docs/, and one page per non-index document');
    for (const [loc, when] of Object.entries(m)) assert.match(when, /^\d{4}-\d{2}-\d{2}$/, loc);
  });
});

describe('the emitted files follow the output directory Vite resolved', () => {

  // FIX(#49, r4). closeBundle() re-derived its destination as <cwd>/dist,
  // independently of build.outDir. With any other outDir, Vite wrote the
  // bundle to one directory and this plugin wrote the docs site, sitemap,
  // robots.txt and llms.txt to a freshly created dist/ beside it — and the
  // build reported success.
  const docs = () => fixture({ 'a.md': fm('title: A\norder: 1\ndescription: A.', 'Body.') });

  test('a configured outDir is where the docs site lands', () => {
    const dir = docs();
    const plugin = vimathicDocs({ dir: path.join(dir, 'documents') });
    plugin.configResolved({ root: dir, build: { outDir: 'build' } });
    const cwd = process.cwd();
    try { process.chdir(dir); plugin.closeBundle(); } finally { process.chdir(cwd); }

    assert.ok(fs.existsSync(path.join(dir, 'build', 'sitemap.xml')), 'sitemap.xml → build/');
    assert.ok(fs.existsSync(path.join(dir, 'build', 'docs', 'a.html')), 'docs/ → build/');
    assert.ok(!fs.existsSync(path.join(dir, 'dist')), 'nothing is left behind in dist/');
  });

  test('control — the default outDir still puts everything in dist/', () => {
    const out = emit(docs());
    for (const f of ['dist/sitemap.xml', 'dist/robots.txt', 'dist/llms.txt', 'dist/docs/a.html']) {
      assert.ok(out.exists(f), f);
    }
  });
});
