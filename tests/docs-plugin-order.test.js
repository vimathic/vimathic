// tests/docs-plugin-order.test.js
//
// Contract test for the docs build plugin's frontmatter parse.
//
// Run:
//   node --test tests/docs-plugin-order.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// `meta.order = parseInt(trimmed, 10) || 1000` turns a legitimate `order: 0`
// into the default, and documents/index.md — the Overview page — declares
// exactly that. So Overview sorted last of fourteen, and the About modal opens
// DOCS[0] when it has no remembered tab: on first run, which is precisely when
// the modal auto-opens for a new user, it showed Quick Start instead of the
// overview written to be read first.
//
// The plugin imports only node:fs, node:path and micromark, so it runs here
// without Vite. The directory is passed as an absolute path so the test does
// not depend on the working directory.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let vimathicDocs;
before(async () => { ({ vimathicDocs } = await import('../plugins/vimathic-docs.js')); });

/** Run the plugin's load hook and read back the DOCS array it emits. */
function loadDocs() {
  const plugin = vimathicDocs({ dir: path.join(ROOT, 'documents') });
  const code = plugin.load('\0virtual:vimathic-docs');
  return JSON.parse(code.replace(/^export default /, '').replace(/;\s*$/, ''));
}

describe('the docs plugin reads frontmatter numbers as numbers', () => {

  test('order: 0 is an order, not a missing value', () => {
    const docs = loadDocs();
    const overview = docs.find(d => d.slug === 'index');

    assert.ok(overview, 'documents/index.md should be in the bundle');
    assert.equal(overview.order, 0, '`|| 1000` cannot tell 0 from absent');
    assert.equal(docs[0].slug, 'index',
      'the About modal opens DOCS[0] on first run — the tab a new user is shown');
  });

  test('control — a page with no order still lands on the default', () => {
    const docs = loadDocs();
    for (const d of docs) {
      assert.ok(Number.isFinite(d.order), `${d.slug} has a non-numeric order: ${d.order}`);
    }
  });

  test('control — the bundle is sorted by order', () => {
    const orders = loadDocs().map(d => d.order);
    const sorted = [...orders].sort((a, b) => a - b);
    assert.deepEqual(orders, sorted);
  });
});
