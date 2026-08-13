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

  test('a live capture connected mid-load is not played over', async () => {
    // The other half of the same defect, named in this.loadId's own comment and
    // in the header above: ++this.loadId lived only in loadPlay, so a capture
    // taking the analyser through _stopFilePlayback() left the in-flight load's
    // claim intact. It then assigned audioBuffer and started a source on top of
    // a running mic, with liveMode still reading 'mic'.
    const { engine, events, decodes } = makeEngine();
    let grant;
    // navigator is a getter on the Node global, so it is replaced by descriptor
    // and put back before anything can throw past it.
    const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia: () => new Promise(res => { grant = res; }) } },
    });
    engine.audioCtx.createMediaStreamSource = () => ({ connect() {}, disconnect() {} });

    const big = engine.loadPlay({ name: 'BIG' });
    await flush();                                    // reached its decode

    const mic = engine.captureMicrophone();           // AUDIO SOURCE → Microphone
    await flush();
    grant({ getTracks: () => [] });                   // the permission prompt is answered
    const micResult = await mic;
    Object.defineProperty(globalThis, 'navigator', realNav);

    assert.deepEqual(micResult, { ok: true }, 'precondition: the capture was granted');
    assert.equal(engine.liveMode, 'mic', 'precondition: the capture is wired');

    decodes.get('BIG').resolve(buffer('BIG'));        // the abandoned decode lands
    await big;

    assert.equal(engine.liveMode, 'mic', 'the operator is listening to the mic');
    assert.ok(engine.audioBuffer === null,
      'the file the operator navigated away from must not take the analyser back');
    assert.deepEqual(events.filter(e => e[0] === 'startSource'), [],
      'a source started here plays the track over the live capture');
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

// ── The playlist itself ───────────────────────────────────────────────────────
// Two defects about what ends up in it, both about a check that looks right and
// compares the wrong things or at the wrong time.
describe('addFiles — the duplicate guard', () => {

  const mp3 = name => ({ name, type: 'audio/mpeg' });

  test('the same file dropped twice is one row', () => {
    const { engine } = makeEngine();
    engine.loadPlay = () => {};                       // the auto-play branch is not the subject

    engine.addFiles([mp3('song.mp3')]);
    engine.addFiles([mp3('song.mp3')]);

    assert.deepEqual(engine.playlist.map(t => t.name), ['song'],
      'the guard compares the stored name — which is stripped of its extension — ' +
      'against the raw filename, so it can never match for any file that has one');
  });

  test('control — two different files that strip to the same stem stay two rows', () => {
    const { engine } = makeEngine();
    engine.loadPlay = () => {};

    engine.addFiles([mp3('song.mp3')]);
    engine.addFiles([{ name: 'song.wav', type: 'audio/wav' }]);

    assert.equal(engine.playlist.length, 2,
      'they are genuinely different files; deduping by display name would lose one');
  });

  test('control — the first drop still starts playing', () => {
    const { engine } = makeEngine();
    const played = [];
    engine.loadPlay = f => played.push(f.name);

    engine.addFiles([mp3('first.mp3')]);
    engine.addFiles([mp3('first.mp3')]);

    assert.deepEqual(played, ['first.mp3'], 'once, for the first file');
    assert.equal(engine.trackIdx, 0);
  });

  test('control — a non-audio file is still refused', () => {
    const { engine } = makeEngine();
    engine.loadPlay = () => {};

    engine.addFiles([{ name: 'notes.txt', type: 'text/plain' }]);

    assert.equal(engine.playlist.length, 0);
  });
});

// The intro auto-load makes both of its refusals — "the user cleared it once"
// and "the playlist is not empty" — before awaiting a 3.9 MB fetch, and acts on
// the answers seconds later without asking again. Its own JSDoc promises both
// no-ops. A user who drops a track while the fetch is in flight gets the intro
// mixed into their playlist; a user who presses CLEAR in that window gets the
// intro back and playing, right after asking for it to go.
describe('the intro track loses every race it should lose', () => {

  const introFetch = () => {
    const d = deferred();
    globalThis.fetch = () => d.promise;
    return d;
  };
  const okResponse = { ok: true, blob: async () => ({ size: 1 }) };

  test('a track dropped during the fetch is not joined by the intro', async () => {
    const { engine } = makeEngine();
    engine.loadPlay = () => {};
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    const gate = introFetch();

    const pending = engine._loadIntroIfNeeded();
    engine.addFiles([{ name: 'mytrack.mp3', type: 'audio/mpeg' }]);   // user, mid-fetch
    gate.resolve(okResponse);
    await pending;

    assert.deepEqual(engine.playlist.map(t => t.name), ['mytrack'],
      'the playlist was empty when the fetch started and is not now');
  });

  test('CLEAR during the fetch is not undone by it', async () => {
    const { engine } = makeEngine();
    const played = [];
    engine.loadPlay = f => played.push(f.name);
    let cleared = null;
    globalThis.localStorage = {
      getItem: k => (k === 'vimathic_intro_cleared' ? cleared : null),
      setItem: (k, v) => { if (k === 'vimathic_intro_cleared') cleared = v; },
      removeItem() {},
    };
    const gate = introFetch();

    const pending = engine._loadIntroIfNeeded();
    engine.clearPlaylist();                                           // user, mid-fetch
    gate.resolve(okResponse);
    await pending;

    assert.deepEqual(engine.playlist, [], 'CLEAR is an explicit instruction, not a suggestion');
    assert.deepEqual(played, [], 'and the intro must certainly not start playing');
  });

  test('control — a clean boot still gets the intro, playing', async () => {
    const { engine } = makeEngine();
    const played = [];
    engine.loadPlay = f => played.push(f.name);
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    const gate = introFetch();

    const pending = engine._loadIntroIfNeeded();
    gate.resolve(okResponse);
    await pending;

    assert.equal(engine.playlist.length, 1, 'this is the feature, and it has to survive the fix');
    assert.equal(played.length, 1);
  });

  test('control — the cleared flag still bails before fetching at all', async () => {
    const { engine } = makeEngine();
    globalThis.localStorage = { getItem: () => 'true', setItem() {}, removeItem() {} };
    let fetched = false;
    globalThis.fetch = () => { fetched = true; return Promise.resolve(okResponse); };

    await engine._loadIntroIfNeeded();

    assert.equal(fetched, false, 'an offline build should not pay for a fetch it will discard');
    assert.deepEqual(engine.playlist, []);
  });
});

describe('AudioEngine.loadPlay — who owns the loading bar', () => {

  /** Record the indicator calls; makeEngine's own onLoading is a no-op. */
  function withLoading() {
    const h = makeEngine();
    h.loading = [];
    h.engine.cb.onLoading = (...a) => h.loading.push(a);
    return h;
  }

  test('a load abandoned by a capture takes its own bar down', async () => {
    // A capture never touches the indicator, so the load it supersedes has to,
    // or the bar slides for the rest of the session. _stopFilePlayback() is the
    // one call both capture paths make; the permission prompt failing AFTER it
    // leaves liveMode null, which is why this cannot be keyed on liveMode.
    const { engine, decodes, loading } = withLoading();

    const big = engine.loadPlay({ name: 'BIG' });
    await flush();
    assert.deepEqual(loading[0], [true, 0, 'LOADING TRACK…'], 'precondition: the bar is up');

    engine._stopFilePlayback();                  // the capture claims the analyser…
    decodes.get('BIG').resolve(buffer('BIG'));   // …and the abandoned decode lands
    await big;

    assert.deepEqual(loading.at(-1), [false],
      'nobody else will clear this bar — the abandoned load must');
  });

  test('a stale load does not clip the bar of the load that replaced it', async () => {
    // The other direction, and the one liveMode got wrong: after a capture the
    // operator picks a new file, so the stale load finds liveMode truthy and a
    // NEWER load already showing its own progress.
    const { engine, decodes, loading } = withLoading();

    const big = engine.loadPlay({ name: 'BIG' });
    await flush();
    engine._stopFilePlayback();
    engine.liveMode = 'mic';                     // as a granted capture leaves it

    const small = engine.loadPlay({ name: 'SMALL' });
    await flush();
    const barsUp = loading.length;
    assert.equal(loading.at(-1)[0], true,
      'precondition: the newer load owns the bar and is still working');

    decodes.get('BIG').resolve(buffer('BIG'));   // the stale one lands mid-decode
    await big;

    assert.deepEqual(loading.slice(barsUp).filter(c => c[0] === false), [],
      'the newer load is still decoding — its bar is not the stale load’s to clear');

    decodes.get('SMALL').resolve(buffer('SMALL'));
    await small;
    assert.equal(engine.audioBuffer.tag, 'SMALL', 'control: the newer load still lands');
  });
});
