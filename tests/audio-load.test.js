// tests/audio-load.test.js
//
// Contract tests for AudioEngine.loadPlay() — which load wins, and what the
// transport is told when one fails.
//
// Run:
//   node --test tests/audio-load.test.js
//
// ── The two defects pinned here ───────────────────────────────────────────────
// 1. No generation token. loadPlay() awaits twice (file read, then decode) and
//    then writes audioBuffer and starts a source unconditionally, so the load
//    that FINISHES last won rather than the one the user asked for last. Click a
//    big track, change your mind mid-load and click a small one: the small one
//    starts, then the big one lands on top of it and plays instead — while the
//    playlist highlight and trackIdx still point at the small one. The same
//    overwrite tore down a live mic capture that had been connected after the
//    load was requested. The class already documents this exact pattern for
//    sources ("Monotonic id stamped on each created source… bail out when a
//    newer source has taken over"); loads simply never got one.
//
// 2. The catch sets isPlaying without telling anyone. The success path pairs
//    `isPlaying = true` with cb.onPlayState(true); the failure path assigned
//    isPlaying and returned. loadPlay() stops the previous source before its
//    try block, so a track that fails to decode leaves the app silent while
//    #play-btn still reads "⏸ STOP" and every play-state consumer — clip sync
//    included — still believes playback is running.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// Only the two async edges are replaced (the FileReader wrapper and
// decodeAudioData); loadPlay's own ordering, guards and callbacks are the real
// ones. Source plumbing is recorded rather than executed, since starting a
// buffer source needs a real Web Audio graph.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

let AudioEngine;
before(async () => { ({ AudioEngine } = await import('../src/audio.js')); });

/** Let every pending microtask run — loadPlay awaits twice before decoding. */
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

/** Resolve/reject on demand, so two loads can be interleaved deliberately. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeEngine() {
  const events = [];
  const engine = new AudioEngine({
    onPlayState:      on => events.push(['playState', on]),
    onLoading:        () => {},
    onSeek:           () => {},
    onDuration:       () => {},
    onPlaylistChange: () => events.push(['playlistChange']),
    onLiveMode:       m  => events.push(['liveMode', m]),
  });

  const decodes = new Map();                       // file name → deferred
  engine.audioCtx = {
    state: 'running',
    currentTime: 0,
    decodeAudioData(tag) {
      const d = deferred();
      decodes.set(tag, d);
      return d.promise;
    },
  };
  engine.ensureCtx   = async () => {};
  engine._readFile   = async file => file.name;    // the tag decodeAudioData sees
  engine._stopSource = () => events.push(['stopSource']);
  engine._startSource = offset => events.push(['startSource', engine.audioBuffer?.tag, offset]);
  engine._cancelCrossfade = () => {};

  return { engine, events, decodes };
}

const buffer = tag => ({ tag, duration: 100 });

describe('AudioEngine.loadPlay — which load wins', () => {

  test('a slower earlier load does not override the track asked for later', async () => {
    const { engine, events, decodes } = makeEngine();

    const big   = engine.loadPlay({ name: 'BIG' });
    await flush();                                          // let it reach its decode
    const small = engine.loadPlay({ name: 'SMALL' });
    await flush();

    decodes.get('SMALL').resolve(buffer('SMALL'));       // the newer one lands first
    await small;
    decodes.get('BIG').resolve(buffer('BIG'));           // the older one lands after
    await big;

    assert.equal(engine.audioBuffer.tag, 'SMALL',
      'the buffer must be the track the user asked for last');
    const started = events.filter(e => e[0] === 'startSource').map(e => e[1]);
    assert.deepEqual(started, ['SMALL'],
      'the superseded load must not start a source of its own');
  });

  test('a superseded load that FAILS leaves the newer one playing', async () => {
    const { engine, events, decodes } = makeEngine();

    const doomed = engine.loadPlay({ name: 'DOOMED' });
    await flush();
    const good = engine.loadPlay({ name: 'GOOD' });
    await flush();

    decodes.get('GOOD').resolve(buffer('GOOD'));
    await good;
    decodes.get('DOOMED').reject(new Error('unsupported codec'));
    await doomed;

    assert.equal(engine.isPlaying, true, 'the newer load is still playing');
    assert.deepEqual(events.filter(e => e[0] === 'playState'), [['playState', true]],
      'a stale failure must not report a stop');
  });

  test('control — a load with nothing racing it applies normally', async () => {
    const { engine, events, decodes } = makeEngine();

    const only = engine.loadPlay({ name: 'ONLY' }, 12);
    await flush();
    decodes.get('ONLY').resolve(buffer('ONLY'));
    await only;

    assert.equal(engine.audioBuffer.tag, 'ONLY');
    assert.equal(engine.isPlaying, true);
    assert.deepEqual(events.filter(e => e[0] === 'startSource'), [['startSource', 'ONLY', 12]],
      'the offset is passed through unchanged');
    assert.deepEqual(events.filter(e => e[0] === 'playState'), [['playState', true]]);
  });
});

describe('AudioEngine.loadPlay — reporting a failure', () => {

  test('a failed load tells the transport that playback stopped', async () => {
    const { engine, events, decodes } = makeEngine();

    const ok = engine.loadPlay({ name: 'A' });
    await flush();
    decodes.get('A').resolve(buffer('A'));
    await ok;
    events.length = 0;

    const bad = engine.loadPlay({ name: 'B' });
    await flush();
    decodes.get('B').reject(new Error('unsupported codec'));
    await bad;

    assert.equal(engine.isPlaying, false, 'nothing is audible any more');
    assert.deepEqual(events.filter(e => e[0] === 'playState'), [['playState', false]],
      'the transport must be told, or the button keeps reading STOP');
  });

  test('a failed load with a live capture wired stays in the playing state', async () => {
    // FIX(#7, r3): isPlaying follows whether a capture is feeding the analyser.
    // That rule is unchanged; it is only the notification that was missing.
    const { engine, events, decodes } = makeEngine();
    engine.liveMode = 'mic';

    const bad = engine.loadPlay({ name: 'B' });
    await flush();
    decodes.get('B').reject(new Error('unsupported codec'));
    await bad;

    assert.equal(engine.isPlaying, true);
    assert.deepEqual(events.filter(e => e[0] === 'playState'), [['playState', true]]);
  });
});
