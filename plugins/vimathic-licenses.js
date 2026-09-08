/**
 * VIMATHIC — Mathematical VJ Studio
 * Copyright (c) 2026 S. Melentyev. All rights reserved.
 * Licensed under BUSL-1.1 — see LICENSE.txt
 * https://github.com/vimathic/vimathic
 */

/**
 * vimathic-licenses.js — Vite plugin
 *
 * Carries the third-party permission notices into the artifact that is actually
 * distributed.
 *
 * ── What was wrong ─────────────────────────────────────────────────────────
 * The whole app ships as one `dist/index.html` through vite-plugin-singlefile,
 * with three.js and gif.js inlined into it. Both are MIT, and the MIT licence
 * requires its copyright line and permission notice to travel with "all copies
 * or substantial portions of the Software" — a 1.3 MB HTML file containing all
 * of three.js is not a borderline case.
 *
 * Measured on a real build before this plugin existed:
 *
 *   dist/index.html   "MIT License"                 12   (the app's own docs)
 *                     "mrdoob" / "Johan Nordberg"    2 each
 *                     "Permission is hereby granted"  0
 *                     "Copyright"                     0
 *
 * So the artifact named both authors and stated the licence by name while
 * carrying neither notice. This is not a minifier stripping comments: the
 * vendored sources never had the text to strip. `three/build/three.module.js`
 * carries one incidental "copyright" and no notice; `gif.js/dist/gif.js` and
 * its worker carry neither. three ships a LICENSE file in its package, and
 * gif.js does not ship one at all — its notice lives in the README.
 *
 * ── What this does ─────────────────────────────────────────────────────────
 * Collects each bundled dependency's notice from its own package — never from
 * a copy written out here, which would be a licence text maintained by someone
 * with no reason to update it — and both writes dist/THIRD-PARTY-LICENSES.txt
 * and appends the notices to dist/index.html, so the single file that gets
 * emailed around satisfies the clause on its own.
 *
 * A dependency whose notice cannot be found FAILS THE BUILD. The alternative is
 * shipping without it, which is the thing being fixed, and a warning in a build
 * log is how that would happen again.
 */

import fs from 'fs';
import path from 'path';

/**
 * Third-party code that ends up inside dist/index.html.
 *
 * Only these two: src/ imports `three` (plus several of its examples/jsm
 * modules) and `gif.js` (plus its worker, as a ?raw string). micromark and
 * micromark-extension-gfm-table are build-time only — the docs plugin renders
 * markdown with them and none of their code reaches the bundle — so they are
 * deliberately absent. tests/build-licenses.test.js checks this list against
 * what src/ actually imports, rather than trusting this comment.
 */
export const BUNDLED_DEPS = ['three', 'gif.js'];

const MIT_MARK = 'Permission is hereby granted';

/** Files a package might keep its licence in, in the order worth trying. */
const LICENSE_FILES = ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license', 'license.md', 'LICENCE'];

/**
 * The notice text a package ships, or null.
 *
 * Two sources, because the packages differ: three has a LICENSE file, gif.js
 * publishes no licence file at all and keeps the notice under "## License" in
 * its README. Both are the package's own words either way.
 */
export function findNotice(pkgDir) {
  for (const name of LICENSE_FILES) {
    const p = path.join(pkgDir, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8').trim();
    if (text.includes(MIT_MARK)) return { text, from: name };
  }
  for (const name of ['README.md', 'readme.md']) {
    const p = path.join(pkgDir, name);
    if (!fs.existsSync(p)) continue;
    const readme = fs.readFileSync(p, 'utf8');
    const at = readme.indexOf(MIT_MARK);
    if (at < 0) continue;
    // Back up to the heading that introduces it, so the copyright line — which
    // sits above "Permission is hereby granted" — comes with it. A notice
    // without its copyright line is not the notice.
    const head = readme.lastIndexOf('\n#', at);
    const start = head < 0 ? Math.max(0, at - 400) : head;
    const end = readme.indexOf('\n#', at);
    const text = readme.slice(start, end < 0 ? readme.length : end)
      .replace(/^#+ */gm, '')
      .trim();
    return { text, from: name };
  }
  return null;
}

export function collectNotices(rootDir, deps = BUNDLED_DEPS) {
  return deps.map(dep => {
    const pkgDir = path.join(rootDir, 'node_modules', ...dep.split('/'));
    if (!fs.existsSync(pkgDir)) {
      throw new Error(`[vimathic-licenses] ${dep} is not installed — cannot ship its notice`);
    }
    const found = findNotice(pkgDir);
    if (!found) {
      throw new Error(
        `[vimathic-licenses] no permission notice found for ${dep}. Its code is inlined into ` +
        `dist/index.html, so the notice has to travel with it. Look in node_modules/${dep} for ` +
        'a LICENSE file or a licence section in the README, and add the filename to ' +
        'LICENSE_FILES in plugins/vimathic-licenses.js if it is somewhere new.'
      );
    }
    return { dep, ...found };
  });
}

export function renderNotices(notices) {
  const head =
    'THIRD-PARTY LICENCES\n' +
    '\n' +
    'VIMATHIC itself is licensed under BUSL-1.1 (see LICENSE.txt). The single-file\n' +
    'build inlines the libraries below, and their notices travel with it.\n';
  const body = notices.map(n =>
    `${'='.repeat(72)}\n${n.dep}  (from ${n.from})\n${'='.repeat(72)}\n\n${n.text}\n`
  ).join('\n');
  return `${head}\n${body}`;
}

export function vimathicLicenses(opts = {}) {
  const deps = opts.deps ?? BUNDLED_DEPS;
  let root = null;
  let outDir = null;

  return {
    name: 'vimathic-licenses',

    configResolved(config) {
      // Both, and from the same place: node_modules is looked up under the
      // project root, and reading it from process.cwd() while writing to a
      // configured outDir would be two different projects on the same run.
      root = path.resolve(config.root ?? process.cwd());
      outDir = path.resolve(root, config.build?.outDir ?? 'dist');
    },

    closeBundle() {
      const rootDir = root ?? process.cwd();
      const distDir = outDir ?? path.resolve(rootDir, 'dist');
      const notices = collectNotices(rootDir, deps);
      const text = renderNotices(notices);

      if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, 'THIRD-PARTY-LICENSES.txt'), text, 'utf8');

      // And into the single file, which is the copy that actually gets shared.
      // An HTML comment: present in every copy, invisible to the reader, and
      // costing about 2 KB against 1.3 MB.
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        // A licence text containing "-->" would end the comment early and spill
        // the rest into the document. No MIT notice does, and if one ever did
        // the honest response is to stop rather than to quietly rewrite
        // somebody's licence.
        if (text.includes('-->')) {
          throw new Error('[vimathic-licenses] a notice contains "-->" and cannot be inlined as an HTML comment');
        }
        const html = fs.readFileSync(indexPath, 'utf8');
        if (!html.includes(MIT_MARK)) {
          fs.writeFileSync(indexPath, `${html}\n<!--\n${text}\n-->\n`, 'utf8');
        }
      }

      console.log(`[vimathic-licenses] ${notices.length} notices → ${path.basename(distDir)}/THIRD-PARTY-LICENSES.txt and index.html`);
    },
  };
}

export default vimathicLicenses;
