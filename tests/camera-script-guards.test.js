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

// ── What a preset records is the script that is RUNNING ──────────────────────
// captureState reads cam.cpSource and falls back to the editor buffer, so the
// snapshot names what is actually driving the camera rather than whatever text
// happens to be in the textarea. The consumer half was pinned; the producer —
// cpSource being written beside cpFn, and dropped with it — was not, and the
// two going out of step is the whole reason the field exists.
describe('the armed script and the source recorded for it stay together', () => {

  test('loadScript stores the source it compiled', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cam } = makeCam();

    cam.loadScript('ctx.cam.x = 3;');

    assert.equal(cam.cpActive, true, 'precondition: armed');
    assert.equal(cam.cpSource, 'ctx.cam.x = 3;',
      'a preset saved now would record the editor buffer instead of what is running');
  });

  test('resetScript drops both', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cam } = makeCam();
    cam.camera.rotation = { z: 0 };

    cam.loadScript('ctx.cam.x = 3;');
    cam.resetScript();

    assert.equal(cam.cpActive, false);
    assert.equal(cam.cpSource, null, 'a stale source outlives the script that owned it');
  });

  test('control — a script that does not compile arms nothing', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cam } = makeCam();

    cam.loadScript('this is not javascript(');

    assert.equal(cam.cpActive, false);
    assert.equal(cam.cpSource, null, 'nothing is running, so there is nothing to record');
  });
});

// ── Standing down while a preset tweens the camera ───────────────────────────
// tweenHold is raised by presets.js for the length of a camera tween (and by
// nothing else), and both automated drivers read it: isScriptDriving() gates the
// programmer script and its roll, updatePhysics() gates the built-in modes.
// Only the SETTER had a test — presets.js was checked for raising and clearing
// the flag, and nothing checked that anything stands down while it is up, so
// dropping either term would have left a script or a physics mode fighting the
// tween's position writes for its whole duration with CI still green.
describe('automated camera motion stands down while a tween holds the camera', () => {

  test('the programmer script does not drive during a preset camera tween', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cam, camera } = makeCam();

    cam.loadScript('ctx.cam.x = 3;');
    tick(cam);
    assert.equal(camera.position.x, 3, 'precondition: the script drives');

    cam.tweenHold = true;                       // presets.js, for the tween's length
    camera.position.set(0, 1, 8);               // where the tween has put the camera
    tick(cam);

    assert.equal(cam.isScriptDriving(), false, 'the tween owns the camera right now');
    assert.equal(camera.position.x, 0,
      'a script re-arming every frame fights the tween for its whole duration');
  });

  test('the roll the script asked for is not re-applied either', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cam, camera } = makeCam();
    // applyRoll is the only caller of rotateZ; orbit.update()'s lookAt re-levels
    // the camera every frame, which is why the tilt is re-applied per frame at
    // all — and why a stale one has to stop coming back.
    camera.rotation = { z: 0 };
    camera.rotateZ  = a => { camera.rotation.z += a; };

    cam.loadScript('ctx.roll = 0.4;');
    tick(cam);
    cam.applyRoll();
    assert.notEqual(camera.rotation.z, 0, 'precondition: the bank angle is applied');

    cam.tweenHold = true;
    camera.rotation.z = 0;                      // what the frame's lookAt left
    cam.applyRoll();

    assert.equal(camera.rotation.z, 0, 'OrbitControls cannot undo a roll written behind it');
  });

  test('the built-in physics modes stand down too', () => {
    const { cam, camera, orbit } = makeCam();
    cam.camPhysics = 'dark_matter';

    cam.updatePhysics(1.0, 0.4);
    assert.notEqual(cam.rotAngle, 0, 'precondition: auto-rotate is moving the camera');

    const before = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const angle  = cam.rotAngle;
    orbit.target.set(9, 9, 9);                  // where the tween pointed it
    cam.tweenHold = true;
    cam.updatePhysics(2.0, 0.4);

    assert.equal(cam.rotAngle, angle, 'not even the angle advances — the frame is not ours');
    assert.deepEqual(
      { x: camera.position.x, y: camera.position.y, z: camera.position.z }, before,
      'physics overwriting camera.position each frame is what makes a tween invisible');
    assert.deepEqual({ x: orbit.target.x, y: orbit.target.y, z: orbit.target.z },
      { x: 9, y: 9, z: 9 }, 'and the orbit target is left where the tween put it');
  });

  test('control — clearing the hold hands the camera back', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { cam, camera } = makeCam();

    cam.loadScript('ctx.cam.x = 3;');
    cam.tweenHold = true;
    tick(cam);
    assert.equal(camera.position.x, 0, 'precondition: held');

    cam.tweenHold = false;                      // the tween's onDone
    tick(cam);
    assert.equal(cam.isScriptDriving(), true);
    assert.equal(camera.position.x, 3, 'the script picks up again the moment it is released');

    const angle = cam.rotAngle;
    cam.updatePhysics(1.0, 0.4);
    assert.notEqual(cam.rotAngle, angle, 'and so do the physics modes');
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
