// tests/audio-cancellation-tokens.test.js
//
// STOP stops it, including the part of it that had not happened yet.
//
// AudioEngine.loadPlay implements a complete supersession protocol — a
// monotonic loadId, a superseded() helper that also settles ownership of the
// loading bar, a re-check after every await. Two things sat outside it:
//
//   crossfadeToTrack   no token at all. It awaited the read and the decode,
//                      then built a source, connected it and called start()
//                      with no check of any kind, and the two statements that
//                      would have thrown on a torn-down engine were each
//                      swallowed by a bare `catch (_) {}`.
//
//   _stopSource        `sourceId++` appeared in exactly two places and neither
//                      was a teardown, so an auto-advance already in flight
//                      still satisfied its own guard 200 ms later.
//
// And STOP itself bumped nothing, so even loadPlay's protocol — correct against
// a newer load and against a capture — did not cover the operator pressing the
// button. That is the fix all three share: stopAudio() is a supersession.
//
// The window is small and completely ordinary: press NEXT, change your mind,
// press STOP. The room goes quiet, the button repaints to ▶ PLAY, and a moment
// later the decode lands and the cancelled track starts itself.
//
// ── Why this runs in plain Node ──────────────────────────────────────────────
// Same approach as tests/audio-playhead.test.js: the real AudioEngine, its own
// fields set to the state a playing track leaves behind, and a stub context
// whose createGain/createBufferSource hand back objects that record what was
// done to them. The two async boundaries — the file read and decodeAudioData —
// are deferreds the test resolves by hand, which is what makes "inside the
// decode window" an exact place rather than a race.

import { test, describe, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let AudioEngine;
before(async () => {
  ({ AudioEngine } = await import('../src/audio.js'));
  // crossfadeToTrack's first line is `if (typeof GainNode === 'undefined')
  // { this.loadPlay(...); return; }` — the defensive hard-cut for a browser
  // without the Web Audio gain node. Node has no GainNode either, so without
  // this the whole suite below would exercise that fallback and never reach a
  // crossfade at all: every assertion about supersession would pass by never
  // getting near the code it names. The controls in this file are what caught
  // it. Only the typeof check reads it; nothing constructs one.
  globalThis.GainNode ??= class GainNode {};
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

/** Let every pending microtask continuation run. */
const flush = () => new Promise(r => setImmediate(r));

function makeCtx() {
  const sources = [];
  const ctx = {
    currentTime: 0,
    state: 'running',
    createGain: () => ({
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect() {}, disconnect() {},
    }),
    createBufferSource() {
      const src = {
        buffer: null, onended: null, started: false, stopped: false,
        connect() {}, disconnect() {},
        start() { this.started = true; },
        stop() { this.stopped = true; },
      };
      sources.push(src);
      return src;
    },
    decodeAudioData: () => { throw new Error('decodeAudioData not armed by this test'); },
    close() {}, resume() {},
  };
  return { ctx, sources };
}

let eng, ctx, sources, playStates, loadingCalls;

beforeEach(() => {
  ({ ctx, sources } = makeCtx());
  playStates = [];
  loadingCalls = [];
  eng = new AudioEngine({
    onPlayState: v => playStates.push(v),
    onLoading:   (on, ...rest) => loadingCalls.push([on, ...rest]),
  });
  // The state a playing track leaves behind, as loadPlay would.
  eng.audioCtx    = ctx;
  eng.analyser    = { connect() {}, disconnect() {} };
  eng.audioBuffer = { duration: 100 };
  eng.audioSrc    = ctx.createBufferSource();
  eng.isPlaying   = true;
  // The context already exists; ensureCtx would only re-probe it.
  eng.ensureCtx = async () => {};
});

const startedCount = () => sources.filter(s => s.started).length;

describe('crossfadeToTrack stops when the operator stops', () => {

  /** Drive the crossfade up to the point where the decode is in flight. */
  async function crossfadeMidDecode() {
    const read = deferred();
    const decode = deferred();
    eng._readFile = () => read.promise;
    ctx.decodeAudioData = () => decode.promise;

    const p = eng.crossfadeToTrack(new File(['x'], 'next.mp3'));
    read.resolve(new ArrayBuffer(8));
    await flush();                       // the read continuation has run
    return { p, decode };
  }

  test('STOP inside the decode window does not start the track', async () => {
    const { p, decode } = await crossfadeMidDecode();
    const before = startedCount();

    eng.stopAudio();                     // ⏸ STOP
    assert.equal(eng.isPlaying, false, 'precondition: STOP stopped playback');

    decode.resolve({ duration: 50 });    // …and now the decode lands
    await p;

    assert.equal(startedCount(), before,
      'a source was started after STOP — this is the cancelled track playing itself');
    assert.equal(eng.isPlaying, false,
      'the crossfade set isPlaying back to true after the operator stopped');
    assert.equal(playStates.at(-1), false,
      `the transport was told ${playStates.at(-1)} last; STOP must be the final word`);
    assert.equal(eng.isCrossfading, false);
  });

  test('CLEAR PLAYLIST inside the window does not play a track that is gone', async () => {
    const { p, decode } = await crossfadeMidDecode();
    const before = startedCount();

    eng.clearPlaylist();
    decode.resolve({ duration: 50 });
    await p;

    assert.equal(startedCount(), before,
      'a track started after the playlist was cleared, and it is not in the playlist');
    assert.equal(eng.isPlaying, false);
  });

  test('a capture taking the analyser supersedes it too', async () => {
    const { p, decode } = await crossfadeMidDecode();
    const before = startedCount();

    eng._stopFilePlayback();             // what both capture paths call
    decode.resolve({ duration: 50 });
    await p;

    assert.equal(startedCount(), before,
      'the file played over a live capture — the failure FIX(r4) closed for loadPlay only');
  });

  test('a newer track started in the window wins', async () => {
    const { p, decode } = await crossfadeMidDecode();

    // The newer load stamps its own id, exactly as loadPlay does.
    const newerId = ++eng.loadId;
    const before = startedCount();

    decode.resolve({ duration: 50 });
    await p;

    assert.equal(startedCount(), before, 'the older crossfade started its source anyway');
    assert.equal(eng.loadId, newerId, 'the older crossfade moved the token it does not own');
  });

  test('the loading bar is not left up by a superseded crossfade', async () => {
    const { p, decode } = await crossfadeMidDecode();
    eng.stopAudio();
    decode.resolve({ duration: 50 });
    await p;

    assert.deepEqual(loadingCalls.at(-1), [false],
      `the loading indicator was left showing: ${JSON.stringify(loadingCalls.at(-1))}`);
    assert.equal(eng._loadingOwner, 0, 'ownership of the loading bar was not released');
  });

  test('control — undisturbed, the crossfade still plays the track', async () => {
    const { p, decode } = await crossfadeMidDecode();
    const before = startedCount();

    decode.resolve({ duration: 50 });
    await p;

    assert.equal(startedCount(), before + 1, 'the incoming track was never started');
    assert.equal(eng.isPlaying, true);
    assert.equal(playStates.at(-1), true);
    assert.equal(eng.audioBuffer.duration, 50, 'the engine is not holding the new buffer');
    assert.equal(eng.isCrossfading, true);
  });

  test('control — a read that rejects still reports, when nothing superseded it', async () => {
    const read = deferred();
    eng._readFile = () => read.promise;
    let fellBack = 0;
    eng.loadPlay = async () => { fellBack++; };

    const p = eng.crossfadeToTrack(new File(['x'], 'next.mp3'));
    read.reject(new Error('File read failed'));
    await p;

    assert.equal(fellBack, 1, 'a genuine failure no longer falls back to a hard cut');
  });

  test('a stop before the read starts means the file is never read', async () => {
    const read = deferred();
    // This promise is deliberately never awaited by the engine — the point of
    // the test — so handle its rejection here or node reports it as unhandled.
    read.promise.catch(() => {});
    let readCalls = 0;
    eng._readFile = () => { readCalls++; return read.promise; };
    let fellBack = 0;
    eng.loadPlay = async () => { fellBack++; };

    const p = eng.crossfadeToTrack(new File(['x'], 'next.mp3'));
    eng.stopAudio();                     // before ensureCtx has even resolved
    read.reject(new Error('File read failed'));
    await p;

    assert.equal(readCalls, 0,
      'the engine read a file for a track the operator had already stopped');
    assert.equal(fellBack, 0, 'a superseded crossfade fell back to a hard cut');
  });

  test('a read that rejects after a stop mid-read does not fall back and restart it', async () => {
    const read = deferred();
    eng._readFile = () => read.promise;
    let fellBack = 0;
    eng.loadPlay = async () => { fellBack++; };

    const p = eng.crossfadeToTrack(new File(['x'], 'next.mp3'));
    await flush();                       // now genuinely inside the read
    eng.stopAudio();
    read.reject(new Error('File read failed'));
    await p;

    assert.equal(fellBack, 0,
      'the error path restarted the cancelled track — the original bug wearing a different hat');
  });
});

describe('_stopSource retires the source it tears down', () => {

  test('it moves the counter the auto-advance guard reads', () => {
    const before = eng.sourceId;
    eng._stopSource();
    assert.notEqual(eng.sourceId, before,
      'sourceId did not move on teardown, so a timer already in flight still passes its guard');
  });

  test('a start after a stop is still the current source', () => {
    eng._stopSource();
    eng._startSource(0);
    assert.ok(eng.audioSrc, 'no source after _startSource');
    assert.equal(eng.audioSrc.started, true);
  });
});

describe('the auto-advance timer does not survive STOP', () => {

  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
  afterEach(() => { mock.timers.reset(); });

  /** A playing track whose source has just reached its end. */
  function trackEnded() {
    let advanced = 0;
    eng.nextTrack = () => { advanced++; };
    eng._startSource(0);
    const src = eng.audioSrc;
    eng.isPlaying = true;
    src.onended();                       // the track runs out
    return { advanced: () => advanced };
  }

  test('STOP inside the 200 ms window cancels the advance', () => {
    const t = trackEnded();
    eng.stopAudio();                     // the natural moment to press it
    mock.timers.tick(500);
    assert.equal(t.advanced(), 0,
      'the next track started after the operator pressed STOP');
  });

  test('starting a capture inside the window cancels it too', () => {
    const t = trackEnded();
    eng._stopFilePlayback();
    mock.timers.tick(500);
    assert.equal(t.advanced(), 0,
      'the capture was torn down and the next file played over it');
  });

  test('control — left alone, the playlist still advances', () => {
    const t = trackEnded();
    mock.timers.tick(500);
    assert.equal(t.advanced(), 1, 'auto-advance stopped working');
  });
});
