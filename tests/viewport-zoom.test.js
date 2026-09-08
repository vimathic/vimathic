// tests/viewport-zoom.test.js
//
// The page can be zoomed; the visualisation is not zoomed by accident.
//
// index.html carried `user-scalable=no` in its viewport meta, which reads like
// a guard against a stray pinch wrecking a set. It was not one.
//
//   • The canvas was never at risk from it. OrbitControls sets
//     `domElement.style.touchAction = 'none'` when it connects, so a pinch on
//     the visualisation belongs to the camera and never reaches the browser's
//     zoom. That is three.js's own doing and needs nothing from the viewport.
//
//   • What the token actually cost was the panel and the documentation modal —
//     the small text a reader would want to enlarge. WCAG 1.4.4 asks for 200%.
//
//   • And it cost that on Android only. Safari has ignored `user-scalable=no`
//     since iOS 10, so iPads and iPhones — the largest touch class this app has
//     — have behaved as if it were absent for eight years. Removing it makes
//     Android agree with them rather than changing anything for them.
//
// second-screen.html never carried the token, so the two documents disagreed
// with each other as well. This file pins all of it, including the parts that
// are somebody else's code, because that is exactly what would change under us.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const HTML_DOCS = ['index.html', 'second-screen.html'];

const viewportOf = (file) => {
  const m = read(file).match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
  assert.ok(m, `${file} declares no viewport meta`);
  return m[1];
};

describe('every document the user reads can be zoomed', () => {

  for (const file of HTML_DOCS) {
    test(`${file} does not forbid it`, () => {
      const content = viewportOf(file);
      assert.doesNotMatch(content, /user-scalable\s*=\s*(no|0)/i,
        `${file} blocks pinch-zoom. It does not protect the canvas — OrbitControls ` +
        'already sets touch-action:none there — it only stops a reader enlarging the ' +
        'panel and the docs, and only on Android, since iOS has ignored it since iOS 10.');
      assert.doesNotMatch(content, /maximum-scale\s*=\s*1(\.0)?\b/i,
        `${file} pins maximum-scale to 1, which forbids zoom by the other spelling`);
    });

    test(`${file} still sets width=device-width`, () => {
      // Not cosmetic: it is what keeps Chrome from restoring the 300 ms tap
      // delay and double-tap-to-zoom on a page full of transport buttons.
      assert.match(viewportOf(file), /width\s*=\s*device-width/,
        `${file} lost width=device-width, which brings back the 300 ms tap delay`);
    });
  }

  test('the two documents agree with each other', () => {
    // They did not: index.html carried the token and second-screen.html never
    // did, so the same gesture behaved differently in the two windows of one
    // session — the operator's laptop and the projector.
    const [a, b] = HTML_DOCS.map(viewportOf);
    const norm = s => s.split(',').map(t => t.trim()).sort().join(', ');
    assert.equal(norm(a), norm(b),
      `index.html says "${a}" and second-screen.html says "${b}"`);
  });
});

describe('the canvas is still the camera\'s, not the browser\'s', () => {

  test('OrbitControls takes touch-action on the element it is given', () => {
    // The whole case for removing the token rests on this line being in the
    // library. If a three.js upgrade drops it, a pinch on the visualisation
    // starts zooming the page mid-set, and this says so before that ships.
    const src = read('node_modules/three/examples/jsm/controls/OrbitControls.js');
    assert.match(src, /domElement\.style\.touchAction\s*=\s*'none'/,
      'OrbitControls no longer sets touch-action:none on its element, so nothing ' +
      'stops a pinch on the canvas from zooming the page. Set it in app code, or ' +
      'reconsider the viewport meta.');
  });

  test('the controls are attached to the canvas itself', () => {
    // touch-action on some other element would protect some other element.
    assert.match(read('src/render.js'),
      /new OrbitControls\(\s*this\.camera\s*,\s*this\.renderer\.domElement\s*\)/,
      'OrbitControls is no longer attached to the renderer canvas, so the guard above ' +
      'is being applied to something else');
  });
});
