/**
 * VIMATHIC — Mathematical Music Visualizer
 * Copyright (c) 2026 S. Melentyev
 * Licensed under the MIT License — see LICENSE.txt
 * https://github.com/vimathic/vimathic
 */

// The state a first launch opens in — no saved session in this browser and
// the About tour not yet seen (presets.js, bootPersist). Taken from an export
// made in the app (STATE & PRESETS → EXPORT, vimathic_state_1795433269303.json,
// 23.11.2026) with two changes:
//   - the camera script is the gallery's own 🔄 Top Flip, by reference — the
//     export carried that preset's text byte for byte, and one copy cannot
//     drift from the other;
//   - the camera starts where that script starts, straight above the centre
//     (radius × 1.3 up, a hair off the axis), not where the export caught it
//     mid-cycle below — the tween lands there and the script carries on from
//     the same point instead of jumping to it.
// No shader text: hasCustom:false is the built-in program, and that branch of
// applyState never touches the editor's source.

import { CP_PRESETS } from '../camera.js';

const TOP_FLIP = CP_PRESETS.find(p => p.name.includes('Top Flip'));

/** A fresh copy on every call: applyState and the migrator may write to it. */
export function startupState() {
  return {
    _version: 4,
    shape: 'box',
    vizMode: 'points',
    material: 'matte',
    particleStyle: 'smoke',
    wireStyle: 'classic',
    gpuSelVal: '37',
    gpuMode: 37,
    deformMode: 'collapse',
    volumeKey: null,
    gridVisible: false,
    starsOn: false,
    nightly: true,
    bandCharacter: true,
    camera: {
      x: 0, y: 7.2 * 1.3, z: 0.001,
      tx: 0, ty: 0, tz: 0,
      fov: 45,
      physics: 'dark_matter',
      autoRot: true,
    },
    camScript: {
      active: true,
      code: TOP_FLIP.code,
      params: {
        rotSpeed: 0.00002, radius: 7.2, height: 3.2, gravity: 0.0004,
        bassReact: 1, damping: 0.996, fov: 45, roll: 0,
      },
      keyframes: [],
    },
    shader: { hasCustom: false },
    bassSens: 1.2,
    trebleSens: 1,
    amp: 8.233837008744876,
    waveInt: 1.5768333333333338,
    bloom: 1.002499999999999,
    colorIdx: 45,
    bandDepth: 0.1,
    k0: 0, k1: 0, k2: 0, k3: 0,
    detail: 0.5,
    phase: 0,
  };
}
