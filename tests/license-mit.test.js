// tests/license-mit.test.js
//
// VIMATHIC is MIT-licensed (owner's decision, 23.11.2026). It was BUSL-1.1,
// converting to GPL v3 four years after each release, with an educational
// exception and a dual grant on contributions. Contract tests between
// LICENSE.txt and everything that states or depends on the licence.
//
// Run:
//   node --test tests/license-mit.test.js
//
// ── What this pins ────────────────────────────────────────────────────────────
// - LICENSE.txt is the MIT License and nothing else. Add anything to it — the
//   bundled-audio clause, the third-party list that used to sit in it — and
//   GitHub stops recognising the licence. Those live in NOTICE.md instead.
// - The MIT grant does not reach the intro track: NOTICE.md carves it out, by
//   the name of the file that actually ships.
// - No document still states the old terms. The switch touched some twenty
//   files; one left behind tells a reader the code is not theirs to sell, or
//   promises a GPL conversion that is no longer coming.
//
// Replaces tests/license-date-consistency.test.js, which computed the BUSL
// Change Date — a date this licence does not have.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');
const words = s => s.replace(/\s+/g, ' ').trim();

/**
 * The MIT permission text — "Permission is hereby granted" through the final
 * "SOFTWARE." — as three.js ships it: a copy this repository did not write,
 * so a typo in LICENSE.txt cannot be matched by the same typo here.
 */
function referenceMitBody() {
  const ref  = read('node_modules/three/LICENSE');
  const from = ref.indexOf('Permission is hereby granted');
  const to   = ref.lastIndexOf('SOFTWARE.') + 'SOFTWARE.'.length;
  assert.ok(from >= 0 && to > from, 'node_modules/three/LICENSE holds no MIT text to compare against');
  return words(ref.slice(from, to));
}

describe('LICENSE.txt is the MIT License', () => {

  test('the title, the copyright line, then the MIT text word for word — and nothing else', () => {
    const lines = read('LICENSE.txt').split('\n');
    assert.equal(lines[0], 'MIT License');
    assert.equal(lines[1], '');
    assert.equal(lines[2], 'Copyright (c) 2025–2026 S. Melentyev');
    assert.equal(words(lines.slice(3).join('\n')), referenceMitBody(),
      'LICENSE.txt differs from the MIT text, or carries something after it');
  });

  test('package.json and the lockfile declare MIT', () => {
    assert.equal(JSON.parse(read('package.json')).license, 'MIT');
    assert.equal(JSON.parse(read('package-lock.json')).packages[''].license, 'MIT',
      'package-lock.json still declares the old licence for the root package');
  });

  test('control — the reference really is the MIT text', () => {
    const body = referenceMitBody();
    assert.ok(body.startsWith('Permission is hereby granted, free of charge'));
    assert.ok(body.includes('The above copyright notice and this permission notice shall be included'));
    assert.ok(body.endsWith('OTHER DEALINGS IN THE SOFTWARE.'));
  });
});

describe('the MIT grant does not reach the bundled intro track', () => {

  test('NOTICE.md carves the track out, by the name of the file that ships', () => {
    const m = read('NOTICE.md').match(
      /The audio file `([^`]+)`[\s\S]{0,200}?is \*\*not\*\* licensed under the MIT License/);
    assert.ok(m, 'NOTICE.md no longer carves the intro track out of the MIT grant');
    assert.ok(existsSync(path.join(ROOT, 'public', m[1])),
      `NOTICE.md carves out ${m[1]}, which is not the track public/ ships`);
  });

  test('the two places a reader meets the licence send them to NOTICE.md for the track', () => {
    for (const rel of ['README.md', 'documents/license.md']) {
      const body = read(rel);
      assert.match(body, /intro track/, `${rel} no longer mentions the intro track`);
      assert.match(body, /NOTICE\.md/, `${rel} does not point at NOTICE.md, where the track's terms are`);
    }
  });
});

// ── The old terms, wherever they might still be stated ────────────────────────

const STALE = [
  [/BUSL/,                         'names BUSL'],
  [/Business Source/i,             'names the Business Source License'],
  [/Change Date/i,                 'promises a Change Date'],
  [/\bGPL\b/,                      'promises GPL'],
  [/source-available/i,            'calls the code source-available'],
  [/educational exception/i,       'offers an educational exception'],
  [/dual[- ]grant|open-core/i,     'describes the dual-grant contribution model'],
  [/2030-05-18|2031-05-09/,        'quotes a conversion date'],
];

/** Every file under `rel` whose name passes `keep`, recursively. */
function walk(rel, keep) {
  const out = [];
  for (const name of readdirSync(path.join(ROOT, rel))) {
    const child = `${rel}/${name}`;
    if (statSync(path.join(ROOT, child)).isDirectory()) out.push(...walk(child, keep));
    else if (keep(name)) out.push(child);
  }
  return out;
}

/**
 * What a reader or a redistributor reads: the root documents, the in-app
 * documentation, the GitHub templates, the source and plugin headers, the
 * page itself. CHANGELOG.md is left out on purpose — it records what the
 * licence was, and is right to.
 */
function currentFiles() {
  const rootDocs = readdirSync(ROOT).filter(n => /\.(md|txt)$/.test(n) && n !== 'CHANGELOG.md');
  return [
    ...rootDocs,
    ...walk('documents', n => n.endsWith('.md')),
    ...walk('.github', n => /\.(md|yml)$/.test(n)),
    ...walk('src', n => n.endsWith('.js')),
    ...walk('plugins', n => n.endsWith('.js')),
    'index.html',
    'package.json',
  ];
}

describe('no document still states the old terms', () => {

  test('none of the old licence\'s words survive outside the changelog', () => {
    const offenders = [];
    for (const rel of currentFiles()) {
      read(rel).split('\n').forEach((line, i) => {
        for (const [re, what] of STALE) {
          if (re.test(line)) offenders.push(`${rel}:${i + 1} ${what}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    assert.deepEqual(offenders, [], `the old licence is still stated:\n  ${offenders.join('\n  ')}`);
  });

  test('control — the walk reaches the files the old terms were in', () => {
    const files = currentFiles();
    for (const rel of ['README.md', 'CONTRIBUTING.md', 'DISCLAIMER.md', 'LICENSE.txt', 'NOTICE.md',
                       'documents/license.md', 'documents/index.md', '.github/PULL_REQUEST_TEMPLATE.md',
                       'src/main.js', 'src/ui/about-modal.js', 'plugins/vimathic-docs.js']) {
      assert.ok(files.includes(rel), `the walk misses ${rel}`);
    }
    assert.ok(files.length >= 60, `only ${files.length} files walked`);
  });

  test('control — the patterns catch the sentences they replaced', () => {
    const old = [
      'VIMATHIC is licensed under [BUSL-1.1](./LICENSE.txt), auto-converting to GPL v3 four years after each version\'s release — **2030-05-18** for 1.0.0-beta.',
      'The code is under **Business Source License 1.1** ("BUSL-1.1").',
      'This dual license reflects a sustainable open-core model: the source-available VIMATHIC (this repository) is free forever',
      '**Educational exception:** accredited schools, universities, and non-profit educational',
    ];
    for (const line of old) {
      assert.ok(STALE.some(([re]) => re.test(line)), `no pattern catches: ${line}`);
    }
  });
});

// ── The name ──────────────────────────────────────────────────────────────────
// The owner dropped the ™ after VIMATHIC (23.11.2026): the README heading, the
// page title in the browser tab, DISCLAIMER, SECURITY, the Overview footer and
// the name line of NOTICE.md and the License page carried it. The sign and the
// spellings HTML and plain text have for it, wherever the name is written for a
// reader — CHANGELOG.md excepted again, since it records the change.

const TM = /™|&trade;|&#8482;|&#x2122;|\(TM\)/i;

describe('the name is written without ™', () => {

  test('no ™ anywhere a reader meets the name', () => {
    const files = [...currentFiles(), 'second-screen.html', 'public/site.webmanifest',
                   'logo-dark.svg', 'logo-light.svg'];
    const offenders = [];
    for (const rel of files) {
      read(rel).split('\n').forEach((line, i) => {
        if (TM.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
    }
    assert.deepEqual(offenders, [], `a trademark sign is back:\n  ${offenders.join('\n  ')}`);
  });

  test('control — the pattern catches every spelling, and not the bare name', () => {
    for (const s of ['VIMATHIC™', 'VIMATHIC&trade;', 'VIMATHIC&#8482;', 'VIMATHIC&#x2122;', 'VIMATHIC (TM)']) {
      assert.match(s, TM, `${s} slips through`);
    }
    assert.doesNotMatch('<title>VIMATHIC — Mathematical Music Visualizer</title>', TM);
  });
});

// The owner retired "Mathematical VJ Studio" the same day: VJ software mixes
// video clips and layers, and VIMATHIC makes the picture itself and hands it to
// such software — a source, not a mixer. It is a Mathematical Music Visualizer,
// "a playground where real mathematics moves to your music" — the descriptor in
// every title, the line in every summary, and the subtitle under both logos.
// "VJ" stays where it names the audience or the software VIMATHIC feeds.

describe('the product is a mathematical music visualizer, not a VJ studio', () => {

  const NAME = 'Mathematical Music Visualizer';
  const LINE = 'a playground where real mathematics moves to your music';
  const NAMED = [...currentFiles(), 'second-screen.html', 'public/site.webmanifest',
                 'logo-dark.svg', 'logo-light.svg'];

  test('nothing a reader meets still calls it a VJ studio', () => {
    const offenders = [];
    for (const rel of NAMED) {
      read(rel).split('\n').forEach((line, i) => {
        if (/VJ[ -]studio/i.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
    }
    assert.deepEqual(offenders, [], `"VJ studio" is back:\n  ${offenders.join('\n  ')}`);
  });

  test('every title carries the descriptor', () => {
    const html = read('index.html');
    assert.match(html, new RegExp(`<title>VIMATHIC — ${NAME}</title>`), 'the browser tab');
    assert.match(html, new RegExp(`property="og:title"\\s+content="VIMATHIC — ${NAME}"`), 'the link preview');
    assert.match(html, new RegExp(`name="twitter:title"\\s+content="VIMATHIC — ${NAME}"`), 'the X card');
    assert.match(html, new RegExp(`<h2 id="about-title">VIMATHIC <span class="about-subtitle">${NAME}</span></h2>`),
      'the About window — the descriptor on its own line under the name');
    assert.match(read('README.md'), new RegExp(`\\*\\*${NAME} 1\\.0 \\(Beta\\)\\*\\*`), 'the README tagline');
    assert.match(read('documents/index.md'), new RegExp(`^# VIMATHIC — ${NAME}$`, 'm'), 'the Overview heading');
    assert.ok(JSON.parse(read('package.json')).description.startsWith(`VIMATHIC — ${NAME}.`), 'package.json');
    const manifest = JSON.parse(read('public/site.webmanifest'));
    assert.ok(manifest.description.toLowerCase().startsWith(NAME.toLowerCase()), 'the install dialog');
    assert.equal(manifest.screenshots[0].label, `VIMATHIC — ${NAME}`);
  });

  test('every summary opens with the playground line', () => {
    for (const [rel, where] of [
      ['README.md', 'the README header'],
      ['documents/index.md', 'the Overview page'],
      ['plugins/vimathic-docs.js', 'llms.txt'],
      ['index.html', 'the page description'],
      ['public/site.webmanifest', 'the install dialog'],
    ]) {
      assert.ok(read(rel).toLowerCase().includes(LINE), `${where} (${rel}) lost the playground line`);
    }
  });

  test('both logos say it under the wordmark, inside their own canvas', () => {
    for (const rel of ['logo-dark.svg', 'logo-light.svg']) {
      const svg = read(rel);
      const m = svg.match(/<text x="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*letter-spacing="([\d.]+)"[^>]*>MATHEMATICAL MUSIC VISUALIZER<\/text>/);
      assert.ok(m, `${rel} has no MATHEMATICAL MUSIC VISUALIZER subtitle`);
      // Courier New advances 0.6 em per glyph; the width of the line is what the
      // canvas has to hold. Measured in Chrome when this was set: 408 of 480 and
      // 309 of 360.
      const [x, size, spacing] = m.slice(1).map(Number);
      const right = x + 29 * (0.6 * size + spacing) - spacing;
      const width = Number(svg.match(/viewBox="0 0 ([\d.]+) /)[1]);
      assert.ok(right <= width - 8, `${rel}: the subtitle runs to ${right.toFixed(0)} of ${width}`);
    }
  });
});
