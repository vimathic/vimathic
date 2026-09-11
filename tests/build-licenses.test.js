// tests/build-licenses.test.js
//
// The notices of the libraries inlined into dist/index.html travel with it.
//
// ── What was wrong ──────────────────────────────────────────────────────────
// The whole app ships as one HTML file through vite-plugin-singlefile, with
// three.js and gif.js inlined. Both are MIT, and MIT requires the copyright
// line and permission notice to accompany "all copies or substantial portions
// of the Software" — 1.3 MB of HTML containing the whole of three.js is not a
// borderline case. Measured on a real build before the plugin existed:
//
//   "MIT License"                  12   (the app's own documentation)
//   "mrdoob", "Johan Nordberg"      2 each
//   "Permission is hereby granted"  0
//   "Copyright"                     0
//
// The artifact named both authors and stated the licence by name while carrying
// neither notice. It is not a minifier stripping comments either — the vendored
// sources never had the text: three/build/three.module.js carries one
// incidental "copyright" and no notice, gif.js/dist/*.js carry neither, three
// ships a LICENSE file in its package and gif.js ships none at all.
//
// ── What is checked here ────────────────────────────────────────────────────
// The list of bundled dependencies is derived from what src/ imports rather
// than trusted, because the failure mode is a third library being added and
// nobody remembering this file. Notice discovery runs against the real
// node_modules, so a dependency upgrade that drops its LICENSE fails here
// rather than in an artifact already sent to someone.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let BUNDLED_DEPS, findNotice, collectNotices, renderNotices, vimathicLicenses;
before(async () => {
  ({ BUNDLED_DEPS, findNotice, collectNotices, renderNotices, vimathicLicenses } =
    await import('../plugins/vimathic-licenses.js'));
});

const TMPS = [];
after(() => { for (const d of TMPS) fs.rmSync(d, { recursive: true, force: true }); });

function tmpdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vimathic-lic-'));
  TMPS.push(d);
  return d;
}

/** A project root with a node_modules holding the given packages. */
function fixture(packages) {
  const dir = tmpdir();
  for (const [name, files] of Object.entries(packages)) {
    const pkgDir = path.join(dir, 'node_modules', ...name.split('/'));
    fs.mkdirSync(pkgDir, { recursive: true });
    for (const [file, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(pkgDir, file), body, 'utf8');
    }
  }
  return dir;
}

const MIT = (holder) =>
  `MIT License\n\nCopyright (c) 2013 ${holder}\n\n` +
  'Permission is hereby granted, free of charge, to any person obtaining a copy\n' +
  'of this software and associated documentation files (the "Software"), to deal\n' +
  'in the Software without restriction.\n';

describe('the list of bundled dependencies is the real one', () => {

  test('it matches what src/ actually imports', () => {
    // Bare specifiers only — a relative import is our own code, and a
    // `virtual:` one is a plugin's. Scoped to the package name, so
    // `three/examples/jsm/...` counts as `three`.
    const found = new Set();
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(path.join(d, e.name))
                      : (e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
    for (const file of walk(path.join(ROOT, 'src'))) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
        const spec = m[1];
        if (spec.startsWith('.') || spec.startsWith('/') || spec.includes(':')) continue;
        const name = spec.startsWith('@')
          ? spec.split('/').slice(0, 2).join('/')
          : spec.split('/')[0];
        found.add(name);
      }
    }
    assert.deepEqual([...found].sort(), [...BUNDLED_DEPS].sort(),
      'src/ imports a third-party package that is not in BUNDLED_DEPS, so its licence ' +
      'notice is not being shipped with the code that is inlined next to it');
  });

  test('build-time-only packages are deliberately absent', () => {
    // micromark renders markdown inside the docs plugin; none of it reaches the
    // bundle, so its notice does not belong in the artifact.
    const pkg = JSON.parse(read('package.json'));
    assert.ok(pkg.dependencies.micromark, 'micromark is no longer a dependency — re-read this');
    assert.ok(!BUNDLED_DEPS.includes('micromark'),
      'micromark is build-time only; shipping its notice would claim it is in the bundle');
  });
});

describe('every bundled dependency still ships a notice', () => {

  for (const dep of ['three', 'gif.js']) {
    test(`${dep} has one, in its own package`, () => {
      const pkgDir = path.join(ROOT, 'node_modules', ...dep.split('/'));
      assert.ok(fs.existsSync(pkgDir), `${dep} is not installed`);
      const found = findNotice(pkgDir);
      assert.ok(found, `no permission notice found anywhere in node_modules/${dep}`);
      assert.match(found.text, /Permission is hereby granted/);
      assert.match(found.text, /(?:Copyright|\(c\)|©)/i,
        `the notice found for ${dep} has no copyright line, and a notice without one is not the notice`);
    });
  }

  test('gif.js is the case that has no licence FILE at all', () => {
    // Recorded because it is why findNotice reads READMEs: gif.js publishes
    // only .npmignore, index.js, package.json and README.md.
    const pkgDir = path.join(ROOT, 'node_modules', 'gif.js');
    const files = fs.readdirSync(pkgDir).filter(f => /^licen[cs]e/i.test(f));
    assert.deepEqual(files, [], 'gif.js now ships a licence file — prefer it over the README');
    assert.equal(findNotice(pkgDir).from, 'README.md');
  });
});

describe('discovery refuses to guess', () => {

  test('a package with no notice fails the build', () => {
    const dir = fixture({ 'silent-lib': { 'package.json': '{"license":"MIT"}' } });
    assert.throws(() => collectNotices(dir, ['silent-lib']), /no permission notice found/,
      'a dependency with no findable notice was shipped anyway, which is the bug');
  });

  test('a package that is not installed fails the build', () => {
    assert.throws(() => collectNotices(tmpdir(), ['absent-lib']), /not installed/);
  });

  test('a licence file without the permission text is not accepted as one', () => {
    const dir = fixture({ 'vague-lib': { 'LICENSE': 'MIT. Do what you like.\n' } });
    assert.throws(() => collectNotices(dir, ['vague-lib']), /no permission notice/);
  });

  test('a README notice keeps its copyright line', () => {
    const dir = fixture({ 'readme-lib': { 'README.md': `# readme-lib\n\nSome prose.\n\n## License\n\n${MIT('Someone')}` } });
    const [n] = collectNotices(dir, ['readme-lib']);
    assert.match(n.text, /Copyright \(c\) 2013 Someone/,
      'the copyright line sits above "Permission is hereby granted" and was cut off');
    assert.equal(n.from, 'README.md');
  });
});

describe('the notices reach the artifact', () => {

  /** A fixture project with a built dist/ and the two packages installed. */
  function built(indexBody = '<html><body>app</body></html>') {
    const dir = fixture({
      'three':  { 'LICENSE': MIT('three.js authors') },
      'gif.js': { 'README.md': `# gif.js\n\n## License\n\n${MIT('Johan Nordberg')}` },
    });
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'index.html'), indexBody, 'utf8');
    return dir;
  }

  const run = (dir) => {
    const plugin = vimathicLicenses();
    plugin.configResolved({ root: dir, build: { outDir: 'dist' } });
    plugin.closeBundle();
    return {
      index: fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8'),
      txt:   fs.readFileSync(path.join(dir, 'dist', 'THIRD-PARTY-LICENSES.txt'), 'utf8'),
    };
  };

  test('a companion file lists every dependency', () => {
    const { txt } = run(built());
    for (const dep of ['three', 'gif.js']) assert.match(txt, new RegExp(dep.replace('.', '\\.')));
    assert.equal((txt.match(/Permission is hereby granted/g) ?? []).length, 2);
  });

  test('and the single file carries them itself', () => {
    // The companion file is not enough: the point of this build is that
    // index.html is shared on its own, as an attachment or off a USB stick.
    const { index } = run(built());
    assert.match(index, /Permission is hereby granted/,
      'the file that actually gets shared carries no notice');
    assert.match(index, /Copyright \(c\) 2013 Johan Nordberg/);
    assert.match(index, /Copyright \(c\) 2013 three\.js authors/);
  });

  test('as a comment, so nothing is rendered to the viewer', () => {
    const { index } = run(built());
    const appended = index.slice(index.indexOf('</body>'));
    assert.match(appended, /<!--[\s\S]*Permission is hereby granted[\s\S]*-->/);
  });

  test('running twice does not append twice', () => {
    const dir = built();
    run(dir);
    const { index } = run(dir);
    assert.equal((index.match(/Permission is hereby granted/g) ?? []).length, 2,
      'a rebuild into an existing dist/ stacked the notices');
  });

  test('a notice that would break out of the comment stops the build', () => {
    const dir = fixture({
      'three':  { 'LICENSE': MIT('three.js authors') },
      'gif.js': { 'LICENSE': `${MIT('Johan Nordberg')}\n<!-- oops -->\n` },
    });
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'index.html'), '<html></html>', 'utf8');
    const plugin = vimathicLicenses();
    plugin.configResolved({ root: dir, build: { outDir: 'dist' } });
    assert.throws(() => plugin.closeBundle(), /cannot be inlined as an HTML comment/,
      'a notice containing --> would have spilled the rest of the licence into the document');
  });

  test('renderNotices names the project licence too, so the two are not confused', () => {
    const text = renderNotices([{ dep: 'three', from: 'LICENSE', text: MIT('three.js authors') }]);
    assert.match(text, /BUSL-1\.1/,
      'the file lists MIT notices with nothing saying VIMATHIC itself is not MIT');
  });
});

describe('the plugin is wired into the build', () => {

  test('vite.config.js registers it', () => {
    const cfg = read('vite.config.js');
    assert.match(cfg, /vimathicLicenses\(\)/);
    assert.match(cfg, /import\s*\{\s*vimathicLicenses\s*\}\s*from\s*'\.\/plugins\/vimathic-licenses\.js'/);
  });

  test('it runs before the docs plugin measures the bundle', () => {
    // vimathicDocs states the bundle size in llms.txt from the size of
    // dist/index.html. Appending the notices after that measurement would make
    // the figure describe a file that is no longer the one being shipped.
    const cfg = read('vite.config.js');
    const lic  = cfg.indexOf('vimathicLicenses()');
    const docs = cfg.indexOf('vimathicDocs(');
    assert.ok(lic > -1 && docs > -1, 'one of the two plugins is no longer registered');
    assert.ok(lic < docs,
      'vimathicLicenses must come before vimathicDocs in the plugin array, or llms.txt ' +
      'reports a size taken before the notices were appended');
  });
});
