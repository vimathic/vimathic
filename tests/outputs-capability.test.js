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

// ── The output the capability flag gates ─────────────────────────────────────
// The flag above decides whether the panel offers the Virtual Camera; nothing
// drove the thing it offers. VirtualCameraOutput's constructor, start() and
// stop() were all uncovered, so `captureStream(30)` in place of
// `captureStream(fps)` passed the whole suite — and the mismatch is invisible
// from inside the app, because modals.js prints "📷 Virtual Camera active @
// ${fps}fps" from the value it REQUESTED, not from the stream it got.
describe('the Virtual Camera streams at the rate the panel asked for', () => {

  /** A renderer whose canvas records the fps captureStream was called with. */
  const makeRenderer = () => {
    const track = { kind: 'video', stopped: false, stop() { this.stopped = true; } };
    const calls = [];
    return {
      calls, track,
      domElement: {
        captureStream(fps) { calls.push(fps); return { getTracks: () => [track] }; },
      },
    };
  };

  const freshVcam = async () => {
    setUA(CHROME_UA);
    globalThis.HTMLCanvasElement = canvasWith(true);
    const { VirtualCameraOutput } = await freshOutputs();
    const renderer = makeRenderer();
    return { vcam: new VirtualCameraOutput(renderer), renderer };
  };

  test('the fps the OUTPUT panel sends is the fps the canvas is captured at', async () => {
    const { vcam, renderer } = await freshVcam();

    const res = vcam.start(24);

    assert.deepEqual(renderer.calls, [24],
      'the stream runs at a rate the panel never chose, while the panel says otherwise');
    assert.equal(res.ok, true);
    assert.equal(res.stream, vcam.getStream());
    assert.equal(vcam.active, true);
    assert.equal(vcam._fps, 24);
  });

  test('control — the documented default is 60, not whatever was last used', async () => {
    const { vcam, renderer } = await freshVcam();
    vcam.start();
    assert.deepEqual(renderer.calls, [60]);
    assert.equal(vcam._fps, 60);
  });

  test('stop gives the tracks back and forgets the stream', async () => {
    // A stream left running holds the canvas capture alive after the operator
    // pressed STOP, and the panel would show a live camera that is not offered.
    const { vcam, renderer } = await freshVcam();
    vcam.start(30);
    assert.equal(renderer.track.stopped, false, 'precondition: the track is live');

    vcam.stop();

    assert.equal(renderer.track.stopped, true);
    assert.equal(vcam.active, false);
    assert.equal(vcam.getStream(), null);
  });

  test('control — stopping twice is not a crash', async () => {
    const { vcam } = await freshVcam();
    vcam.start(30);
    vcam.stop();
    vcam.stop();
    assert.equal(vcam.active, false);
  });

  test('control — without the API, start refuses and says why', async () => {
    // The same question the capability flag answers, asked at the point of use.
    setUA(CHROME_UA);
    globalThis.HTMLCanvasElement = canvasWith(false);
    const { VirtualCameraOutput } = await freshOutputs();
    const renderer = makeRenderer();
    const vcam = new VirtualCameraOutput(renderer);

    const res = vcam.start(24);

    assert.equal(res.ok, false);
    assert.match(res.error, /captureStream/);
    assert.equal(vcam.active, false, 'a refused start must not leave the panel showing "active"');
    assert.deepEqual(renderer.calls, [], 'the canvas was never asked');
  });

  test('control — a canvas that refuses reports the reason instead of throwing', async () => {
    setUA(CHROME_UA);
    globalThis.HTMLCanvasElement = canvasWith(true);
    const { VirtualCameraOutput } = await freshOutputs();
    const vcam = new VirtualCameraOutput({
      domElement: { captureStream() { throw new Error('NotAllowedError'); } },
    });

    const res = vcam.start(30);

    assert.equal(res.ok, false);
    assert.equal(res.error, 'NotAllowedError');
    assert.equal(vcam.active, false);
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
