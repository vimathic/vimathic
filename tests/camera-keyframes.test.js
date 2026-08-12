// tests/camera-keyframes.test.js
//
// Contract test for keyframe deletion on the camera-programmer timeline.
//
// Run:
//   node --test tests/camera-keyframes.test.js
//
// ── The defect this pins ──────────────────────────────────────────────────────
// deleteKeyframe's own JSDoc promises "the given index in the sorted display
// order", and the click handler in ui/modals.js says the same thing out loud
// ("data-del is the sorted-list index, NOT the original cpKeyframes index").
// The implementation then spliced the RAW array, which is in insertion order:
// addKeyframeAtPlayhead only pushes, and every reader — _resolveKeyframe, the
// timeline renderer — sorts a copy instead of sorting in place.
//
// So the two orders agree only while the user happens to add keyframes in
// ascending time. Add one at 80% and then one at 20%, and the ✕ on the "20.0%"
// row deleted the 80% keyframe while the row clicked stayed on screen. Dragging
// a marker past its neighbour on the timeline bar reaches the same state without
// any seeking, because the drag writes kf.t and leaves the array order alone.
// There is no undo, and the keyframe's code is gone with it.
//
// Fixed on the engine side rather than in the UI: the documented contract is
// that the index is a display-order one, so the implementation is what had to
// move. Resolving through a sorted copy matches _resolveKeyframe, which already
// sorts per call for the same reason (small array, edits come from the editor).
//
// The control cases matter as much as the failing one. "Deletes by row when the
// orders already agree" passes both before and after the fix — it is there to
// show the assertions are not simply pinning "whatever the code does now", and
// that a fix which broke ordinary in-order deletion would be caught.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

let CameraSystem;
before(async () => { ({ CameraSystem } = await import('../src/camera.js')); });

function makeCam() {
  const camera = { position: { x: 0, y: 0, z: 0, set() {} }, fov: 45, updateProjectionMatrix() {} };
  const orbit  = { target: { x: 0, y: 0, z: 0, set() {} }, update() {} };
  return new CameraSystem(camera, orbit, { autoRotRadius: 7.2 });
}

/** The rows the user sees — exactly the expression ui/modals.js renders from. */
const rows = cam => [...cam.cpKeyframes].sort((a, b) => a.t - b.t);

/** Codes left in the array, in display order, for readable assertions. */
const remaining = cam => rows(cam).map(kf => kf.code);

describe('camera timeline — deleting a keyframe', () => {

  test('✕ on a row deletes that row, not the array slot with the same number', () => {
    const cam = makeCam();
    cam.addKeyframeAtPlayhead('LATE',  0.80);   // added first  → cpKeyframes[0]
    cam.addKeyframeAtPlayhead('EARLY', 0.20);   // added second → cpKeyframes[1]

    assert.deepEqual(cam.cpKeyframes.map(kf => kf.code), ['LATE', 'EARLY'],
      'precondition: the array is in insertion order');
    assert.deepEqual(rows(cam).map(kf => kf.code), ['EARLY', 'LATE'],
      'precondition: the list is drawn sorted by t, so row 0 is EARLY');

    cam.deleteKeyframe(0);                      // the user clicks ✕ on "20.0%"

    assert.deepEqual(remaining(cam), ['LATE'],
      'the clicked row must be the one that goes');
  });

  test('a marker dragged past its neighbour still deletes what the row shows', () => {
    const cam = makeCam();
    cam.addKeyframeAtPlayhead('A', 0.10);
    cam.addKeyframeAtPlayhead('B', 0.90);
    // Timeline drag: ui/modals.js writes kf.t and leaves the array order alone.
    cam.cpKeyframes[0].t = 0.95;                // A is dragged past B

    assert.deepEqual(rows(cam).map(kf => kf.code), ['B', 'A'],
      'precondition: B now draws first');

    cam.deleteKeyframe(0);                      // ✕ on the first row, which is B

    assert.deepEqual(remaining(cam), ['A']);
  });

  test('control — deletes by row when insertion and display order already agree', () => {
    const cam = makeCam();
    cam.addKeyframeAtPlayhead('EARLY', 0.20);
    cam.addKeyframeAtPlayhead('LATE',  0.80);

    cam.deleteKeyframe(0);

    assert.deepEqual(remaining(cam), ['LATE']);
  });

  test('control — a single keyframe is removed by its only row', () => {
    const cam = makeCam();
    cam.addKeyframeAtPlayhead('ONLY', 0.5);

    cam.deleteKeyframe(0);

    assert.deepEqual(remaining(cam), []);
  });

  test('an index no row can produce removes nothing', () => {
    const cam = makeCam();
    cam.addKeyframeAtPlayhead('A', 0.2);
    cam.addKeyframeAtPlayhead('B', 0.6);

    cam.deleteKeyframe(2);    // past the end
    cam.deleteKeyframe(-1);   // splice() would read this from the end and eat B
    cam.deleteKeyframe(NaN);

    assert.deepEqual(remaining(cam), ['A', 'B']);
  });

  test('the selection is dropped only when the selected keyframe was the one deleted', () => {
    const cam = makeCam();
    cam.addKeyframeAtPlayhead('LATE',  0.80);
    cam.addKeyframeAtPlayhead('EARLY', 0.20);
    const late = cam.cpKeyframes.find(kf => kf.code === 'LATE');
    cam.cpSelectedKf = late;

    cam.deleteKeyframe(0);                      // deletes EARLY, keeps LATE
    assert.equal(cam.cpSelectedKf, late, 'a surviving selection stays selected');

    cam.deleteKeyframe(0);                      // now deletes LATE itself
    assert.equal(cam.cpSelectedKf, null, 'a deleted selection is cleared');
  });

  test('the timeline is repainted once per deletion', () => {
    const cam = makeCam();
    let painted = 0;
    cam.cb.onTimelineRender = () => { painted++; };
    cam.addKeyframeAtPlayhead('A', 0.2);
    painted = 0;

    cam.deleteKeyframe(0);

    assert.equal(painted, 1);
  });
});
