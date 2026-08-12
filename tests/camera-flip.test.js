// tests/camera-flip.test.js
//
// Contract test for the W hotkey — "Flip camera 180° around its orbit", as
// documents/hotkeys.md puts it.
//
// Run:
//   node --test tests/camera-flip.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// The handler built a new position out of camera.rotAngle and the constant
// CFG.autoRotRadius (7.2), never reading where the camera actually was.
// rotAngle only moves inside updatePhysics, which is gated on
// `autoRot && !userInt`, and auto-rotate ships OFF — so in a default session
// rotAngle is permanently 0 and W did not flip anything relative to the current
// view. It threw the camera onto a circle of radius 7.2 at azimuth 180°, then
// back to 0° on the next press: two fixed poses, with the operator's zoom and
// angle destroyed each time. The orbit target was ignored too, so after panning
// the "flip" was not even around the thing being looked at.
//
// A flip is a reflection through the target's vertical axis: same distance,
// same height, opposite side. That is what this pins — and rotAngle still
// advances by π, so the physics loop resumes from the flipped side rather than
// swinging the camera back on its next tick.
//
// ── Why it moved out of main.js ───────────────────────────────────────────────
// The old code was inline in main.js's keydown switch, which no test can reach:
// importing main.js boots the entire app. The behaviour belongs to the system
// that owns rotAngle and the camera anyway.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

let CameraSystem;
before(async () => { ({ CameraSystem } = await import('../src/camera.js')); });

function makeCam(pos = { x: 5, y: 3, z: 5 }, target = { x: 0, y: 0, z: 0 }) {
  const camera = {
    fov: 45,
    position: { ...pos, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    updateProjectionMatrix() {},
    rotation: { z: 0 },
  };
  const orbit = {
    target: { ...target, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    updates: 0,
    update() { this.updates++; },
  };
  return { cam: new CameraSystem(camera, orbit, { autoRotRadius: 7.2 }), camera, orbit };
}

/** Distance from the orbit target in the ground plane — the operator's zoom. */
const radius = (camera, orbit) =>
  Math.hypot(camera.position.x - orbit.target.x, camera.position.z - orbit.target.z);

describe('W flips the camera around the point it is looking at', () => {

  test('the zoom and the height survive the flip', () => {
    const { cam, camera, orbit } = makeCam({ x: 14, y: 6, z: 0 });   // pulled far out
    const before = radius(camera, orbit);

    cam.flipAzimuth();

    assert.equal(camera.position.y, 6, 'height is not part of a 180° turn');
    assert.ok(Math.abs(radius(camera, orbit) - before) < 1e-9,
      `the flip must not rescale the orbit: ${before} → ${radius(camera, orbit)}`);
    assert.ok(Math.abs(camera.position.x + 14) < 1e-9, 'and it must land on the far side');
  });

  test('it flips around the orbit target, not around the origin', () => {
    // After panning, the thing on screen is at the target, not at (0,0,0).
    const { cam, camera, orbit } = makeCam({ x: 5, y: 3, z: 5 }, { x: 1, y: 0, z: -2 });

    cam.flipAzimuth();

    assert.ok(Math.abs(camera.position.x - (-3)) < 1e-9, `x: ${camera.position.x}`);
    assert.ok(Math.abs(camera.position.z - (-9)) < 1e-9, `z: ${camera.position.z}`);
    assert.equal(camera.position.y, 3);
    assert.deepEqual([orbit.target.x, orbit.target.z], [1, -2], 'the target itself does not move');
  });

  test('two flips return to where the camera started', () => {
    const { cam, camera } = makeCam({ x: 2.5, y: 1.25, z: -9 }, { x: 0.5, y: 0, z: 0.5 });

    cam.flipAzimuth();
    cam.flipAzimuth();

    assert.ok(Math.abs(camera.position.x - 2.5) < 1e-9);
    assert.ok(Math.abs(camera.position.z - (-9)) < 1e-9);
    assert.equal(camera.position.y, 1.25);
  });

  test('the physics loop resumes from the flipped side', () => {
    const { cam } = makeCam();
    cam.rotAngle = 0.4;

    cam.flipAzimuth();

    assert.ok(Math.abs(cam.rotAngle - (0.4 + Math.PI)) < 1e-9,
      'without this the next auto-rotate tick swings the camera straight back');
  });

  test('OrbitControls is told, so its internal spherical stays in step', () => {
    const { cam, orbit } = makeCam();
    cam.flipAzimuth();
    assert.ok(orbit.updates > 0);
  });
});
