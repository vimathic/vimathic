// tests/audio-bark-bands.test.js
//
// The 24-band tap: Bark edges, the per-band peak normaliser, and the decay.
//
// Run:
//   node --test tests/audio-bark-bands.test.js
//
// ── What these are for ────────────────────────────────────────────────────────
// The shape spreads the spectrum across its radius, so a band that reads the
// wrong slice of the spectrum does not fail loudly — it just puts a hi-hat in
// the middle of the body and a kick on the rim, which looks like a design
// choice. Every claim here is therefore checked against a spectrum built by
// this file rather than against the analyser's own arithmetic, and every check
// has a control that must come out the other way.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, BARK_EDGES, BAND_COUNT } from '../src/audio.js';

// The real tap: fftSize 4096 -> 2048 bins, 22050 Hz nyquist at a 44.1 kHz rate.
const BAND_BINS = 2048;
const NYQ       = 22050;
const BAND_FPB  = NYQ / BAND_BINS;

// The main analyser is mocked flat — these tests are about the band tap, and a
// silent main analyser keeps the beat detector from firing into them.
const MAIN_BINS = 512;

let nowMs, realPerf;

beforeEach(() => {
  nowMs = 1_000_000;
  realPerf = globalThis.performance;
  globalThis.performance = { now: () => nowMs };
});
afterEach(() => { globalThis.performance = realPerf; });

function makeEngine() {
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
  // The spectrum is only computed while the layer is switched on — see the note
  // in update(). Every test below is about the analysis, so the stand turns it
  // on; 'the tap is idle while the layer is off' pins the other half.
  e.bandDepth = 1;
  return e;
}

/**
 * A byte spectrum that is `level` inside [lo, hi) Hz and `floor` elsewhere.
 *
 * A bin belongs to the tone when its CENTRE frequency does — deliberately not
 * the same arithmetic src/audio.js uses to find its band edges. The first
 * version of this helper mirrored that code's floor/ceil pair, which made the
 * measurement scale with the thing measured: the band edges overlapped by one
 * bin at 23 of 23 boundaries and every test here still passed, because the
 * spectra they built contained the same overlap. An external review found it.
 */
function tone(loHz, hiHz, level = 255, floor = 4) {
  const b = new Uint8Array(BAND_BINS).fill(floor);
  for (let i = 0; i < BAND_BINS; i++) {
    const centreHz = (i + 0.5) * BAND_FPB;
    if (centreHz >= loHz && centreHz < hiHz) b[i] = level;
  }
  return b;
}

/** One bin lit, everything else at the noise floor. */
function singleBin(k, level = 255, floor = 0) {
  const b = new Uint8Array(BAND_BINS).fill(floor);
  b[k] = level;
  return b;
}

/** Run `frames` frames of the given byte spectrum at 60 fps. */
function settle(e, bytes, frames = 40) {
  for (let i = 0; i < frames; i++) {
    e._bandAnalyser._bytes = bytes;
    nowMs += 1000 / 60;
    e.update(nowMs / 1000);
  }
  return e.bands;
}

const argmax = arr => arr.reduce((best, v, i, a) => (v > a[best] ? i : best), 0);

describe('the Bark edges are the scale they claim to be', () => {
  test('24 bands, 25 edges, strictly ascending', () => {
    assert.equal(BAND_COUNT, 24);
    assert.equal(BARK_EDGES.length, 25);
    for (let i = 1; i < BARK_EDGES.length; i++) {
      assert.ok(BARK_EDGES[i] > BARK_EDGES[i - 1],
        `edge ${i} (${BARK_EDGES[i]}) does not exceed edge ${i - 1} (${BARK_EDGES[i - 1]})`);
    }
  });

  test('the bands widen with frequency, which is what makes them critical bands', () => {
    // A Bark band is roughly 100 Hz wide below 500 Hz and about a fifth of its
    // centre frequency above that. The claim being pinned is the SHAPE: every
    // band is at least as wide as the one below it, and the top is far wider
    // than the bottom. A linear or an octave split would both fail this.
    const w = [];
    for (let i = 0; i < BAND_COUNT; i++) w.push(BARK_EDGES[i + 1] - BARK_EDGES[i]);
    for (let i = 1; i < w.length; i++) {
      assert.ok(w[i] >= w[i - 1],
        `band ${i} is ${w[i]} Hz wide, narrower than band ${i - 1} at ${w[i - 1]} Hz`);
    }
    assert.ok(w.at(-1) / w[0] > 20,
      `the top band is only ${(w.at(-1) / w[0]).toFixed(1)}x the bottom one — these are not critical bands`);
  });

  test('every band gets bins to average at the tap resolution', () => {
    // The reason the tap is 4096 and not the beat detector's 1024. Band 0 is
    // the tightest, so it is the one that decides the size.
    for (let i = 0; i < BAND_COUNT; i++) {
      const lo = Math.floor(BARK_EDGES[i] / BAND_FPB);
      const hi = Math.min(BAND_BINS, Math.ceil(BARK_EDGES[i + 1] / BAND_FPB));
      assert.ok(hi - lo >= 4,
        `band ${i} (${BARK_EDGES[i]}–${BARK_EDGES[i + 1]} Hz) has only ${hi - lo} bins`);
    }
  });

  test('no bin belongs to two bands — checked by behaviour, not by arithmetic', () => {
    // The defect an external review found and this file had been blind to: the
    // lower edge was floored while the upper one was ceiled, so each band's last
    // bin was also the next band's first. A tone on a boundary lit two rings.
    //
    // Checked here WITHOUT reproducing the edge formula: one bin is lit at a
    // time and the bands are asked who felt it. Two bands reacting to one bin is
    // an overlap whatever the arithmetic says. The bins around every boundary
    // are the ones that can be shared, so those are the ones walked.
    for (let e = 1; e < BARK_EDGES.length - 1; e++) {
      for (const k of [Math.floor(BARK_EDGES[e] / BAND_FPB) - 1,
                       Math.floor(BARK_EDGES[e] / BAND_FPB),
                       Math.floor(BARK_EDGES[e] / BAND_FPB) + 1]) {
        if (k < 0 || k >= BAND_BINS) continue;
        const en = makeEngine();
        const felt = [];
        en._bandAnalyser._bytes = singleBin(k);
        nowMs += 1000 / 60;
        en.update(nowMs / 1000);
        for (let i = 0; i < BAND_COUNT; i++) if (en.bands[i] > 0) felt.push(i);
        assert.ok(felt.length <= 1,
          `bin ${k} (${Math.round(k * BAND_FPB)} Hz, at the ${BARK_EDGES[e]} Hz boundary) ` +
          `was felt by bands ${felt.join(' and ')} — they share it`);
      }
    }
  });

  test('band 0 does not reach below its own 20 Hz edge', () => {
    // The same defect's second half: flooring 20/10.77 put bin 1 — 10.8 Hz — in
    // band 0, so rumble and DC offset moved the innermost ring.
    const e = makeEngine();
    e._bandAnalyser._bytes = singleBin(1, 255);   // 10.8 Hz at this resolution
    nowMs += 1000 / 60;
    e.update(nowMs / 1000);
    assert.equal(e.bands[0], 0,
      `a bin at ${Math.round(1 * BAND_FPB)} Hz moved band 0, whose edge is ${BARK_EDGES[0]} Hz`);
  });

  test('CONTROL — the 1024-point analyser could not have carried this', () => {
    // The same count against the beat detector's resolution: band 0 falls to
    // three bins, which is the measurement that put the tap on its own node.
    const fpb = NYQ / MAIN_BINS;
    const lo = Math.floor(BARK_EDGES[0] / fpb);
    const hi = Math.ceil(BARK_EDGES[1] / fpb);
    assert.ok(hi - lo < 4,
      `band 0 has ${hi - lo} bins at 1024 points, so the second analyser buys nothing`);
  });
});

describe('a band reads its own slice of the spectrum', () => {
  test('a tone inside band k lights band k', () => {
    // Checked across the range rather than at one point: an off-by-one in the
    // edge arithmetic would show at some bands and not others.
    for (const k of [0, 1, 5, 11, 17, 23]) {
      const e = makeEngine();
      const bands = settle(e, tone(BARK_EDGES[k], BARK_EDGES[k + 1]));
      assert.equal(argmax(Array.from(bands)), k,
        `a tone in ${BARK_EDGES[k]}–${BARK_EDGES[k + 1]} Hz lit band ${argmax(Array.from(bands))}, not ${k}`);
    }
  });

  test('CONTROL — the probe moves when the tone moves', () => {
    // Without this, a band array stuck at index 0 would pass the test above for
    // k = 0 and nothing would notice the other five were never really checked.
    const e1 = makeEngine(), e2 = makeEngine();
    const a = argmax(Array.from(settle(e1, tone(BARK_EDGES[3], BARK_EDGES[4]))));
    const b = argmax(Array.from(settle(e2, tone(BARK_EDGES[19], BARK_EDGES[20]))));
    assert.notEqual(a, b, 'two tones an octave-and-a-half apart lit the same band');
  });

  test('neighbours stay well below the band that was actually hit', () => {
    const e = makeEngine();
    const bands = Array.from(settle(e, tone(BARK_EDGES[12], BARK_EDGES[13])));
    assert.ok(bands[12] > 0.5, `the struck band only reached ${bands[12].toFixed(3)}`);
    for (const n of [10, 11, 13, 14]) {
      assert.ok(bands[n] < bands[12] * 0.6,
        `band ${n} read ${bands[n].toFixed(3)} against the struck band's ${bands[12].toFixed(3)}`);
    }
  });
});

describe('each band is normalised against its own history', () => {
  test('a quiet band still reads, but not as the equal of a loud one', () => {
    // The balance the tilt is for. A hi-hat 15 dB under the kick has to be
    // VISIBLE — otherwise the outer rings never move — without being reported
    // as though it were the kick, which is what per-band normalisation did and
    // what a probe caught in the product: with that scheme a 60 Hz tone and a
    // 9 kHz tone drew the same picture.
    const e = makeEngine();
    const paint = (b, k, level) => {
      const lo = Math.floor(BARK_EDGES[k] / BAND_FPB);
      const hi = Math.min(BAND_BINS, Math.ceil(BARK_EDGES[k + 1] / BAND_FPB));
      for (let i = lo; i < hi; i++) b[i] = level;
    };
    const loud = new Uint8Array(BAND_BINS).fill(4);
    paint(loud, 2, 240); paint(loud, 22, 40);      // ~15 dB apart in the window
    const soft = new Uint8Array(BAND_BINS).fill(4);
    paint(soft, 2, 40);  paint(soft, 22, 8);

    let peak2 = 0, peak22 = 0;
    for (let i = 0; i < 120; i++) {
      e._bandAnalyser._bytes = (i % 20) < 6 ? loud : soft;
      nowMs += 1000 / 60;
      e.update(nowMs / 1000);
      if (i > 40) { peak2 = Math.max(peak2, e.bands[2]); peak22 = Math.max(peak22, e.bands[22]); }
    }
    assert.ok(peak2 > 0.8, `the loud band peaked at ${peak2.toFixed(3)}`);
    assert.ok(peak22 > 0.25,
      `the quiet band peaked at ${peak22.toFixed(3)} — the outer rings would barely move`);
    assert.ok(peak22 < peak2,
      `the quiet band (${peak22.toFixed(3)}) reads as loud as the loud one (${peak2.toFixed(3)}) — ` +
      'the bands are no longer telling the two apart');
  });

  test('a tone leaves the bands it is not in dark — the defect the probe found', () => {
    // The claim per-band normalisation broke. Every band that is not carrying
    // the tone has to stay well below the one that is, or 24 bands are one.
    for (const k of [1, 22]) {
      const e = makeEngine();
      const bands = Array.from(settle(e, tone(BARK_EDGES[k], BARK_EDGES[k + 1], 230, 6), 90));
      const others = bands.filter((_, i) => Math.abs(i - k) > 1);
      const worst = Math.max(...others);
      assert.ok(bands[k] > 0.8, `the struck band ${k} only reached ${bands[k].toFixed(3)}`);
      assert.ok(worst < 0.3,
        `with only band ${k} lit, band ${others.indexOf(worst) } read ${worst.toFixed(3)} — ` +
        'the layer cannot tell one part of the spectrum from another');
    }
  });

  test('the tilt lifts the top of the spectrum, and by the stated amount', () => {
    // +3 dB per octave above 200 Hz, in a 75 dB window. Band 22 is centred near
    // 10.7 kHz, i.e. 5.74 octaves up: 17.2 dB, which is 0.23 of the 0…1 scale.
    // Checked as a DIFFERENCE between two bands carrying the same bytes, so it
    // cannot be satisfied by an overall gain.
    const e = makeEngine();
    const b = new Uint8Array(BAND_BINS).fill(4);
    const paint = (k, level) => {
      const lo = Math.floor(BARK_EDGES[k] / BAND_FPB);
      const hi = Math.min(BAND_BINS, Math.ceil(BARK_EDGES[k + 1] / BAND_FPB));
      for (let i = lo; i < hi; i++) b[i] = level;
    };
    paint(1, 120); paint(22, 120);            // identical byte level
    const bands = Array.from(settle(e, b, 90));
    assert.ok(bands[22] > bands[1] + 0.15,
      `equal energy read ${bands[1].toFixed(3)} low and ${bands[22].toFixed(3)} high — ` +
      'the perceptual tilt is not being applied');
  });

  test('silence does not become full scale', () => {
    // The floor under the peak. Without it a band whose reference has decayed
    // divides its own noise up to 1.0 and the shape boils in a quiet passage.
    const e = makeEngine();
    const bands = Array.from(settle(e, new Uint8Array(BAND_BINS).fill(0), 120));
    for (let i = 0; i < BAND_COUNT; i++) {
      assert.ok(bands[i] < 0.05, `band ${i} reads ${bands[i].toFixed(3)} on a silent spectrum`);
    }
  });

  test('stopping playback lets the bands fall back to rest', () => {
    const e = makeEngine();
    settle(e, tone(BARK_EDGES[6], BARK_EDGES[7]));
    assert.ok(e.bands[6] > 0.5, 'the band never rose, so its fall proves nothing');
    e.isPlaying = false;
    for (let i = 0; i < 60; i++) { nowMs += 1000 / 60; e.update(nowMs / 1000); }
    assert.ok(e.bands[6] < 0.05,
      `band 6 is still ${e.bands[6].toFixed(3)} a second after playback stopped`);
  });

  test('the smoothing is a time constant, not a per-frame fraction', () => {
    // The class of defect this project has already fixed twice — the beat fade
    // (FIX(r11)) and the formula clock (FIX(#50)). The first version of this
    // layer wrote `bands = bands*0.3 + norm*0.7` once per RENDERED FRAME, so the
    // filter's speed was a property of the display: tau ran 27.7 ms at 30 fps
    // against 5.8 ms at 144, a 4.8x spread on the same track.
    const settleAfter = (fps, seconds) => {
      const e = makeEngine();
      e._bandAnalyser._bytes = tone(BARK_EDGES[6], BARK_EDGES[7], 220, 6);
      const frames = Math.round(fps * seconds);
      for (let i = 0; i < frames; i++) { nowMs += 1000 / fps; e.update(nowMs / 1000); }
      return e.bands[6];
    };
    // Half a second of the same tone has to reach the same level at any rate.
    const at = [30, 60, 144].map(fps => settleAfter(fps, 0.5));
    const spread = Math.max(...at) - Math.min(...at);
    assert.ok(spread < 0.02,
      `after 0.5 s the band reads ${at.map(v => v.toFixed(4)).join(' / ')} at 30/60/144 fps — ` +
      `a spread of ${spread.toFixed(4)}, so the display decides how fast the rings move`);

    // And the rise itself has to be the intended one rather than merely equal:
    // one time constant is 63.2 % of the way, and BAND_TAU is 60 ms.
    const oneTau = settleAfter(60, 0.06);
    assert.ok(oneTau > 0.45 && oneTau < 0.8,
      `after one time constant the band is at ${oneTau.toFixed(3)}, not near the 0.63 a single pole gives`);
  });

  test('near-silence does not stand the body up', () => {
    // The old test only fed EXACT zeros, and passed while a spectrum of
    // all-ones — -84.7 dBFS, inaudible — drove band 23 to 1.000: for the twelve
    // bands above 1720 Hz the perceptual tilt alone cleared the reference floor,
    // so each of them became its own reference. A microphone in a quiet room
    // would have held the shape up as a static cone. Found by a review sweep.
    for (const level of [1, 4, 8]) {
      const e = makeEngine();
      const bands = Array.from(settle(e, new Uint8Array(BAND_BINS).fill(level), 120));
      const worst = Math.max(...bands);
      assert.ok(worst < 0.1,
        `a flat spectrum at byte ${level} (${(-85 + level / 255 * 75).toFixed(1)} dBFS) drove a band to ` +
        `${worst.toFixed(3)} — that is silence reading as signal`);
    }
  });

  test('the tilt is calibrated on pink noise, which is what music looks like', () => {
    // The tilt exists to cancel the roughly -3 dB/octave slope of music. The
    // check is therefore not "the top reads high" but "pink comes out FLAT":
    // on a -3 dB/oct spectrum the bottom eight and the top eight bands have to
    // agree. White noise deliberately does not — it really is brighter.
    const e = makeEngine();
    const b = new Uint8Array(BAND_BINS);
    for (let k = 1; k < BAND_BINS; k++) {
      const dB = -30 - 3 * Math.log2((k * BAND_FPB) / 1000);
      b[k] = Math.max(0, Math.min(255, Math.round((dB + 85) / 75 * 255)));
    }
    const bands = Array.from(settle(e, b, 120));
    const lo = bands.slice(0, 8).reduce((a, c) => a + c) / 8;
    const hi = bands.slice(16).reduce((a, c) => a + c) / 8;
    assert.ok(Math.abs(hi / lo - 1) < 0.15,
      `pink noise reads ${lo.toFixed(2)} low against ${hi.toFixed(2)} high (${(hi / lo).toFixed(2)}x) — ` +
      'the tilt no longer cancels the slope music actually has');
  });

  test('the tap is idle while the layer is off', () => {
    // The 4096-point FFT is the cost of a feature that ships switched off, so it
    // is not paid until the slider moves. The bands decay to rest instead of
    // holding whatever spectrum was last computed.
    const e = makeEngine();
    settle(e, tone(BARK_EDGES[6], BARK_EDGES[7]));
    assert.ok(e.bands[6] > 0.5, 'the band never rose, so its decay proves nothing');
    let reads = 0;
    e._bandAnalyser.getByteFrequencyData = function (a) { reads++; a.set(this._bytes); };
    e.bandDepth = 0;
    for (let i = 0; i < 60; i++) { nowMs += 1000 / 60; e.update(nowMs / 1000); }
    assert.equal(reads, 0, `the analyser was read ${reads} times with the layer off`);
    assert.ok(e.bands[6] < 0.05,
      `band 6 is still ${e.bands[6].toFixed(3)} a second after the layer was switched off`);
  });

  test('a hidden tab handing back one enormous delta moves nothing', () => {
    // Same guard the beat fade uses: dt outside (0, 1) is not a frame.
    const e = makeEngine();
    settle(e, tone(BARK_EDGES[6], BARK_EDGES[7]));
    const before = Array.from(e.bands);
    e._bandAnalyser._bytes = new Uint8Array(BAND_BINS).fill(0);
    nowMs += 45_000;
    e.update(nowMs / 1000);
    assert.deepStrictEqual(Array.from(e.bands), before,
      'a 45-second frame was allowed to rewrite the bands');
  });
});
