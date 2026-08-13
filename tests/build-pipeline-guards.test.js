// tests/build-pipeline-guards.test.js
//
// Tests for the guards themselves — the CI job that is supposed to catch a
// broken deploy, and the two config files that have to agree about a port.
//
// Run:
//   node --test tests/build-pipeline-guards.test.js
//
// ── Why these exist ───────────────────────────────────────────────────────────
// A check that cannot fail is worse than no check, because it is believed. The
// "Vite build (single-file)" job is one of the two required checks on main and
// its whitelist step is only half a spec: it forbids files that should not be
// in dist/ and never asks for the ones that must be. The round-4 audit built a
// dist/ with no second screen, no docs site, no sitemap, no robots.txt and no
// llms.txt, and all three verify steps went green.
//
// So these tests do not re-implement the shell — they lift the real `run:`
// block out of .github/workflows/ci.yml and execute it against fixture
// directories. If someone edits the workflow, this test runs the edit.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let viteConfig;
before(async () => { viteConfig = (await import('../vite.config.js')).default; });

// ── Lifting a step out of the workflow ───────────────────────────────────────

/** The lines of the named step, from its `- name:` up to the next one. */
function ciStep(stepName) {
  const lines = read('.github/workflows/ci.yml').split('\n');
  const start = lines.findIndex(l => l.trim() === `- name: ${stepName}`);
  assert.ok(start >= 0, `no step named "${stepName}" in .github/workflows/ci.yml`);
  let end = lines.findIndex((l, i) => i > start && /^\s*- name: /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end);
}

/** The shell script of the named step's `run: |` block, dedented. */
function ciRunScript(stepName) {
  const lines = ciStep(stepName);
  const at = lines.findIndex(l => /^\s*run: \|\s*$/.test(l));
  assert.ok(at >= 0, `step "${stepName}" has no block-scalar run:`);
  const indent = lines[at].match(/^\s*/)[0].length + 2;
  const body = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') { body.push(''); continue; }
    if (line.match(/^\s*/)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

function runScript(script, cwd) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8' });
  return { code: r.status, output: `${r.stdout}${r.stderr}` };
}

// ── A dist/ to point it at ───────────────────────────────────────────────────

// What a healthy build leaves in dist/. The worker filename is content-hashed,
// so index.html has to name the very chunk that was emitted.
const WORKER = 'math-worker-Djaf2vx2.js';
const FULL_DIST = [
  'index.html', 'second-screen.html', WORKER, 'vimathic-intro.mp3',
  'support-hero.png', 'support-hero.webp', 'og-image.png',
  'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png',
  'apple-touch-icon.png', 'android-chrome-192.png', 'android-chrome-512.png',
  'site.webmanifest', 'sitemap.xml', 'robots.txt', 'llms.txt',
  'docs/index.html', 'docs/roadmap.html',
];

const TMPS = [];
/** A fixture project whose dist/ holds `files`. */
function distWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vimathic-dist-'));
  TMPS.push(dir);
  for (const f of files) {
    const full = path.join(dir, 'dist', f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    // index.html has to be big enough for the size gate and has to reference
    // the worker chunk, the way the real single-file bundle does.
    fs.writeFileSync(full, f === 'index.html'
      ? `<!doctype html><script>new Worker(new URL("${WORKER}",import.meta.url))</script>${'x'.repeat(400_000)}`
      : 'x');
  }
  return dir;
}
const without = (...drop) => FULL_DIST.filter(f => !drop.includes(f));

describe('the required build check asks for the files a deploy needs', () => {

  // FIX(#37, r4). Every one of the job's verify steps was one-sided: the
  // whitelist forbade extras, the script grep looked only inside index.html
  // and the size gate bounded index.html alone — which stays over 1 MB with
  // every document dropped, because the docs are ~117 KB of an inlined
  // megabyte. A build missing the second screen, the worker, the docs site,
  // the sitemap, robots.txt and llms.txt passed all three.
  const script = () => ciRunScript('Verify dist/ contents (whitelist)');

  // [ file removed, what the user loses, what the failure must say ]. The
  // worker chunk is content-hashed, so the check can only name its shape.
  const MUST_BE_THERE = [
    ['second-screen.html', 'the SECOND SCREEN button opens a 404', /second-screen\.html/],
    [WORKER,               'the geometry never computes',          /math-worker/],
    ['vimathic-intro.mp3', 'the intro track 404s',                 /vimathic-intro\.mp3/],
    ['sitemap.xml',        'the sitemap is gone',                  /sitemap\.xml/],
    ['robots.txt',         'the crawler policy is gone',           /robots\.txt/],
    ['llms.txt',           'the LLM summary is gone',              /llms\.txt/],
    ['docs/index.html',    'the whole docs site is gone',          /docs\/index\.html/],
    ['support-hero.webp',  'the Roadmap hero is broken',           /support-hero\.webp/],
  ];

  for (const [file, consequence, named] of MUST_BE_THERE) {
    test(`a dist/ without ${file} fails the check — otherwise ${consequence}`, () => {
      const r = runScript(script(), distWith(without(file)));
      assert.notEqual(r.code, 0, r.output);
      assert.match(r.output, named, 'the failure has to name what is missing');
    });
  }

  test('a dist/ whose index.html points at a worker chunk that was not emitted fails', () => {
    const dir = distWith(without(WORKER));
    fs.writeFileSync(path.join(dir, 'dist', 'math-worker-OTHERHASH.js'), 'x');
    const r = runScript(script(), dir);
    assert.notEqual(r.code, 0, r.output);
  });

  test('control — a complete dist/ passes', () => {
    const r = runScript(script(), distWith(FULL_DIST));
    assert.equal(r.code, 0, r.output);
  });

  test('control — a leaked chunk in dist/ root still fails', () => {
    const r = runScript(script(), distWith([...FULL_DIST, 'leaked-chunk.js']));
    assert.notEqual(r.code, 0, r.output);
    assert.match(r.output, /leaked-chunk\.js/);
  });

  test('control — the comment above the list still calls itself the spec', () => {
    const step = ciStep('Verify dist/ contents (whitelist)').join('\n');
    assert.match(step, /the spec/,
      'both halves are documented in that comment block; it is where a reader looks');
  });
});

describe('the required test job describes the scope it actually runs', () => {

  // FIX(#44, r4). The step's comment read "208 tests" for a step that runs the
  // whole unit suite — 540 tests at the time of writing, and a different number
  // by the time you read this. It is the only statement in the workflow of what
  // the check covers, and the job's name ("Math validation tests") already
  // understates it, so a maintainer reconciling the two concluded the check was
  // narrower than it is.
  const step = () => ciStep('Run tests').join('\n');

  test('it states no test count, because a count cannot stay true', () => {
    assert.doesNotMatch(step(), /\b\d[\d,]*\s+tests\b/,
      'a hand-written total goes stale the day the next test file lands');
  });

  test('it names the glob package.json actually runs', () => {
    const script = JSON.parse(read('package.json')).scripts.test;
    const glob = script.match(/(tests\/\S+\.test\.js)/)[1];
    assert.match(step(), new RegExp(glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `package.json runs \`${script}\`; the comment should say so in those terms`);
  });

  test('control — it still points at the file that does the maths', () => {
    assert.match(step(), /tests\/math-validation\.test\.js/);
    assert.match(step(), /run: npm test/);
  });
});

describe('the dev server is pinned to the port the e2e harness demands', () => {

  // FIX(#43, r4). vite.config.js declared port 3000 as a preference — without
  // strictPort, Vite's documented behaviour when 3000 is taken is to bind the
  // next free port and log it — while playwright.config.js hardcodes 3000
  // twice as an absolute. With two checkouts of VIMATHIC open, the e2e suite
  // then runs against whichever one already holds the port: the right app at
  // the wrong revision, whose failures read as product bugs.
  const pwPorts = () => {
    const src = read('playwright.config.js');
    const ports = [...src.matchAll(/http:\/\/localhost:(\d+)/g)].map(m => Number(m[1]));
    assert.ok(ports.length >= 2, 'playwright.config.js no longer hardcodes the dev URL');
    return ports;
  };

  test('a busy port is a failure, not a silent relocation', () => {
    assert.equal(viteConfig.server.strictPort, true);
  });

  test('control — both configs still name the same port', () => {
    for (const p of pwPorts()) assert.equal(p, viteConfig.server.port);
  });

  test('control — the server playwright starts is the one this config configures', () => {
    assert.match(read('playwright.config.js'), /command: 'npm run dev'/);
    assert.equal(JSON.parse(read('package.json')).scripts.dev, 'vite');
  });
});
