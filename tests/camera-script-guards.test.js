// tests/camera-script-guards.test.js
//
// Contract tests for what the Camera Programmer is allowed to do to the camera,
// and for what the status line is allowed to forget.
//
// Run:
//   node --test tests/camera-script-guards.test.js
//
// ── Defect 1: a non-finite value poisons the camera for good ──────────────────
// The commit after each tick clamps fov into [10, 160], but a clamp is not a
// guard: Math.max(10, Math.min(160, NaN)) is NaN. The line below it does have
// one, and its comment claims parity — "The non-finite guard mirrors the FOV
// clamp" — so the invariant was stated and then not implemented. It is not
// recoverable by fixing the script either: ctx.fov is seeded from camera.fov
// every tick, and the default template plus five of the eight gallery presets
// write `ctx.fov = lerp(ctx.fov, …)`, and lerp(NaN, …) is NaN forever. One
// frame of `pow(bass - 0.5, 0.5)` — a negative base — and the projection
// matrix is NaN, the scene stops drawing, and only RESET brings it back.
// Position and orbit target are committed the same way and were exposed the
// same way, so they are guarded here too.
//
// ── Defect 2: the error is wiped by the previous success ──────────────────────
// A successful APPLY prints "✔ Running" and arms a 2 s timer to blank the
// status line. Nothing cancels it. A runtime error lands in that same line one
// frame later and disarms the script — so two seconds after the apply, the only
// explanation the operator ever got disappears, leaving a camera that has
// reverted to auto-orbit and an editor that says nothing at all.
//
// ── Controls ──────────────────────────────────────────────────────────────────
// "a working script still moves the camera" and "a success still clears itself"
// pass before and after: the guard must not swallow good values, and the timer
// must still tidy up after a clean apply.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

let CameraSystem;
before(async () => { ({ CameraSystem } = await import('../src/camera.js')); });

function makeCam() {
  const camera = {
    fov: 45,
    projections: 0,
    position: { x: 0, y: 1, z: 8, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    updateProjectionMatrix() { this.projections++; },
  };
  const orbit = {
    target: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    update() {},
  };
  const cam = new CameraSystem(camera, orbit, { autoRotRadius: 7.2 });
  // isScriptDriving() gates on both, and the editor's APPLY is only reachable
  // with auto-rotate on.
  cam.autoRot = true;
  cam.userInt = false;
  const status = [];
  cam.cb.onScriptStatus = (type, msg) => status.push({ type, msg });
  return { cam, camera, orbit, status };
}

const tick = cam => cam.runScript(1.0, 0.4, 0.3, 0.2, 0);

describe('a script cannot hand the camera a value it can never recover from', () => {

  test('a NaN fov never reaches the projection matrix', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cam, camera } = makeCam();

    cam.loadScript('ctx.fov = Math.pow(bass - 0.5, 0.5) * 10;');  // NaN below 0.5 bass
    tick(cam);

    assert.ok(Number.isFinite(camera.fov),
      `fov left the finite world: ${camera.fov} — every later tick lerps from it`);
    assert.equal(camera.fov, 45, 'and the last good value is what stays');
  });

  test('nor does a NaN position or target', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cam, camera, orbit } = makeCam();

    cam.loadScript('ctx.cam.x = Math.sqrt(-1); ctx.target.y = 0 / 0;');
    tick(cam);

    assert.ok(Number.isFinite(camera.position.x), 'a NaN camera position draws nothing at all');
    assert.ok(Number.isFinite(orbit.target.y));
    assert.equal(camera.position.x, 0, 'the previous value is kept');
  });

  test('control — a working script still moves the camera, the target and the fov', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cam, camera, orbit } = makeCam();

    cam.loadScript('ctx.cam.x = 3; ctx.target.y = 2; ctx.fov = 70; ctx.roll = 0.2;');
    tick(cam);

    assert.equal(camera.position.x, 3);
    assert.equal(orbit.target.y, 2);
    assert.equal(camera.fov, 70);
    assert.equal(cam.cpRoll, 0.2, 'roll still gets through too');
  });

  test('control — the fov clamp is still a clamp', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cam, camera } = makeCam();

    cam.loadScript('ctx.fov = 99999;');
    tick(cam);

    assert.equal(camera.fov, 160, 'a runaway number is clamped, not rejected');
  });
});

describe('the status line keeps the last thing that happened', () => {

  test('a runtime error is not blanked by the previous success', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cam, status } = makeCam();

    cam.loadScript('nope.bar();');      // parses; throws on the first tick
    tick(cam);
    assert.equal(status.at(-1).type, 'error', 'precondition: the error was reported');
    assert.equal(cam.cpActive, false, 'and the script was disarmed');

    t.mock.timers.tick(2000);           // the success timer from the apply fires
    assert.equal(status.at(-1).type, 'error',
      'the only explanation the operator has must not clear itself');
  });

  test('control — a clean apply still tidies its own status away', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cam, status } = makeCam();

    cam.loadScript('ctx.cam.x = 1;');
    tick(cam);
    assert.equal(status.at(-1).type, 'ok');

    t.mock.timers.tick(2000);
    assert.equal(status.at(-1).type, 'clear', '"✔ Running" is transient by design');
  });
});
