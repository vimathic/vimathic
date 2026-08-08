// tests/camera-tween-damping.test.js
//
// Contract test for RenderEngine.tweenCameraTo(): a camera tween BORROWS
// OrbitControls damping for its duration and must give it back — including when
// a second tween pre-empts it.
//
// Run:
//   node --test tests/camera-tween-damping.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// tweenCameraTo snapshotted `prevDamping = orbit.enableDamping`, set it false,
// and restored it in the tween's onDone — which only runs on completion. Click
// a second preset less than a second after the first (a clip step, a fast
// double-click in the PRESETS panel) and the in-flight tween was cancelled
// without its restore ever firing, while the replacement snapshotted the
// borrowed `false` and dutifully "restored" that. dampingFactor is 0.01, so
// losing damping turns the signature slow glide into a 1:1 snap for the rest of
// the session, with no control that puts it back.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// tweenCameraTo touches only camera/orbit/transitions, so the real method and
// the real TransitionManager run against a stub host; performance.now is driven
// by hand so the schedule is deterministic.

import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let RenderEngine, TransitionManager;
before(async () => {
  ({ RenderEngine, TransitionManager } = await import('../src/render.js'));
});

const realNow = performance.now;
let fakeNow = 0;

function makeHost() {
  return {
    camera: {
      position: { x: 0, y: 0, z: 5, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      fov: 50,
      lookAt() {},
      updateProjectionMatrix() {},
    },
    orbit: {
      enableDamping: true,
      target: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      update() {},
    },
    transitions: new TransitionManager(),
    _tDurCamera: 1000,
  };
}

const tween = (host, to, opts) => RenderEngine.prototype.tweenCameraTo.call(host, to, opts);
const POSE_A = { pos: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, fov: 50 };
const POSE_B = { pos: { x: 9, y: 8, z: 7 }, target: { x: 1, y: 1, z: 1 }, fov: 60 };

describe('tweenCameraTo — damping is borrowed, never kept', () => {
  let host;

  beforeEach(() => {
    fakeNow = 0;
    performance.now = () => fakeNow;
    host = makeHost();
  });

  afterEach(() => { performance.now = realNow; });

  test('a completed tween restores damping', () => {
    tween(host, POSE_A, { duration: 1000 });
    assert.equal(host.orbit.enableDamping, false, 'damping must be off DURING the tween');
    fakeNow = 1000;
    host.transitions.tick();
    assert.equal(host.orbit.enableDamping, true);
  });

  test('a tween pre-empted by a second one still gives damping back', () => {
    tween(host, POSE_A, { duration: 1000 });
    fakeNow = 300;
    host.transitions.tick();

    tween(host, POSE_B, { duration: 1000 });          // second preset clicked
    // Mid-flight the replacement owns damping, so it stays off …
    assert.equal(host.orbit.enableDamping, false, 'damping must be off DURING the second tween');
    fakeNow = 1300;
    host.transitions.tick();
    // … and once IT finishes, the user's setting is back.
    assert.equal(host.orbit.enableDamping, true,
      'damping was lost when the first tween was cancelled');
  });

  test('survives a whole burst of pre-emptions', () => {
    for (let i = 0; i < 8; i++) {
      tween(host, i % 2 ? POSE_A : POSE_B, { duration: 1000 });
      fakeNow += 120;
      host.transitions.tick();
    }
    fakeNow += 1000;
    host.transitions.tick();
    assert.equal(host.orbit.enableDamping, true);
  });

  test('the instant path does not leak the borrowed value either', () => {
    tween(host, POSE_A, { duration: 1000 });
    fakeNow = 200;
    host.transitions.tick();
    tween(host, POSE_B, { duration: 0 });             // clip camera mode "Snap"
    assert.equal(host.orbit.enableDamping, true);
    assert.equal(host.camera.position.x, 9, 'the snap must still commit its pose');
  });

  test('a user who turned damping OFF keeps it off', () => {
    // Anti-overcorrection guard: the fix must restore the SNAPSHOT, not force true.
    host.orbit.enableDamping = false;
    tween(host, POSE_A, { duration: 1000 });
    fakeNow = 400;
    host.transitions.tick();
    tween(host, POSE_B, { duration: 1000 });
    fakeNow = 1400;
    host.transitions.tick();
    assert.equal(host.orbit.enableDamping, false);
  });
});
