// tests/recorder-capture-lifecycle.test.js
//
// Contract tests for what a capture run holds, draws and says — the parts of
// src/recorder.js that only show themselves once a whole run has been driven
// from start() to the file.
//
// Run:
//   node --test tests/recorder-capture-lifecycle.test.js
//
// ── Defect 1 (#10): a successful run never gives the encoder back ─────────────
// abort() was explicitly taught to release it — "idle workers and the captured
// frames' RGBA buffers survive that abort(). Without these two lines each
// cancelled run strands hundreds of MB and a couple of live Workers" — but the
// 'finished' handler, the path every completed recording takes, did none of it.
// The panel's own default (native 720p, 15 fps, 10 s) queues 143 frames of
// 3.7 MB each, so half a gigabyte of Uint8ClampedArray plus two live worker
// threads stayed reachable from the module-level recorder for the rest of the
// session. The workers accumulate two per run and, once the next start()
// overwrites _gif, nothing can terminate them at all.
//
// ── Defect 2 (#12): nothing ever cleared the destination canvas ───────────────
// Both capture paths drew the WebGL canvas into a persistent 2D canvas with the
// default source-over compositing. That is only equivalent to a replace while
// the source is opaque — and TRANSPARENT BG (documents/output.md: "the canvas
// alpha channel is preserved through to the output stream") makes it not be, so
// each frame composited on top of the previous one and the clip became a
// thickening smear of the whole take.
//
// ── Defect 3 (#20): the GIF crop rectangle was frozen at arm time ─────────────
// The GIF loop computed its cover-crop rect once, with a comment calling a stale
// rect harmless; the WebM loop in the same file recomputes it every frame with
// the opposite justification. A window resize mid-capture (main.js binds resize
// to render.onResize(), which calls setSize) changes canvas.width/height, and a
// source rect that then overruns the source is clipped — the destination with
// it, so only part of the frame is redrawn.
//
// ── Defect 4 (#14): the error message was erased by its own abort ─────────────
// The capture loop's catch called cb.onError and then abort(), and abort() ends
// in cb.onAbort — which the UI writes to the same two lines, in grey, as
// "Recording cancelled". Both fire inside one task, so the diagnostic never
// reached a repaint: a lost context or an allocation failure was indistinguish-
// able from the user pressing STOP.
//
// ── Defect 5 (#11): abort() delivered a file anyway ───────────────────────────
// The module header states the contract: "abort() — bail out without producing
// a file; cb.onAbort fires." It stopped the MediaRecorder without detaching
// onstop, so the queued stop task built a Blob out of the freshly emptied chunk
// array and called cb.onDone — and the UI downloaded a headerless .webm and
// printed "✓ WebM saved" in green right after "Recording cancelled".
//
// ── Why the resolve hook ──────────────────────────────────────────────────────
// gif.js ships a CommonJS entry that exports its encoder internals, and a
// "browser" field pointing at dist/gif.js, the bundle that exports the GIF
// class. Vite resolves the browser field; bare node resolves main, so
// `new GIF(...)` would throw here. The hook reproduces Vite's choice, so these
// tests drive the real encoder object the app drives — its real frames array,
// its real worker pool — rather than an imitation of it.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_GIF = pathToFileURL(path.join(ROOT, 'node_modules/gif.js/dist/gif.js')).href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    return next(spec === 'gif.js' ? ${JSON.stringify(DIST_GIF)} : spec, ctx);
  }
`));

// gif.js's worker source is imported as a raw string that node evaluates as
// CJS, and it touches `self` — the same one-liner recorder-gif-timing.test.js
// needs.
globalThis.self = globalThis;

// ── A 2D canvas that records what was asked of it ────────────────────────────
// Every context keeps its own call log, so the recorder's scratch canvas can be
// told apart from the intermediate canvas gif.js allocates for itself.
function make2dContext(canvas) {
  const calls = [];
  const log = name => (...args) => { calls.push([name, ...args]); };
  return {
    _calls: calls,
    canvas,
    imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    font: '', textBaseline: '', textAlign: '', letterSpacing: '',
    strokeStyle: '', fillStyle: '', lineWidth: 0, lineJoin: '',
    save: log('save'), restore: log('restore'),
    translate: log('translate'), scale: log('scale'),
    clearRect: log('clearRect'), fillRect: log('fillRect'),
    strokeText: log('strokeText'), fillText: log('fillText'),
    drawImage: (...args) => {
      if (canvas._throwOnDraw) throw new Error(canvas._throwOnDraw);
      calls.push(['drawImage', ...args]);
    },
    getImageData: (x, y, w, h) => {
      calls.push(['getImageData', x, y, w, h]);
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
  };
}

function makeCanvas(w = 0, h = 0) {
  return {
    width: w, height: h,
    // gif.js's addFrame picks its element branch on childNodes; without it the
    // real encoder rejects the scratch canvas with "Invalid image".
    childNodes: [],
    captureStream: () => makeStream(),
    getContext() { return (this._ctx ??= make2dContext(this)); },
  };
}

function makeStream() {
  const track = { kind: 'video', stopped: false, stop() { this.stopped = true; } };
  return { getTracks: () => [track] };
}

/** The calls a canvas's 2D context received, in order. */
const ctxCalls = canvas => canvas.getContext('2d')._calls;

// ── Worker pool that answers like gif.js's own encoder worker ────────────────
let workers;
class FakeWorker {
  constructor() {
    this.terminated = false;
    this.onmessage = null;
    workers.push(this);
  }
  postMessage(task) {
    // Answer out of band, as a real worker does — replying synchronously would
    // recurse through renderNextFrame for every queued frame.
    setTimeout(() => {
      if (this.terminated) return;
      this.onmessage?.({ data: {
        index: task.index, data: [new Uint8Array([0])], pageSize: 1, cursor: 1,
        globalPalette: false,
      } });
    }, 0);
  }
  terminate() { this.terminated = true; }
}
const liveWorkers = () => workers.filter(w => !w.terminated).length;

// ── MediaRecorder that follows the W3C stop() algorithm ──────────────────────
let mediaRecorders;
class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  constructor(stream, opts) {
    this.stream = stream; this.opts = opts; this.state = 'inactive';
    this.ondataavailable = null; this.onstop = null; this.onerror = null;
    mediaRecorders.push(this);
  }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    // stop() queues a task that fires dataavailable with the buffered
    // remainder, and then stop.
    queueMicrotask(() => {
      this.ondataavailable?.({ data: { size: 4, type: 'video/webm' } });
      this.onstop?.();
    });
  }
  /** The UA reporting an encoder failure. */
  fail(name = 'UnknownError') { this.onerror?.({ error: { name } }); }
}

// ── Frame clock the tests step by hand ───────────────────────────────────────
let rafQueue;
const pumpRaf = (n = 1) => {
  for (let i = 0; i < n; i++) {
    const due = rafQueue;
    rafQueue = [];
    due.forEach(fn => fn(performance.now()));
  }
};

globalThis.document = { createElement: t => (t === 'canvas' ? makeCanvas() : {}) };
globalThis.Blob = class { constructor(parts) { this.parts = parts; this.size = 128; } };
globalThis.URL = { createObjectURL: () => 'blob:recorder-test', revokeObjectURL() {} };
globalThis.Worker = FakeWorker;
globalThis.MediaRecorder = FakeMediaRecorder;
globalThis.requestAnimationFrame = fn => { rafQueue.push(fn); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};

let GifRecorder, WebmRecorder;
before(async () => {
  ({ GifRecorder, WebmRecorder } = await import('../src/recorder.js'));
});

beforeEach(() => { workers = []; mediaRecorders = []; rafQueue = []; });

/** A GIF recorder over a canvas of the given size, with every callback logged. */
function makeGif(canvasW = 1920, canvasH = 1080) {
  const canvas = makeCanvas(canvasW, canvasH);
  const rec = new GifRecorder({ domElement: canvas });
  const events = [];
  rec.cb.onStart  = ()  => events.push(['start']);
  rec.cb.onNotice = m   => events.push(['notice', m]);
  rec.cb.onDone   = (blob, meta) => events.push(['done', blob, meta]);
  rec.cb.onError  = m   => events.push(['error', m]);
  rec.cb.onAbort  = ()  => events.push(['abort']);
  const phases = () => events.map(e => e[0]);
  // The scratch canvas belongs to the run, so a completed run is entitled to
  // drop it — the tests hold their own handle from the moment it exists.
  const start = opts => { rec.start(opts); return rec._scratch; };
  return { rec, canvas, events, phases, start };
}

/** Resolve once the run has produced its file (or given up). */
const settled = (events, ms = 2000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const poll = () => {
    if (events.some(e => e[0] === 'done' || e[0] === 'error' || e[0] === 'abort')) return resolve();
    if (Date.now() - t0 > ms) return reject(new Error('run never settled: ' + JSON.stringify(events)));
    setTimeout(poll, 5);
  };
  poll();
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// A three-frame run: 30 fps quantises to a 40 ms period, so 120 ms of capture
// is three ticks and the whole test takes a fifth of a second.
const SHORT_RUN = { duration: 120, fps: 30, width: 160, height: 90 };

describe('a finished GIF gives the encoder back', () => {

  test('the frames, the workers and the scratch canvas are released', async () => {
    const g = makeGif();
    g.start(SHORT_RUN);
    await settled(g.events);

    assert.equal(g.phases().at(-1), 'done', 'precondition: the run completed normally');
    // NB: `=== null` inside assert.ok, never assert.equal(_gif, null). Under
    // node:assert/strict a failing equal() renders BOTH sides with
    // util.inspect(depth: 1000, maxArrayLength: Infinity) and then runs a Myers
    // diff over the result — and _gif, when this assertion is right, is the
    // encoder still holding every frame's RGBA. Printing it allocated 7.3 GB
    // and took the whole VM down with the OOM killer on 13.08. The test kills
    // the machine only when it passes judgement, which is the worst way to lose.
    assert.ok(g.rec._gif === null,
      "the finished encoder still held every frame's RGBA — 500 MB at the panel default");
    assert.equal(liveWorkers(), 0,
      'gif.js leaves its idle workers running: two threads per completed take, ' +
      'and the next start() drops the only reference that could terminate them');
    assert.ok(g.rec._scratch === null, 'the downscale canvas is per-run too');
  });

  test('control — the file and its meta arrive intact', async () => {
    // An over-eager release (before onDone, or by aborting the encoder) would
    // empty the pool too — and hand the user nothing.
    const g = makeGif();
    g.start(SHORT_RUN);
    await settled(g.events);

    const [, blob, meta] = g.events.find(e => e[0] === 'done');
    assert.ok(blob && blob.size > 0, 'a real Blob still reaches the UI');
    assert.equal(meta.frames, 3);
    assert.equal(meta.width, 160);
    assert.equal(meta.height, 90);
    assert.equal(meta.truncated, false);
    assert.equal(g.rec.recording, false);
    assert.equal(g.rec.encoding, false);
  });

  test('control — a cancelled run releases the same things and still says so', async () => {
    const g = makeGif();
    g.start(SHORT_RUN);
    await sleep(50);              // one frame captured
    g.rec.abort();

    assert.deepEqual(g.phases(), ['start', 'abort']);
    assert.ok(g.rec._gif === null);
    assert.equal(liveWorkers(), 0);
  });
});

describe('every captured frame starts from a blank canvas', () => {

  test('GIF: the scratch canvas is cleared before the frame is drawn onto it', async () => {
    const g = makeGif();
    const scratch = g.start(SHORT_RUN);
    await settled(g.events);

    const calls = ctxCalls(scratch);
    assert.equal(calls.filter(c => c[0] === 'drawImage').length, 3,
      'precondition: three frames were composited');

    // Each frame draw must be preceded by a clear of the whole destination:
    // with TRANSPARENT BG the source has alpha 0 in the background, and
    // source-over leaves whatever was underneath it.
    calls.forEach((call, i) => {
      if (call[0] !== 'drawImage') return;
      const prev = calls[i - 1];
      assert.ok(prev && prev[0] === 'clearRect',
        `frame at call ${i} was composited onto the previous frame instead of replacing it`);
      assert.deepEqual(prev.slice(1), [0, 0, 160, 90], 'the whole destination has to go');
    });
  });

  test('control — the watermark still lands on top of the frame, not under it', async () => {
    // Clearing AFTER the draw, or between the frame and its overlay, would
    // erase exactly what the user is meant to see.
    const g = makeGif();
    const scratch = g.start(SHORT_RUN);
    await settled(g.events);

    const names = ctxCalls(scratch).map(c => c[0]);
    const firstDraw = names.indexOf('drawImage');
    const firstText = names.indexOf('fillText');
    assert.ok(firstDraw >= 0 && firstText > firstDraw,
      'the watermark is painted after the frame copy so it overlays the scene');
    assert.ok(names.slice(firstDraw, firstText).every(n => n !== 'clearRect'),
      'nothing may be cleared between the frame and its watermark');
  });

  test('WebM: the composite canvas is cleared before each frame too', () => {
    const rec = new WebmRecorder({ domElement: makeCanvas(1920, 1080) });
    rec.start({ duration: 1000, fps: 30, width: 160, height: 90 });
    const comp = rec._compCanvas;
    pumpRaf(3);
    rec.abort();

    const calls = ctxCalls(comp);
    assert.ok(calls.filter(c => c[0] === 'drawImage').length >= 2,
      'precondition: the composite loop ran');
    calls.forEach((call, i) => {
      if (call[0] !== 'drawImage') return;
      assert.ok(calls[i - 1] && calls[i - 1][0] === 'clearRect',
        'a transparent capture accumulates every earlier frame otherwise');
    });
  });
});

describe('the GIF crop follows the canvas it is cropping', () => {

  test('a window resize mid-capture does not leave the rect behind', async () => {
    const g = makeGif(1920, 1080);
    const scratch = g.start({ duration: 200, fps: 30, width: 720, height: 1280 }); // portrait
    await sleep(50);

    // main.js binds the window resize event to render.onResize(), which calls
    // setPixelRatio + setSize: the canvas is a different size mid-take.
    g.canvas.width = 1200; g.canvas.height = 800;
    await settled(g.events);

    const [, , sx, sy, sw, sh] = ctxCalls(scratch).filter(c => c[0] === 'drawImage').at(-1);
    assert.ok(sx + sw <= 1200 + 1e-9 && sy + sh <= 800 + 1e-9,
      `the source rect ${sx}+${sw} × ${sy}+${sh} leaves a 1200×800 canvas: drawImage ` +
      'clips it, and clips the destination in the same proportion, so part of the ' +
      'scratch canvas keeps the last pre-resize frame');
    // Cover-crop of a 1200×800 canvas into 720×1280: the destination is the
    // taller shape, so the full height is kept and the sides are cropped.
    assert.equal(Math.round(sw), 450);
    assert.equal(Math.round(sh), 800);
  });

  test('control — with a steady canvas every frame samples the same centred rect', async () => {
    const g = makeGif(1920, 1080);
    const scratch = g.start({ duration: 120, fps: 30, width: 720, height: 1280 });
    await settled(g.events);

    const rects = ctxCalls(scratch)
      .filter(c => c[0] === 'drawImage')
      .map(c => c.slice(2, 6).map(n => Math.round(n)).join(','));
    assert.equal(new Set(rects).size, 1, `the rect must not wander: ${[...new Set(rects)]}`);
    // 1080 tall × (720/1280) = 607.5 wide, centred at x = 656.25.
    assert.equal(rects[0], '656,0,608,1080');
  });
});

describe('a capture that fails tells the user what failed', () => {

  test('the diagnostic is not overwritten by "Recording cancelled"', async () => {
    const g = makeGif();
    const scratch = g.start(SHORT_RUN);
    // The scratch context throws the way a lost WebGL context does.
    scratch._throwOnDraw = 'CanvasRenderingContext2D: source is broken';
    await settled(g.events);

    assert.deepEqual(g.phases(), ['start', 'error'],
      'onError and onAbort write the same two lines, and both fire inside one ' +
      'task — the red "⚠ Capture error: …" never survived to a repaint');
    assert.match(g.events.at(-1)[1], /^Capture error: /);
    // The run is still torn down; the UI's error handler resets the panel.
    assert.equal(g.rec.recording, false);
    assert.ok(g.rec._gif === null);
    assert.equal(liveWorkers(), 0);
  });

  test('control — a cancellation the user asked for still reports itself', async () => {
    const g = makeGif();
    g.start(SHORT_RUN);
    await sleep(50);
    g.rec.abort();
    assert.deepEqual(g.phases(), ['start', 'abort'],
      'only the abort that follows a reported failure may stay silent');

    // …and the silence lasts exactly one abort: the next run reports its own.
    const h = makeGif();
    const scratch = h.start(SHORT_RUN);
    scratch._throwOnDraw = 'broken';
    await settled(h.events);
    assert.deepEqual(h.phases(), ['start', 'error']);
    h.rec.abort();
    assert.deepEqual(h.phases(), ['start', 'error', 'abort']);
  });
});

describe('WebmRecorder.abort() bails out without producing a file', () => {

  const makeWebm = () => {
    const rec = new WebmRecorder({ domElement: makeCanvas(1920, 1080) });
    const events = [];
    rec.cb.onStart = ()  => events.push(['start']);
    rec.cb.onDone  = (blob, meta) => events.push(['done', blob, meta]);
    rec.cb.onError = m   => events.push(['error', m]);
    rec.cb.onAbort = ()  => events.push(['abort']);
    return { rec, events, phases: () => events.map(e => e[0]) };
  };
  const WEBM_RUN = { duration: 1000, fps: 30, width: 160, height: 90 };

  test('no file follows an abort', async () => {
    const w = makeWebm();
    w.rec.start(WEBM_RUN);
    pumpRaf(1);
    w.rec.abort();
    await sleep(10);

    assert.deepEqual(w.phases(), ['start', 'abort'],
      'the module header promises "bail out without producing a file"; the ' +
      'queued stop task built a Blob from the emptied chunk list, and the UI ' +
      'downloaded it as a headerless .webm reported in green');
    assert.equal(w.rec.recording, false);
  });

  test('an encoder failure reports the failure, not a cancellation', async () => {
    const w = makeWebm();
    w.rec.start(WEBM_RUN);
    mediaRecorders.at(-1).fail('UnknownError');
    await sleep(10);

    assert.deepEqual(w.phases(), ['start', 'error']);
    assert.match(w.events.at(-1)[1], /MediaRecorder error/);
  });

  test('control — stop() still delivers the file it recorded', async () => {
    const w = makeWebm();
    w.rec.start(WEBM_RUN);
    pumpRaf(2);
    w.rec.stop();
    await sleep(10);

    assert.deepEqual(w.phases(), ['start', 'done']);
    const [, blob, meta] = w.events.at(-1);
    assert.ok(blob.size > 0);
    assert.equal(meta.fps, 30);
  });

  test('control — the capture stream is given back either way', async () => {
    const a = makeWebm();
    a.rec.start(WEBM_RUN);
    const trackA = a.rec._stream.getTracks()[0];
    a.rec.abort();
    await sleep(10);
    assert.equal(trackA.stopped, true);

    const b = makeWebm();
    b.rec.start(WEBM_RUN);
    const trackB = b.rec._stream.getTracks()[0];
    b.rec.stop();
    await sleep(10);
    assert.equal(trackB.stopped, true);
  });
});
