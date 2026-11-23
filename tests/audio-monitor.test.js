// tests/audio-monitor.test.js
//
// Live input is listened to, not played back. File playback goes
// analyser → monitor → speakers; a microphone, a shared tab or the system mix
// drives the analyser with the monitor closed, and ending the capture opens it
// again.
//
// Run:
//   node --test tests/audio-monitor.test.js
//
// The engine runs for real — ensureCtx, both capture paths, stopLiveCapture,
// _startSource — over a fake AudioContext that records the graph, and a
// navigator whose mediaDevices hand back a fake stream.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let AudioEngine;

class FakeNode {
  constructor(kind, ctx) { this.kind = kind; this.ctx = ctx; this.outs = []; }
  connect(dst) {
    // The monitor's gain at the moment anything is wired — the capture paths
    // must close it before the live source reaches the analyser.
    this.ctx.wires.push({ from: this.kind, to: dst.kind, monitorGain: this.ctx.gains[0]?.gain.value });
    this.outs.push(dst);
    return dst;
  }
  disconnect() { this.outs = []; }
}
class FakeAnalyser extends FakeNode {
  constructor(ctx) { super('analyser', ctx); this.fftSize = 2048; this.smoothingTimeConstant = 0.8; }
  get frequencyBinCount() { return this.fftSize / 2; }
}
class FakeCtx {
  constructor() {
    this.state = 'running'; this.sampleRate = 48000; this.currentTime = 0;
    this.destination = { kind: 'destination' };
    this.wires = []; this.gains = [];
    FakeCtx.last = this;
  }
  createAnalyser() { return new FakeAnalyser(this); }
  createGain() { const g = new FakeNode('gain', this); g.gain = { value: 1 }; this.gains.push(g); return g; }
  createChannelSplitter() { return new FakeNode('splitter', this); }
  createMediaStreamSource(stream) { const n = new FakeNode('live', this); n.stream = stream; return n; }
  createBufferSource() { const n = new FakeNode('file', this); n.start = () => {}; n.stop = () => {}; return n; }
  resume() { return Promise.resolve(); }
}
class NoGainCtx extends FakeCtx { }
NoGainCtx.prototype.createGain = undefined;

const track  = () => ({ stopped: false, onended: null, stop() { this.stopped = true; } });
const stream = () => { const t = track(); return { t, getTracks: () => [t], getAudioTracks: () => [t] }; };

let refuse = false;
let lastStream = null;
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const realAudioContext = globalThis.AudioContext;
before(async () => {
  ({ AudioEngine } = await import('../src/audio.js'));
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      mediaDevices: {
        getUserMedia:    async () => { if (refuse) throw new Error('NotAllowedError'); return (lastStream = stream()); },
        getDisplayMedia: async () => { if (refuse) throw new Error('NotAllowedError'); return (lastStream = stream()); },
      },
    },
  });
});
after(() => {
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator); else delete globalThis.navigator;
  globalThis.AudioContext = realAudioContext;
});

async function engineWith(Ctx = FakeCtx) {
  globalThis.AudioContext = Ctx;
  refuse = false;
  const e = new AudioEngine({
    onPlayState: () => {}, onLoading: () => {}, onSeek: () => {}, onDuration: () => {},
    onPlaylistChange: () => {}, onLiveMode: () => {},
  });
  await e.ensureCtx();
  return { e, ctx: FakeCtx.last };
}

describe('live input is listened to, not played back', () => {

  test('file playback is audible: analyser → monitor, open → speakers', async () => {
    const { e, ctx } = await engineWith();
    assert.ok(e._monitor, 'no monitor between the analyser and the speakers');
    assert.equal(e._monitor.gain.value, 1);
    assert.ok(e.analyser.outs.includes(e._monitor), 'the analyser does not feed the monitor');
    assert.ok(!e.analyser.outs.includes(ctx.destination), 'the analyser still reaches the speakers around the monitor');
    assert.deepEqual(e._monitor.outs, [ctx.destination]);
  });

  test('a microphone drives the analyser with the speakers closed — shut before it is wired', async () => {
    const { e, ctx } = await engineWith();
    const r = await e.captureMicrophone();
    assert.equal(r.ok, true, r.error);
    assert.equal(e._monitor.gain.value, 0, 'the mic is played back through the speakers');
    const wire = ctx.wires.find(w => w.from === 'live');
    assert.deepEqual([wire.to, wire.monitorGain], ['analyser', 0],
      'the mic reached the analyser while the speakers were still open');
  });

  test('a shared tab and the system mix are not played back either', async () => {
    for (const hint of ['tab', 'display']) {
      const { e } = await engineWith();
      const r = await e.captureDisplay(hint);
      assert.equal(r.ok, true, r.error);
      assert.equal(e._monitor.gain.value, 0, `${hint} capture is played back a second time`);
    }
  });

  test('stopping the capture opens the speakers again', async () => {
    const { e } = await engineWith();
    await e.captureMicrophone();
    e.stopLiveCapture();
    assert.equal(e._monitor.gain.value, 1);
  });

  test("ending the share from the browser's own Stop button opens them too", async () => {
    const { e } = await engineWith();
    await e.captureDisplay('tab');
    lastStream.t.onended();
    assert.equal(e._monitor.gain.value, 1);
    assert.equal(e.liveMode, null);
  });

  test('a file started over a live capture is heard', async () => {
    const { e } = await engineWith();
    await e.captureMicrophone();
    e.audioBuffer = { duration: 10 };
    e._startSource(0);
    assert.equal(e.liveMode, null, 'the capture survived the file start');
    assert.equal(e._monitor.gain.value, 1, 'the file plays into closed speakers');
  });

  test('a refused capture leaves the speakers open', async () => {
    const { e } = await engineWith();
    refuse = true;
    const r = await e.captureMicrophone();
    assert.equal(r.ok, false);
    assert.equal(e._monitor.gain.value, 1);
  });

  test('control — an engine without createGain keeps the old direct path', async () => {
    const { e, ctx } = await engineWith(NoGainCtx);
    assert.equal(e._monitor, null);
    assert.ok(e.analyser.outs.includes(ctx.destination), 'no path to the speakers at all');
    const r = await e.captureMicrophone();
    assert.equal(r.ok, true, r.error);
  });
});
