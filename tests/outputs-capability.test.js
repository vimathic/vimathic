// tests/outputs-capability.test.js
//
// Contract tests for the output layer's two gates: what it says a browser can
// do, and where it opens the second screen from.
//
// Run:
//   node --test tests/outputs-capability.test.js
//
// ── Defect 1: the Virtual Camera is gated on a brand ──────────────────────────
// `virtualCamera: SUPPORTS_CAPTURE_STREAM && IS_CHROME`, where IS_CHROME
// deliberately excludes Edge. Every consumer of the flag needs one thing only —
// canvas.captureStream — and the method's own guard is exactly that test. So on
// Edge, which is Chromium and has captureStream, the modal printed "Not
// supported", refused to start, and told the operator to use Chrome; the same
// for any other engine that ships the API. The check is answerable directly.
//
// ── Defect 2: the second screen opens from the site root ──────────────────────
// window.open('/second-screen.html') is root-absolute: from
// file:///…/dist/index.html it resolves to file:///second-screen.html, and from
// https://user.github.io/vimathic/ to https://user.github.io/second-screen.html
// — a 404 in both. The build emits the page next to index.html, README
// advertises opening dist/index.html over file://, and audio.js spells out this
// exact rule for the intro track one file over.
//
// ── Why the imports carry a query string ──────────────────────────────────────
// The capability flags are computed once, at module load, from navigator. A
// query string makes each import a distinct module so a second UA can be
// measured in the same process.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const CHROME_UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const EDGE_UA    = CHROME_UA + ' Edg/131.0.0.0';
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

const setUA = ua => Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: ua, platform: 'Win32' }, configurable: true,
});

/** A canvas element class that either has captureStream or does not. */
const canvasWith = has => {
  const C = class {};
  if (has) C.prototype.captureStream = function () { return { getTracks: () => [] }; };
  return C;
};

let tag = 0;
/** Import a fresh copy of outputs.js under the environment set up by the caller. */
const freshOutputs = () => import(`../src/outputs.js?probe=${++tag}`);

before(() => {
  globalThis.window = globalThis.window ?? {};
  globalThis.document = globalThis.document ?? { getElementById: () => null };
});

describe('the Virtual Camera is offered on capability, not on brand', () => {

  test('Edge has captureStream, so it is offered', async () => {
    setUA(EDGE_UA);
    globalThis.HTMLCanvasElement = canvasWith(true);

    const { OUTPUT_CAPABILITIES } = await freshOutputs();

    assert.equal(OUTPUT_CAPABILITIES.virtualCamera, true,
      'Edge is Chromium and ships the API the feature needs — the brand test excluded it anyway');
  });

  test('so does any other engine that ships it', async () => {
    setUA(FIREFOX_UA);
    globalThis.HTMLCanvasElement = canvasWith(true);

    const { OUTPUT_CAPABILITIES } = await freshOutputs();

    assert.equal(OUTPUT_CAPABILITIES.virtualCamera, true);
  });

  test('control — without the API it is not offered, whatever the browser says it is', async () => {
    setUA(CHROME_UA);
    globalThis.HTMLCanvasElement = canvasWith(false);

    const { OUTPUT_CAPABILITIES } = await freshOutputs();

    assert.equal(OUTPUT_CAPABILITIES.virtualCamera, false,
      'the flag must answer the capability question, not be pinned true');
  });

  test('control — Chrome with the API is still offered, and the other flags are untouched', async () => {
    setUA(CHROME_UA);
    globalThis.HTMLCanvasElement = canvasWith(true);

    const { OUTPUT_CAPABILITIES } = await freshOutputs();

    assert.equal(OUTPUT_CAPABILITIES.virtualCamera, true);
    assert.equal(OUTPUT_CAPABILITIES.ndi, false);
    assert.equal(OUTPUT_CAPABILITIES.spoutBrowser, false);
    assert.equal(OUTPUT_CAPABILITIES.obsSource, true);
  });
});

describe('the second screen opens relative to the page', () => {
  let opened, ss;

  const makeScreen = async () => {
    setUA(CHROME_UA);
    globalThis.HTMLCanvasElement = canvasWith(true);
    opened = [];
    globalThis.window = {
      screen: { availWidth: 1920, availHeight: 1080 },
      // close() is load-bearing: SecondScreen.close() calls it before clearing
      // its 800 ms watch interval, and a popup stub without it leaves that
      // interval running — which keeps `node --test` alive forever.
      open(url) {
        opened.push(url);
        const popup = { closed: false, focus() {}, postMessage() {}, close() { popup.closed = true; } };
        return popup;
      },
    };
    const { SecondScreen } = await freshOutputs();
    return new SecondScreen({ domElement: { captureStream: () => ({ getTracks: () => [] }) } });
  };

  // open() arms an 800 ms interval to watch the popup; leaking it keeps
  // `node --test` alive forever.
  after(() => ss?.close?.());

  // The finally is load-bearing, including on failure: a failed assertion that
  // skips close() leaves the watch interval running and `node --test` never
  // exits — the run reports the assertion and then hangs.
  test('it is a sibling of index.html, not a child of the domain root', async () => {
    ss = await makeScreen();
    try {
      ss.open(60);
      assert.equal(opened[0], './second-screen.html',
        'root-absolute resolves to file:///second-screen.html over file://, and to the ' +
        'domain root on a project page — a 404 in both');
    } finally { ss.close(); }
  });

  test('control — a second open focuses the popup instead of opening another', async () => {
    ss = await makeScreen();
    try {
      ss.open(60);
      ss.open(60);
      assert.equal(opened.length, 1);
    } finally { ss.close(); }
  });
});
