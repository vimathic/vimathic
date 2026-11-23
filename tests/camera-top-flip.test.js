// tests/camera-top-flip.test.js
//
// The "🔄 Top Flip" camera-programmer preset (owner's request, 23.11.2026):
// straight down from above at the centre, a slow turn about the axis, after
// 30 s a quick flip to the other side — straight up from below — 30 s there,
// and back.
//
// Run:
//   node --test tests/camera-top-flip.test.js
//
// The preset runs through the real CameraSystem.loadScript / runScript, with a
// stub camera and orbit carrying only what runScript reads and writes, and a
// hand-driven performance.now — the preset keeps time on the wall clock, which
// is the point of several tests below.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let CameraSystem, CP_PRESETS;
before(async () => { ({ CameraSystem, CP_PRESETS } = await import('../src/camera.js')); });

// A wall clock this file owns. Restored after, so no other file sees it.
const realNow = performance.now.bind(performance);
let wall = 0;
before(() => { performance.now = () => wall * 1000; });
after(() => { performance.now = realNow; });

const vec = (x, y, z) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } });

/** A CameraSystem running the preset, and a stepper reading the camera at a wall time. */
function rig() {
  const preset = CP_PRESETS.find(p => p.name.includes('Top Flip'));
  assert.ok(preset, 'the gallery has no Top Flip preset');
  const camera = { position: vec(5.5, 4.2, 6.8), fov: 45, updateProjectionMatrix() {}, rotateZ() {} };
  const orbit  = { target: vec(0, 0.1, 0), update() {} };
  const cam = new CameraSystem(camera, orbit, { autoRotRadius: 7.2 });
  wall = 1000;                                   // any start: the preset times from its own t0
  assert.equal(cam.loadScript(preset.code), true, 'the preset does not parse');
  cam.autoRot = true;                            // a script runs only with AUTO-ROTATE on
  const at = (seconds, time = 0) => {
    wall = 1000 + seconds;
    cam.runScript(time, 0, 0, 0, 0);
    const p = camera.position;
    return { x: p.x, y: p.y, z: p.z, h: Math.hypot(p.x, p.z), d: Math.hypot(p.x, p.y, p.z),
             az: Math.atan2(p.x, p.z), target: { ...orbit.target } };
  };
  at(0);                                         // the first tick fixes t0
  return { cam, at, D: cam.cpParams.radius * 1.3 };
}

describe('🔄 Top Flip', () => {
  test('starts straight above the centre, looking at it, a hair off the axis', () => {
    const { at, D } = rig();
    const c = at(1);
    assert.ok(Math.abs(c.y - D) < 1e-6, `not straight above: y ${c.y}`);
    assert.ok(c.h <= 0.0011 && c.h >= 0.0009, `${c.h} off the axis — exactly 0 leaves OrbitControls no azimuth`);
    assert.deepEqual([c.target.x, c.target.y, c.target.z], [0, 0, 0], 'not aimed at the centre');
  });

  test('turns slowly about the axis — one turn per TURN seconds', () => {
    const { at } = rig();
    const a = at(2).az, b = at(12).az;
    const turned = ((b - a) + 2 * Math.PI) % (2 * Math.PI);
    assert.ok(Math.abs(turned - (10 / 40) * 2 * Math.PI) < 1e-6, `10 s turned ${turned} rad`);
  });

  test('holds above for 30 s, flips fast, holds below for 30 s, flips back', () => {
    const { at, D } = rig();
    assert.ok(Math.abs(at(29.9).y - D) < 1e-6, 'left the top before 30 s');
    const mid = at(30 + 0.75);                    // halfway through the 1.5 s flip
    assert.ok(Math.abs(mid.y) < 0.05 * D, `mid-flip is not at the side: y ${mid.y}`);
    assert.ok(Math.abs(at(31.6).y + D) < 1e-6, 'not straight below once the flip is done');
    assert.ok(Math.abs(at(61.4).y + D) < 1e-6, 'left the bottom early');
    const back = at(61.5 + 0.75);
    assert.ok(Math.abs(back.y) < 0.05 * D, 'the way back does not pass the side');
    assert.ok(Math.abs(at(63.1).y - D) < 1e-6, 'not back on top after the second flip');
    assert.ok(Math.abs(at(63.1 + 29.9).y - D) < 1e-6, 'the cycle does not repeat');
  });

  test('the flip is quick: well under two seconds from top to bottom', () => {
    const { at, D } = rig();
    const ys = [];
    for (let t = 29.5; t <= 32.5; t += 0.05) ys.push([t, at(t).y]);
    const start = ys.find(([, y]) => y < D - 1e-6)?.[0];
    const end   = ys.find(([, y]) => y <= -D + 1e-6)?.[0];
    assert.ok(start !== undefined && end !== undefined, 'no flip in the window');
    assert.ok(end - start < 2, `the flip took ${end - start} s`);
  });

  test('stays at one distance from the centre the whole cycle, and never on the axis', () => {
    const { at, D } = rig();
    for (let t = 0; t < 64; t += 0.25) {
      const c = at(t);
      assert.ok(Math.abs(c.d - D) < 0.002, `${t} s: ${c.d} from the centre`);
      assert.ok(c.h >= 0.0009, `${t} s: on the axis`);
    }
  });

  test('keeps the wall clock: STOP MOTION (time held still) does not stop the camera', () => {
    const { at } = rig();
    const a = at(5, 7.0), b = at(6, 7.0);         // `time` frozen at 7.0, the wall clock moving
    assert.notEqual(a.az, b.az, 'the camera stood still with the formula clock');
  });

  test('re-applying the preset starts the cycle over on top', () => {
    const { cam, at, D } = rig();
    at(45);                                       // below
    cam.loadScript(CP_PRESETS.find(p => p.name.includes('Top Flip')).code);
    const restart = at(46);                       // the first tick after the reload is its t0
    assert.ok(Math.abs(restart.y - D) < 1e-6, 'a fresh load resumed mid-cycle instead of from the top');
  });
});
