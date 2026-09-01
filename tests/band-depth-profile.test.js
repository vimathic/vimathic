// tests/band-depth-profile.test.js
//
// BAND_DEPTH_PROFILE: bandDepth is one slider, but the 24 bands do not deserve
// equal displacement. Bass arrives as whole-body motion, treble as fine detail
// on a surface that is otherwise still — so the weight falls with frequency.
//
// Run:
//   node --test tests/band-depth-profile.test.js
//
// ── Why a file of its own ────────────────────────────────────────────────────
// The profile is one number (an exponent) spread over four places: the law, the
// engine that applies it, and the two consumers that have to read the WEIGHTED
// array rather than the raw one. The law is the easy part and the least likely
// to break. What breaks is a consumer quietly going back to `bands`: the picture
// stays plausible, every other test stays green, and the only symptom is that
// the CPU and GPU paths now draw two different bodies under one slider.
//
// So the shape of this file is: pin the law against its own documented numbers
// (not against a re-derivation, which would just be the code twice), then pin
// each consumer separately, then one end-to-end run through a real engine that
// would fail if any link were wrong.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  AudioEngine, BARK_EDGES, BAND_COUNT, BAND_DEPTH_PROFILE,
} from '../src/audio.js';

// ── The law ─────────────────────────────────────────────────────────────────

describe('the profile is a redistribution, not an attenuation', () => {
  test('its mean over the 24 bands is exactly 1', () => {
    // This is what lets bandDepth keep meaning what it meant: the total
    // movement the layer can produce is unchanged, only its balance moves.
    // Normalising by the MAXIMUM instead would put every band at or below its
    // old weight, and the change would read as "the layer got weaker".
    const mean = BAND_DEPTH_PROFILE.reduce((a, c) => a + c, 0) / BAND_COUNT;
    assert.ok(Math.abs(mean - 1) < 1e-12,
      `the profile averages ${mean.toFixed(6)}, so switching it on changes how strong ` +
      'the layer is as well as how it is distributed');
  });

  test('it falls monotonically from band 0 to band 23', () => {
    for (let i = 1; i < BAND_COUNT; i++) {
      assert.ok(BAND_DEPTH_PROFILE[i] < BAND_DEPTH_PROFILE[i - 1],
        `band ${i} is weighted ${BAND_DEPTH_PROFILE[i].toFixed(3)}, not below band ` +
        `${i - 1}'s ${BAND_DEPTH_PROFILE[i - 1].toFixed(3)} — the curve is not monotone`);
    }
  });

  test('the documented table is the table the code builds', () => {
    // Deliberately the numbers written in the comment on BAND_DEPTH_PROFILE,
    // typed out again here rather than recomputed from BARK_EDGES and the
    // exponent. Recomputing would be the implementation checking itself: change
    // the exponent and both sides move together, silently, while the prose that
    // tells a reader what the feature does goes stale. This way the comment is
    // load-bearing.
    const documented = { 0: 1.94, 4: 1.22, 8: 1.04, 12: 0.92, 16: 0.82, 20: 0.71, 23: 0.62 };
    for (const [k, want] of Object.entries(documented)) {
      const got = BAND_DEPTH_PROFILE[Number(k)];
      assert.ok(Math.abs(got - want) < 0.005,
        `band ${k} weighs ${got.toFixed(3)}, but BAND_DEPTH_PROFILE's own table says ` +
        `${want} — the law and the comment describing it have drifted apart`);
    }
    const ratio = BAND_DEPTH_PROFILE[0] / BAND_DEPTH_PROFILE[BAND_COUNT - 1];
    assert.ok(Math.abs(ratio - 3.14) < 0.05,
      `bass to treble is ${ratio.toFixed(2)}x, not the documented 3.1x`);
  });

  test('every weight is finite and positive', () => {
    // A band weighted 0 is a dead ring on the body, and one weighted NaN takes
    // the vertex with it — both are silent in a picture nobody is diffing.
    for (let i = 0; i < BAND_COUNT; i++) {
      assert.ok(Number.isFinite(BAND_DEPTH_PROFILE[i]) && BAND_DEPTH_PROFILE[i] > 0,
        `band ${i} weighs ${BAND_DEPTH_PROFILE[i]}`);
    }
    assert.equal(BAND_DEPTH_PROFILE.length, BARK_EDGES.length - 1);
  });
});

// ── The engine applies it, on both paths that write a band ──────────────────

const BAND_BINS = 2048, NYQ = 22050, BAND_FPB = NYQ / BAND_BINS, MAIN_BINS = 512;

let nowMs, realPerf;
function stand() {
  nowMs = 1_000_000;
  realPerf = globalThis.performance;
  globalThis.performance = { now: () => nowMs };
  const e = new AudioEngine();
  e.cb.onEQ = () => {};
  e._updateSeek = () => {};
  e._detectBeat = () => {};
  e._detectMultiBandBeats = () => {};
  e.analyser = {
    minDecibels: -85, maxDecibels: -10,
    getByteFrequencyData(a) { a.fill(0); },
  };
  e.fftData = new Uint8Array(MAIN_BINS);
  e._fpb = NYQ / MAIN_BINS;
  e._bandFft = new Uint8Array(BAND_BINS);
  e._bandFpb = BAND_FPB;
  e._bandAnalyser = {
    _bytes: new Uint8Array(BAND_BINS),
    getByteFrequencyData(a) { a.set(this._bytes); },
  };
  e.isPlaying = true;
  e.bandDepth = 1;
  return e;
}
const restore = () => { globalThis.performance = realPerf; };

/** A byte spectrum that is `level` inside [lo, hi) Hz. Bin CENTRES decide. */
function tone(loHz, hiHz, level = 255, floor = 4) {
  const b = new Uint8Array(BAND_BINS).fill(floor);
  for (let i = 0; i < BAND_BINS; i++) {
    const c = (i + 0.5) * BAND_FPB;
    if (c >= loHz && c < hiHz) b[i] = level;
  }
  return b;
}

function run(e, bytes, frames = 40) {
  for (let i = 0; i < frames; i++) {
    e._bandAnalyser._bytes = bytes;
    nowMs += 1000 / 60;
    e.update(nowMs / 1000);
  }
}

describe('the engine keeps the measurement and the movement apart', () => {
  test('bandsShaped is bands times the profile, band for band', () => {
    const e = stand();
    try {
      run(e, tone(BARK_EDGES[3], BARK_EDGES[4]));
      let lit = 0;
      for (let i = 0; i < BAND_COUNT; i++) {
        if (e.bands[i] > 1e-4) lit++;
        const want = e.bands[i] * BAND_DEPTH_PROFILE[i];
        assert.ok(Math.abs(e.bandsShaped[i] - want) < 1e-6,
          `band ${i}: shaped ${e.bandsShaped[i].toFixed(6)} against ` +
          `${want.toFixed(6)} — the weighting is not what bandsShaped carries`);
      }
      assert.ok(lit > 0, 'nothing lit at all, so agreeing about zero proves nothing');
    } finally { restore(); }
  });

  test('the decay path writes it too — a stopped track does not freeze the body', () => {
    // Two writers touch `bands`, and only one of them is the obvious one. If
    // _decayBands forgets the shaped copy, the music stops and the shape keeps
    // holding the last spectrum it saw: no exception, no test failure anywhere
    // else, just a body that will not sit down.
    const e = stand();
    try {
      run(e, tone(BARK_EDGES[3], BARK_EDGES[4]));
      const heldShaped = e.bandsShaped[3];
      assert.ok(heldShaped > 0.05, 'the band never rose, so its decay proves nothing');
      e.isPlaying = false;
      for (let i = 0; i < 60; i++) { nowMs += 1000 / 60; e.update(nowMs / 1000); }
      assert.ok(e.bands[3] < heldShaped * 0.2,
        'precondition: the raw band did not decay, so this measures nothing');
      assert.ok(e.bandsShaped[3] < heldShaped * 0.2,
        `bandsShaped[3] is still ${e.bandsShaped[3].toFixed(4)} a second after the track ` +
        'stopped, while bands[3] fell — the shaped copy is stale');
    } finally { restore(); }
  });

  test('equally loud low and high tones move the body by different amounts', () => {
    // The whole point of the feature, end to end and in the engine's own units.
    // The raw levels are the CONTROL: they have to come out close, or the
    // difference below would just be the tilt or the reference, not the profile.
    const lo = stand();
    let loRaw, loShaped;
    try {
      run(lo, tone(BARK_EDGES[1], BARK_EDGES[2]));
      loRaw = lo.bands[1]; loShaped = lo.bandsShaped[1];
    } finally { restore(); }

    const hi = stand();
    let hiRaw, hiShaped;
    try {
      run(hi, tone(BARK_EDGES[21], BARK_EDGES[22]));
      hiRaw = hi.bands[21]; hiShaped = hi.bandsShaped[21];
    } finally { restore(); }

    assert.ok(loRaw > 0.3 && hiRaw > 0.3,
      `one of the tones did not light its band (${loRaw.toFixed(2)}, ${hiRaw.toFixed(2)})`);
    assert.ok(Math.abs(loRaw - hiRaw) < 0.15,
      `the CONTROL failed: band 1 reads ${loRaw.toFixed(2)} and band 21 reads ` +
      `${hiRaw.toFixed(2)} before weighting, so any difference after it is not the profile`);
    const gain = (loShaped / loRaw) / (hiShaped / hiRaw);
    assert.ok(gain > 1.8,
      `the low tone moves the body only ${gain.toFixed(2)}x further than the high one — ` +
      'the profile is not reaching the geometry');
  });
});

// ── Both consumers read the WEIGHTED array ──────────────────────────────────
// These are the two that matter. The law above can be perfect and the feature
// still absent, because nothing in the engine forces anyone to read bandsShaped.

describe('the consumers read bandsShaped, not bands', () => {
  test('RenderEngine.updateUniforms uploads the weighted array', async () => {
    const { RenderEngine } = await import('../src/render.js');
    // A stand rather than a real engine: updateUniforms touches exactly four
    // things on `this`, and a WebGL context is not one of them.
    const U = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 },
      uTreble: { value: 0 }, uBeat: { value: 0 }, uAmp: { value: 0 },
      uWI: { value: 0 }, uMathMode: { value: 1 },
      uBands: { value: new Float32Array(BAND_COUNT) },
      uBandDepth: { value: 0 }, uBandMode: { value: 1 },
    };
    const self = {
      U, transitions: { tick() {} }, filmGrainVigPass: { enabled: false },
    };
    // Two arrays that cannot be confused for one another: raw counts up, shaped
    // counts down. Whichever one arrives names itself.
    const audio = {
      bass: 0, mid: 0, treble: 0, beatInt: 0, amp: 0.7, waveInt: 1,
      bassSens: 1, trebleSens: 1, bandDepth: 0.3, bandCharacter: true,
      bands:       Float32Array.from({ length: BAND_COUNT }, (_, i) => i / 100),
      bandsShaped: Float32Array.from({ length: BAND_COUNT }, (_, i) => (BAND_COUNT - i) / 100),
    };
    RenderEngine.prototype.updateUniforms.call(self, 1.0, audio);
    assert.ok(Math.abs(U.uBands.value[0] - audio.bandsShaped[0]) < 1e-7,
      `uBands[0] is ${U.uBands.value[0]}, which is AudioEngine.bands — the GPU is being ` +
      'handed the raw levels, so the depth profile never reaches the shader');
    assert.ok(Math.abs(U.uBands.value[23] - audio.bandsShaped[23]) < 1e-7,
      'uBands[23] did not come from bandsShaped either');
  });

  test('MathVisualizer._bandLayer hands the CPU path the weighted array', async () => {
    globalThis.document ??= {
      getElementById: () => ({ value: '', style: {}, textContent: '',
                               classList: { add() {}, remove() {}, toggle() {} } }),
      querySelectorAll: () => [],
    };
    globalThis.Worker ??= class {
      constructor() { this.onmessage = null; this.onerror = null; this.onmessageerror = null; }
      postMessage() {} terminate() {}
    };
    const { MathVisualizer } = await import('../src/math-visualizer.js');
    const THREE = await import('three');

    const geometry = new THREE.PlaneGeometry(7, 7, 8, 8);
    geometry.rotateX(-Math.PI / 2);
    const render = {
      isMobile: false,
      U: { uMathMode: { value: 0 }, uMorphProgress: { value: 1 }, uBandR: { value: 3.5 } },
      gpuMesh: { geometry }, gpuPtsProxy: null, cb: {},
    };
    const audio = {
      bass: 0.4, mid: 0.3, treble: 0.2, beatInt: 0, amp: 0.7, waveInt: 1,
      bandDepth: 0.5, bandCharacter: false,
      bands:       Float32Array.from({ length: BAND_COUNT }, (_, i) => i / 100),
      bandsShaped: Float32Array.from({ length: BAND_COUNT }, (_, i) => (BAND_COUNT - i) / 100),
    };
    const viz = new MathVisualizer(render, audio);
    viz._workerReady = true;
    viz.onShapeChange();

    const layer = viz._bandLayer();
    assert.ok(layer, 'precondition: the layer is off in this stand, so it hands back nothing');
    assert.ok(layer.bands === audio.bandsShaped,
      'the CPU displacement path was handed AudioEngine.bands — it and the shader now ' +
      'weight the same slider differently, and the two halves of one body disagree');
  });
});
