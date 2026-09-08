// tests/silent-apply-failures.test.js
//
// Three call sites reported success for a failure the operator could not see.
//
//   ShaderEditor.compileAndApply  writes the driver's message into #se-error —
//                                 inside the shader editor overlay, which is
//                                 closed on every path a preset takes. It
//                                 returned nothing, so applyState went on to
//                                 report "✔ State loaded" with the previous
//                                 program still bound and the editor buffer
//                                 already overwritten by the source that
//                                 failed, destroying the operator's draft.
//
//   CameraSystem.loadScript       the same shape one block up: a parse error
//                                 goes to the programmer's status line, in the
//                                 other closed overlay, and the method returned
//                                 nothing.
//
//   ClipPlayer._runStep           ignored BOTH failures it can have — a step
//                                 naming a preset that no longer exists, and
//                                 applyState's documented `false` — while the
//                                 status line counted the step down as if it
//                                 were live. Every other caller of applyState
//                                 reads that boolean; the clip player is the
//                                 one caller that did not, and it is the one
//                                 that runs unattended.
//
// compileAndApply needs a WebGL context to reach either of its outcomes, so its
// half is pinned at the source: both exits return a boolean, and the preset
// path checks it. The other two are driven for real.

import { test, describe, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
  .split('\n')
  .filter(l => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); })
  .join('\n');

let CameraSystem, ClipPlayer;
before(async () => {
  globalThis.document ??= {
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null,
    querySelector:  () => null,
    visibilityState: 'visible',
  };
  ({ CameraSystem } = await import('../src/camera.js'));
  ({ ClipPlayer }   = await import('../src/ui/clip-player.js'));
});

describe('CameraSystem.loadScript says whether the script armed', () => {

  /** The smallest object loadScript touches: a status sink and the fields it sets. */
  function makeCam() {
    const cam = Object.create(CameraSystem.prototype);
    cam.cpParams = {};
    cam.cpKeyframes = [];
    cam._status = [];
    cam._setScriptStatus = (kind, msg) => cam._status.push([kind, msg]);
    return cam;
  }

  test('a script that parses returns true and arms', () => {
    const cam = makeCam();
    assert.equal(cam.loadScript('orbit(1, 2);'), true);
    assert.equal(cam.cpActive, true);
    assert.equal(cam.cpSource, 'orbit(1, 2);');
  });

  test('a script that does not parse returns false and stays disarmed', () => {
    const cam = makeCam();
    assert.equal(cam.loadScript('orbit(((('), false,
      'a parse failure returned nothing, so the caller reported success for it');
    assert.equal(cam.cpActive, false, 'a script that did not compile was left armed');
    assert.deepEqual(cam._status.at(-1)[0], 'error', 'the status line was not told either');
  });

  test('the failure is still reported to the status line it always used', () => {
    // The overlay is the wrong channel when a preset is what called this, but
    // it is the right one when the operator pressed the button — so the return
    // value is in addition to it, not instead of it.
    const cam = makeCam();
    cam.loadScript('=');
    const [kind, msg] = cam._status.at(-1);
    assert.equal(kind, 'error');
    assert.match(msg, /Parse/);
  });
});

describe('ClipPlayer reports a step it could not apply', () => {

  let ui, clip, toasts, applied;

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    toasts = [];
    applied = [];
    ui = {
      render: { _tDurShape: 400 },
      autoColor: { enabled: false },
      autoMaterial: { enabled: false },
      _presets: [{ name: 'good', state: { shape: 'plane' } }],
      _loadPresetList() { return this._presets; },
      applyState(state) { applied.push(state); return this._applyResult ?? true; },
      _showToast: (msg, isErr) => toasts.push([msg, !!isErr]),
    };
    clip = new ClipPlayer(ui);
    clip._steps = [{ name: 'good', holdMs: 1000 }];
    clip.playing = true;
  });

  // Every test here arms timers; resetting in each one leaves the next test to
  // fail on "MockTimers is already enabled" the moment an assertion throws
  // early. One hook, always.
  afterEach(() => { mock.timers.reset(); });

  const errors = () => toasts.filter(([, isErr]) => isErr);

  test('a step naming a preset that no longer exists is reported', () => {
    clip._steps = [{ name: 'deleted-yesterday', holdMs: 1000 }];
    clip._runStep();

    assert.equal(applied.length, 0, 'something was applied for a preset that does not exist');
    assert.equal(errors().length, 1,
      'the step silently did nothing while the status line counted it down as live');
    assert.match(errors()[0][0], /deleted-yesterday/,
      'the message does not name the step, which is the only way to find it in a set');
  });

  test('a snapshot applyState turns away is reported', () => {
    ui._applyResult = false;
    clip._runStep();

    assert.equal(applied.length, 1, 'applyState was not even called');
    assert.equal(errors().length, 1,
      "applyState's documented false return was dropped — every other caller reads it");
  });

  test('control — a step that applies cleanly says nothing', () => {
    clip._runStep();
    assert.equal(applied.length, 1);
    assert.deepEqual(errors(), [], `a clean step raised: ${JSON.stringify(errors())}`);
  });

  test('a failed step does not stop the set', () => {
    // A stale name should cost one step, not the performance. The schedule is
    // deliberately untouched by the report.
    clip._steps = [{ name: 'gone', holdMs: 1000 }, { name: 'good', holdMs: 1000 }];
    clip._idx = 0;
    clip._runStep();

    assert.equal(errors().length, 1);
    mock.timers.tick(1000 + clip._morphMs() + 5);
    assert.equal(applied.length, 1, 'the player did not advance past the broken step');
    assert.equal(clip._idx, 1, 'the index did not move on');


  });

  test('the step still gets its hold, so the run stays on its wall clock', () => {
    clip._steps = [{ name: 'gone', holdMs: 2000 }];
    clip._runStep();
    assert.equal(clip._stepHoldMs, 2000,
      'a step that failed to apply was given a different duration from the one it advertises');

  });
});

describe('the shader half is wired the same way', () => {

  test('compileAndApply returns a boolean on both of its exits', () => {
    const src = code('src/shaders.js');
    assert.match(src, /onFailure\(new Error\(captured\)\);\s*return false;/,
      'the failure exit of compileAndApply does not report failure');
    assert.match(src, /onSuccess\(\);\s*return true;/,
      'the success exit of compileAndApply does not report success');
  });

  test('the preset path checks it and tells the operator', () => {
    const src = code('src/ui/presets.js');
    assert.match(src, /se\.compileAndApply\(\)\s*===\s*false/,
      'applyState calls compileAndApply and discards the result again — the failure ' +
      'goes to #se-error inside an overlay that is closed on this path');
    assert.match(src, /_showToast\([^)]*shader did not compile/i,
      'nothing visible is raised when a preset shader fails to compile');
  });

  test('the camera-script path checks it too', () => {
    const src = code('src/ui/presets.js');
    assert.match(src, /cam\.loadScript\(code\)\s*===\s*false/,
      'applyState arms a camera script and discards the result');
    assert.match(src, /_showToast\([^)]*camera script did not parse/i);
  });

  test('the deferred camera-script path is the same call, not a second copy', () => {
    // It is armed either immediately or from the post-tween queue. Both must
    // report; a second spelling is how one of them stops reporting later.
    const src = code('src/ui/presets.js');
    const armCount = (src.match(/cam\.loadScript\(code\)/g) ?? []).length;
    assert.equal(armCount, 1,
      `loadScript(code) is called ${armCount} times in presets.js; the immediate and ` +
      'deferred paths should share one checked call site');
  });
});
