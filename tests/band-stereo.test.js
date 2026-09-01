// tests/band-stereo.test.js
//
// Left against right. An AnalyserNode analyses a mono down-mix of its input, so
// until the side tap every number this app computed — every band, the beat, the
// BPM — was the sum of both channels and knew nothing about where a sound sits
// between the speakers.
//
// Run:
//   node --test tests/band-stereo.test.js
//
// ── The failure this file is mostly about ────────────────────────────────────
// Not "the pan is a bit off". It is that a MONO track reads as hard left.
//
// The design leans on one piece of spec behaviour that cannot be checked from
// Node: a ChannelSplitterNode has channelCountMode "explicit", so a one-channel
// input is up-mixed to two identical channels rather than leaving output 1
// silent. If that is wrong — a browser that does not, a graph that drops the
// connection — then every band's side tap reads zero, every band reports full
// left, and the whole catalogue leans over with no error anywhere. So the
// engine refuses that reading outright, and the refusal is what most of this
// file is written about: a claim that rests on an assumption gets a guard for
// the assumption being false, not only for it being true.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AudioEngine, BARK_EDGES, BAND_COUNT, BAND_PAN_TILT } from '../src/audio.js';
import { applyHeightField, bandRingValue, FIELD_EXTENT } from '../src/math-collections.js';
import { BAND_GLSL } from '../src/shaders.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHADER_SRC = readFileSync(path.join(ROOT, 'src/shaders.js'), 'utf8');

const BAND_BINS = 2048, NYQ = 22050, BAND_FPB = NYQ / BAND_BINS, MAIN_BINS = 512;

let nowMs, realPerf;
beforeEach(() => {
  nowMs = 1_000_000;
  realPerf = globalThis.performance;
  globalThis.performance = { now: () => nowMs };
});
afterEach(() => { globalThis.performance = realPerf; });

/**
 * The engine with BOTH taps standing. `side` is the byte spectrum the right
 * channel reads; the mono tap reads `mono`. A real graph would derive one from
 * the other, and driving them independently is the point — it is the only way
 * to say "this band is 8 dB louder on the right" without a browser.
 */
function makeEngine({ withSide = true } = {}) {
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
  if (withSide) {
    e._bandSideFft = new Uint8Array(BAND_BINS);
    e._bandSide = {
      _bytes: new Uint8Array(BAND_BINS),
      getByteFrequencyData(a) { a.set(this._bytes); },
    };
  }
  e.isPlaying = true;
  e.bandDepth = 1;
  return e;
}

/** A byte spectrum that is `level` inside [lo, hi) Hz, by bin CENTRE. */
function tone(loHz, hiHz, level = 200, floor = 4) {
  const b = new Uint8Array(BAND_BINS).fill(floor);
  for (let i = 0; i < BAND_BINS; i++) {
    const c = (i + 0.5) * BAND_FPB;
    if (c >= loHz && c < hiHz) b[i] = level;
  }
  return b;
}

function run(e, mono, side, frames = 60) {
  for (let i = 0; i < frames; i++) {
    e._bandAnalyser._bytes = mono;
    if (e._bandSide) e._bandSide._bytes = side ?? mono;
    nowMs += 1000 / 60;
    e.update(nowMs / 1000);
  }
}

const BAND = 6;
const LO = BARK_EDGES[BAND], HI = BARK_EDGES[BAND + 1];

describe('the side tap says which way a band leans', () => {
  test('the same spectrum on both sides is centred, to zero', () => {
    // The mono case, and the one that decides whether this feature is safe to
    // ship: R equal to the down-mix is a centred band, and a centred band must
    // multiply the displacement by exactly 1.
    const e = makeEngine();
    const t = tone(LO, HI);
    run(e, t, t);
    assert.ok(e.bands[BAND] > 0.3, 'the band never rose, so its pan proves nothing');
    for (let i = 0; i < BAND_COUNT; i++) {
      assert.ok(Math.abs(e.bandPan[i]) < 1e-3,
        `band ${i} reads pan ${e.bandPan[i].toFixed(4)} on identical channels`);
    }
  });

  test('louder on the right leans right, louder on the left leans left', () => {
    // R above the down-mix is R above L, whatever the dB mapping does to the
    // magnitudes — that is the whole reason one side tap is enough.
    const right = makeEngine();
    run(right, tone(LO, HI, 200), tone(LO, HI, 240));
    assert.ok(right.bandPan[BAND] > 0.2,
      `a band 40 bytes louder on the right reads ${right.bandPan[BAND].toFixed(3)}`);

    const left = makeEngine();
    run(left, tone(LO, HI, 200), tone(LO, HI, 160));
    assert.ok(left.bandPan[BAND] < -0.2,
      `a band 40 bytes quieter on the right reads ${left.bandPan[BAND].toFixed(3)}`);

    // …and the two are mirror images, because the measure is a difference.
    assert.ok(Math.abs(right.bandPan[BAND] + left.bandPan[BAND]) < 0.05,
      'the same imbalance in the two directions is not symmetric');
  });

  test('it clamps rather than running away', () => {
    const e = makeEngine();
    run(e, tone(LO, HI, 130), tone(LO, HI, 255));
    for (let i = 0; i < BAND_COUNT; i++) {
      assert.ok(e.bandPan[i] >= -1 && e.bandPan[i] <= 1,
        `band ${i} left the range at ${e.bandPan[i]}`);
    }
  });

  test('a band below the noise floor has no direction, however lopsided its dither', () => {
    // The first version of this test dropped one loud bin into an otherwise
    // dead band and called that a lopsided silence — but a band is dozens of
    // bins wide and the mean washed it out, so removing the gate entirely left
    // the test green. Measured, and then rewritten.
    //
    // What actually exercises the gate is a CONSISTENT imbalance across the
    // whole band, at a level nothing musical reaches: 8 bytes against 30 is
    // −80 dBFS in this analyser's window, and 22 bytes of difference is most of
    // the way to hard-panned. Without the gate that band reports it.
    const e = makeEngine();
    const dead = 20;
    const lo = Math.ceil(BARK_EDGES[dead] / BAND_FPB);
    const hi = Math.min(BAND_BINS, Math.ceil(BARK_EDGES[dead + 1] / BAND_FPB));
    const mono = tone(LO, HI, 200, 0);
    const side = tone(LO, HI, 200, 0);
    for (let b = lo; b < hi; b++) { mono[b] = 8; side[b] = 30; }
    run(e, mono, side);
    assert.ok(e.bands[dead] < 0.05,
      `the "silent" band reads level ${e.bands[dead].toFixed(3)} — it is not silent, so this ` +
      'test is not about a silent band');
    assert.ok(Math.abs(e.bandPan[dead]) < 1e-3,
      `a band at −80 dBFS reads pan ${e.bandPan[dead].toFixed(4)} — the difference of two ` +
      'dithers is being reported as a stereo field');
  });
});

describe('the refusal: a missing second channel must not read as hard left', () => {
  test('side silent while the mix is not gives centre, not left', () => {
    // The assumption this feature rests on, negated. If the splitter did not
    // up-mix a mono source, this is exactly what the engine would see — and
    // "everything is on the left" is a picture a viewer would notice and would
    // have no way to explain.
    const e = makeEngine();
    run(e, tone(LO, HI, 200), new Uint8Array(BAND_BINS));
    for (let i = 0; i < BAND_COUNT; i++) {
      assert.ok(Math.abs(e.bandPan[i]) < 1e-3,
        `band ${i} reads ${e.bandPan[i].toFixed(3)} with the side tap dead — the body would ` +
        'lean over on every mono track');
    }
  });

  test('CONTROL — the refusal is about SILENCE, not about being quiet', () => {
    // A side tap that is merely quiet is a real hard-left signal and must still
    // read as one, or the guard above would have deleted the feature.
    const e = makeEngine();
    const side = new Uint8Array(BAND_BINS).fill(0);
    for (let i = 0; i < BAND_BINS; i++) if ((i + 0.5) * BAND_FPB >= LO && (i + 0.5) * BAND_FPB < HI) side[i] = 120;
    run(e, tone(LO, HI, 200), side);
    assert.ok(e.bandPan[BAND] < -0.5,
      `a genuinely left-panned band reads ${e.bandPan[BAND].toFixed(3)} — the refusal above is ` +
      'swallowing real signal');
  });

  test('an engine with no side tap at all keeps every band centred', () => {
    // A browser without createChannelSplitter, or the catch in ensureCtx.
    const e = makeEngine({ withSide: false });
    run(e, tone(LO, HI, 200));
    assert.ok(e.bands[BAND] > 0.3, 'the levels stopped working without the side tap');
    for (let i = 0; i < BAND_COUNT; i++) {
      assert.equal(e.bandPan[i], 0, `band ${i} acquired a pan with no side tap`);
    }
  });

  test('the pan settles when the music stops', () => {
    // Left holding its last value, the first band to come back would arrive
    // already leaning, from a track that is no longer playing.
    const e = makeEngine();
    run(e, tone(LO, HI, 200), tone(LO, HI, 245));
    const held = e.bandPan[BAND];
    assert.ok(held > 0.2, 'the pan never rose, so its decay proves nothing');
    e.isPlaying = false;
    for (let i = 0; i < 60; i++) { nowMs += 1000 / 60; e.update(nowMs / 1000); }
    assert.ok(Math.abs(e.bandPan[BAND]) < Math.abs(held) * 0.2,
      `pan is still ${e.bandPan[BAND].toFixed(3)} a second after playback stopped`);
  });
});

// ── Where it reaches the body ───────────────────────────────────────────────

const GRID = 21;
function plate(seg = 24) {
  const g = new THREE.PlaneGeometry(7, 7, seg, seg);
  g.rotateX(-Math.PI / 2);
  return g;
}
function pans(k, v) { const p = new Float32Array(BAND_COUNT); p.fill(v); return p; }
function bandsOnly(k, v = 1) { const b = new Float32Array(BAND_COUNT); b[k] = v; return b; }

describe('the tilt reaches the geometry, and is inert when centred', () => {
  test('a right-panned band moves the right of the body further', () => {
    const layer = {
      bands: new Float32Array(BAND_COUNT).fill(1), depth: 1, radius: FIELD_EXTENT,
      pan: pans(0, 1), panTilt: BAND_PAN_TILT,
    };
    const right = bandRingValue(layer, FIELD_EXTENT, 0, undefined);
    const left  = bandRingValue(layer, -FIELD_EXTENT, 0, undefined);
    assert.ok(right > left, `right ${right.toFixed(3)} is not above left ${left.toFixed(3)}`);
    // The documented shape: 1 + tilt on one side, 1 - tilt on the other.
    assert.ok(Math.abs(right - (1 + BAND_PAN_TILT)) < 1e-6, `right rim reads ${right}`);
    assert.ok(Math.abs(left - (1 - BAND_PAN_TILT)) < 1e-6, `left rim reads ${left}`);
    // …and the axis, where "which side" has no meaning, is untouched.
    assert.ok(Math.abs(bandRingValue(layer, 0, 0, undefined) - 1) < 1e-6,
      'the body\'s own axis was tilted');
  });

  test('pan zero is bit-identical to no pan at all', () => {
    // The promise every mono track relies on, and the reason the factor is
    // written as 1 + … rather than as an addition.
    const base = { bands: bandsOnly(3, 0.7), depth: 0.5, radius: FIELD_EXTENT };
    const withPan = { ...base, pan: new Float32Array(BAND_COUNT), panTilt: BAND_PAN_TILT };
    const flat = new Float32Array(GRID * GRID);
    const a = plate(), b = plate();
    applyHeightField(a, flat, null, FIELD_EXTENT, null, Infinity, base);
    applyHeightField(b, flat, null, FIELD_EXTENT, null, Infinity, withPan);
    const pa = a.attributes.position.array, pb = b.attributes.position.array;
    let diff = -1;
    for (let i = 0; i < pa.length; i++) if (!Object.is(pa[i], pb[i])) { diff = i; break; }
    assert.equal(diff, -1, `a centred pan moved word ${diff}: ${pa[diff]} -> ${pb[diff]}`);
  });

  test('CONTROL — a non-zero pan does move it', () => {
    const base = { bands: bandsOnly(3, 0.7), depth: 0.5, radius: FIELD_EXTENT };
    const flat = new Float32Array(GRID * GRID);
    const a = plate(), b = plate();
    applyHeightField(a, flat, null, FIELD_EXTENT, null, Infinity, base);
    applyHeightField(b, flat, null, FIELD_EXTENT, null, Infinity,
                     { ...base, pan: pans(0, 0.8), panTilt: BAND_PAN_TILT });
    assert.notDeepStrictEqual(Array.from(b.attributes.position.array),
                              Array.from(a.attributes.position.array),
      'the two runs agree, so the test above proves nothing');
  });
});

// ── The two languages ───────────────────────────────────────────────────────

describe('CPU and GPU tilt by the same number, in the same shape', () => {
  test('the shader carries BAND_PAN_TILT itself, not a copy of it', () => {
    // shaders.js interpolates the exported constant into the GLSL, so there is
    // one definition — but "interpolates it" is a claim about the source, and
    // this is the assertion that makes it one.
    // Read from BAND_GLSL, the EXPANDED string the program is built from, not
    // from the file — in the source the number is still an interpolation, and a
    // regex over the source would be checking the template rather than the
    // shader. The source is checked separately, below, for exactly that.
    const m = BAND_GLSL.match(
      /return lvl \* \(1\. \+ ([\d.]+) \* pan \* clamp\(position\.x \/ max\(uBandR, 1e-3\), -1\., 1\.\)\);/);
    assert.ok(m, 'bandAtU no longer applies the stereo tilt in the modelled form');
    assert.ok(Math.abs(Number(m[1]) - BAND_PAN_TILT) < 1e-9,
      `the shader tilts by ${m[1]}, audio.js by ${BAND_PAN_TILT}`);
    assert.match(SHADER_SRC, /\$\{BAND_PAN_TILT\.toFixed\(2\)\}/,
      'the shader spells the number out instead of interpolating the constant, so the two can drift');
  });

  test('the pan is interpolated between bands exactly as the level is', () => {
    // A pan that stepped where the level ramps would put a hard colour and
    // motion boundary between two rings that are otherwise continuous.
    assert.match(BAND_GLSL, /float pan = mix\(uBandPan\[i\], uBandPan\[j\], fract\(x\)\);/,
      'the shader stopped interpolating the pan, so it steps where the level ramps');
    assert.match(BAND_GLSL, new RegExp(`uniform float uBandPan\\[${BAND_COUNT}\\];`),
      'uBandPan is not declared — the program would not link');
    // The CPU half, by behaviour rather than by text: half-way between a hard
    // left band and a hard right one is centred.
    const p = new Float32Array(BAND_COUNT);
    p[10] = -1; p[11] = 1;
    const layer = {
      bands: new Float32Array(BAND_COUNT).fill(1), depth: 1, radius: FIELD_EXTENT,
      pan: p, panTilt: BAND_PAN_TILT,
      u: Float32Array.from([10.5 / (BAND_COUNT - 1)]),
    };
    const mid = bandRingValue(layer, FIELD_EXTENT, 0, 0);
    assert.ok(Math.abs(mid - 1) < 1e-6,
      `half-way between hard left and hard right reads ${mid.toFixed(4)}, not centred`);
  });

  test('RenderEngine.updateUniforms uploads the pan array', async () => {
    const { RenderEngine } = await import('../src/render.js');
    const U = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uBeat: { value: 0 }, uAmp: { value: 0 }, uWI: { value: 0 }, uMathMode: { value: 1 },
      uBands: { value: new Float32Array(BAND_COUNT) },
      uBandPan: { value: new Float32Array(BAND_COUNT) },
      uBandDepth: { value: 0 }, uBandMode: { value: 1 },
    };
    const self = { U, transitions: { tick() {} }, filmGrainVigPass: { enabled: false } };
    const audio = {
      bass: 0, mid: 0, treble: 0, beatInt: 0, amp: 0.7, waveInt: 1,
      bassSens: 1, trebleSens: 1, bandDepth: 0.3, bandCharacter: true,
      bands: new Float32Array(BAND_COUNT),
      bandsShaped: new Float32Array(BAND_COUNT),
      bandPan: Float32Array.from({ length: BAND_COUNT }, (_, i) => (i - 12) / 24),
    };
    RenderEngine.prototype.updateUniforms.call(self, 1.0, audio);
    for (const i of [0, 12, 23]) {
      assert.ok(Math.abs(U.uBandPan.value[i] - audio.bandPan[i]) < 1e-7,
        `uBandPan[${i}] is ${U.uBandPan.value[i]}, not the engine's ${audio.bandPan[i]} — the ` +
        'shader would tilt by a stereo field nobody measured');
    }
  });
});
