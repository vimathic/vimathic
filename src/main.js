/**
 * VIMATHIC — Mathematical VJ Studio
 * Copyright (c) 2026 S. Melentyev. All rights reserved.
 * Licensed under BUSL-1.1 — see LICENSE.txt
 * https://github.com/vimathic/vimathic
 */

import { AudioEngine }  from './audio.js';
import { RenderEngine } from './render.js';
import { ShaderEditor, ModelLoader } from './shaders.js';
import { CameraSystem } from './camera.js';
import { UIController, ClipPlayer } from './ui/controller.js';
import { MIDIController, ShuffleBag } from './utils.js';
import { applyParam, syncParamUI, COLOR_SCHEME_COUNT, PARAMS } from './params.js';
import { OutputManager, SecondScreen } from './outputs.js';
import { GifRecorder, WebmRecorder } from './recorder.js';
import { MathVisualizer } from './math-visualizer.js';
import { getAllFormulasList } from './math-collections.js';
import { DOM } from './dom.js';

// ── App config ──────────────────────────────────────────────────────────────
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
const CFG = {
  planeSize: 7,
  planeSegs: isMobile ? 80 : 160,
  beatCooldown: 190,
  beatThreshold: 0.65,
  autoRotRadius: 7.2,
};

// ── Instantiate services ────────────────────────────────────────────────────
const audio  = new AudioEngine();
// Auto-load the bundled intro track on first load. Fire-and-forget: don't
// block init on the fetch. If the user has previously clicked Clear, this
// no-ops silently (see audio.js _loadIntroIfNeeded for the logic).
audio._loadIntroIfNeeded();
const render = new RenderEngine(isMobile, CFG);
const camera = new CameraSystem(render.camera, render.orbit, CFG);
const se     = new ShaderEditor(render);
const ml     = new ModelLoader(render);

const midi   = new MIDIController();
const ctx    = { audio, render, camera };

// MIDI → engine: one PARAMS lookup replaces the per-parameter switch.
// Adding a new mappable parameter is now a single-place change in params.js.
midi.cb.onParamSet = (id, val) => applyParam(ctx, id, val);

// Relative MIDI mode reads the current engine value before adding the
// delta. PARAMS[id].get is the canonical reader for every mappable
// parameter — same path preset capture uses. Returning 0 for unknown ids
// keeps the controller inert rather than NaN-propagating into engine state.
midi.cb.getParamValue = id => PARAMS[id]?.get(ctx) ?? 0;

const output      = new OutputManager(render.renderer);
const secondScreen = new SecondScreen(render.renderer);

// ── Recorders: GIF (with optional beat-sync) + WebM ────────────────────────
const gifRec  = new GifRecorder(render.renderer);
const webmRec = new WebmRecorder(render.renderer);

const mathViz = new MathVisualizer(render, audio);

// Wire RenderEngine shape changes into MathVisualizer's pristine-snapshot
// machinery. Fires after every geometry swap (R hotkey, D hotkey, panel
// dropdown, preset apply, clip-player, boot). Without this hook, changing
// shape while in Volume/Collapse mode left _basePositions stale and the
// next tick either bailed (no baseline) or displaced from the previous
// shape's coordinates. The hook also captures a fresh pristine reference
// that mode transitions restore from to start with clean geometry.
render.cb.onShapeChange = () => mathViz.onShapeChange();

// RenderEngine's constructor calls setShape('pyramid-smooth') before this
// callback was wired, so the very first shape (boot geometry) has no
// pristine snapshot yet. Trigger one now so the first mode-switch after
// boot has a valid restore source. Subsequent shape changes fire the
// callback synchronously via setShape.
mathViz.onShapeChange();

const ui = new UIController({
  audio, render, camera,
  shaderEditor:se, modelLoader:ml,
  midi, output, secondScreen, mathViz,
  gifRec, webmRec,
});
ui.bindAll();

const clip = new ClipPlayer(ui);
ui.bindClip(clip);

// ── Startup state ──────────────────────────────────────────────────────────
// HTML defaults: shape=pyramid-smooth, color=16 (Amber), mode=wireframe,
// gpu-sel=m:differentialEqs:pendulumNonLinear. The render constructor already
// applies the shape, color uniform and viz mode; here we activate the matching
// CPU formula so the very first frame shows the Pendulum phase portrait.
audio.colorIdx = 16;
mathViz.setFormula('differentialEqs', 'pendulumNonLinear');

// ── Auto-persist boot ──────────────────────────────────────────────────────
// Must run after the defaults above so a stored snapshot (if any) overrides
// them. bootPersist also installs the debounced save loop and the
// beforeunload flush, so from this point on the state survives reloads.
ui.bootPersist();

// ── Hotkeys ───────────────────────────────────────────────────────────────────
// ── Non-repeating randomization pools ────────────────────────────────────────
// Shared instances so 'R', 'Q', and 'F' never collide:
//   • _shapeBag    — shape pool for 'R'
//   • _colorBag    — color pool for 'R' and 'Q' (same instance; Q won't reproduce
//                    a color R just set, and vice versa)
//   • _formulaBag  — formula pool for 'R' and 'F' (same instance)
// Each bag deals every value once before reshuffling; the reshuffle guarantees
// the new top is not equal to the last drawn, so even at deck boundaries the
// caller never sees the same value twice in a row.
const SHAPES = ['plane','sphere','torus','torusknot','cylinder','cone','icosahedron','pyramid','box'];

const _shapeBag = new ShuffleBag(SHAPES);
// Color pool size sourced from params.js — single source of truth.
// Previously a local COLOR_COUNT=36 lived here, which was correct but invited
// drift if shaders.js gained another palette.
const _colorBag = new ShuffleBag(Array.from({ length: COLOR_SCHEME_COUNT }, (_, i) => i));

// Formula bag built once on first use. Compared by (collectionId, key)
// because getAllFormulasList() builds fresh objects each call — reference
// identity wouldn't survive a re-list, but ids are stable.
let _formulaBag = null;
function _getFormulaBag() {
  if (_formulaBag) return _formulaBag;
  const list = getAllFormulasList();
  if (!list.length) return null;
  _formulaBag = new ShuffleBag(
    list,
    (a, b) => a.collectionId === b.collectionId && a.key === b.key,
  );
  return _formulaBag;
}

// Pick and apply a random math formula from the full catalog.
function _randomFormula() {
  const bag  = _getFormulaBag();
  if (!bag) return;
  const pick = bag.next();
  render.triggerMorphTransition(() => {
    mathViz.setFormula(pick.collectionId, pick.key);
  });
  DOM.gpuSel.value = `m:${pick.collectionId}:${pick.key}`;
}

// ── D hotkey: sequential shape cycling ──────────────────────────────────
//
// Reads the list of available shapes from the live <select id="shape-sel">
// instead of mirroring it in a const here. Two reasons:
//   • Single source of truth — adding a new option in index.html is
//     instantly reachable via D, no JS edit needed.
//   • The select includes shapes outside the R-randomiser pool (Plane,
//     Disc, Ring, Star 3D, Solar System) that the user explicitly wants
//     D to cycle through.
//
// The list is captured once on first D press and cached. Subsequent
// HTML changes during a session won't be picked up — acceptable trade-
// off, since shape options are static in the bundled build. A page
// reload picks up any edits.
let _shapeCycle = null;
function _cycleShape() {
  if (!_shapeCycle) {
    _shapeCycle = Array.from(DOM.shapeSel.options).map(o => o.value);
  }
  if (!_shapeCycle.length) return;
  // Start from the current selection's index so the first D press moves
  // to the NEXT shape, not to whatever was first in the list. If the
  // current value isn't in the list (defensive — shouldn't happen),
  // indexOf returns -1 and (-1+1)%n = 0 lands on the first shape.
  const i    = _shapeCycle.indexOf(DOM.shapeSel.value);
  const next = _shapeCycle[(i + 1) % _shapeCycle.length];
  DOM.shapeSel.value = next;
  render.setShapeAnimated(next);
}

// ── T hotkey: sequential surface-material cycling ───────────────────────
//
// Same pattern as D for shapes — reads options from the live
// <select id="surface-material-sel">, steps to the next, loops.
//
// No-op when the material dropdown is hidden. The dropdown is hidden in
// WIRE/PTS viz modes (where reflections look degenerate, material is
// forced to Matte), so T does nothing there — matching the rule that
// materials are only meaningful on filled surfaces. Driving the change
// event re-runs controls.js's _applyMat so render.setSurfaceMaterial and
// the descriptor line update through the single existing path.
let _materialCycle = null;
function _cycleMaterial() {
  const sel = document.getElementById('surface-material-sel');
  if (!sel) return;
  // Hidden dropdown → materials unavailable (WIRE/PTS). Ignore the key.
  // offsetParent is null when the element or an ancestor is display:none.
  if (sel.offsetParent === null) return;
  if (!_materialCycle) {
    _materialCycle = Array.from(sel.options).map(o => o.value);
  }
  if (!_materialCycle.length) return;
  const i    = _materialCycle.indexOf(sel.value);
  const next = _materialCycle[(i + 1) % _materialCycle.length];
  sel.value = next;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

window.addEventListener('keydown', e => {
  if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  // Ignore auto-repeat keydown. Hotkeys here are single-action triggers
  // (D = next shape, F = random formula, R = randomise all, space = play/
  // pause), not held-state inputs. Without this filter, holding D would
  // cycle through 30+ shapes per second instead of one shape per tap.
  if (e.repeat) return;
  switch (e.key.toLowerCase()) {
    case ' ':          e.preventDefault(); audio.togglePlay(); break;
    case 'arrowleft':  e.preventDefault(); audio.prevTrack();  break;
    case 'arrowright': e.preventDefault(); audio.nextTrack();  break;

    // D — step to next shape in shape-sel order, looping.
    // Sibling of R (random shape) and F (random formula) for the user
    // who wants deterministic shape browsing during a set.
    case 'd': {
      _cycleShape();
      break;
    }

    // T — step to next surface material, looping. No-op in WIRE/PTS
    // (dropdown hidden, material forced to Matte there).
    case 't': {
      _cycleMaterial();
      break;
    }

    // F — random math formula from catalog (shuffle-bag, no repeats)
    case 'f': {
      _randomFormula();
      break;
    }

    // R — randomise everything: color scheme + shape + formula.
    // Each draw comes from a shared shuffle-bag, so values do not repeat
    // until the corresponding pool is exhausted. Shape swap and formula
    // change are combined into one morph callback so both apply at the
    // flat frame, instead of one cancelling the other.
    case 'r': {
      const shape    = _shapeBag.next();
      audio.colorIdx = _colorBag.next();
      render.setColorSchemeAnimated(audio.colorIdx);
      DOM.colorSel.value = audio.colorIdx;
      DOM.shapeSel.value = shape;

      const bag = _getFormulaBag();
      if (!bag) {
        // Formula list empty — just morph the shape.
        render.setShapeAnimated(shape);
        break;
      }
      const pick = bag.next();
      DOM.gpuSel.value = `m:${pick.collectionId}:${pick.key}`;
      render.triggerMorphTransition(() => {
        render.setShape(shape);
        mathViz.setFormula(pick.collectionId, pick.key);
      });
      break;
    }

    case 'q':
      audio.colorIdx = _colorBag.next();
      render.setColorSchemeAnimated(audio.colorIdx);
      DOM.colorSel.value = audio.colorIdx;
      break;
    case 'e':
      // Cycle forward through every defined scheme. Was hardcoded to %24,
      // which silently skipped schemes 24-35.
      audio.colorIdx = (audio.colorIdx + 1) % COLOR_SCHEME_COUNT;
      render.setColorSchemeAnimated(audio.colorIdx);
      DOM.colorSel.value = audio.colorIdx;
      break;
    case 'w': {
      camera.rotAngle += Math.PI;
      const r = CFG.autoRotRadius;
      render.camera.position.set(Math.sin(camera.rotAngle)*r, render.camera.position.y, Math.cos(camera.rotAngle)*r);
      render.orbit.update();
      break;
    }
    // G — fade grid in/out. Was 'C' historically; moved to G when C was
    // claimed by the hold-and-drag alias for Wave Intensity (see
    // controls.js _fsParams). Single-letter alias for 'grid'.
    case 'g': {
      const target = render.grid.visible ? 0 : 0.1;
      let t2 = 0;
      const fade = () => { t2+=.05; render.grid.material.opacity += (target-render.grid.material.opacity)*.2; if(t2<1) requestAnimationFrame(fade); else render.grid.visible=target>0; };
      fade();
      break;
    }
    case 'h': DOM.hotkeyHint.classList.toggle('visible'); break;

    // Note: the letters L K J N B V C A X Z are all reserved for hold-and-
    // drag parameter control (see controls.js _fsParams). They deliberately
    // have no tap-action — the drag handler owns them. Adding a tap-action
    // for any of them here would fight the drag arming via preventDefault.

    case 's': {
      e.preventDefault();
      render.triggerGlitch(200);
      // Capture original bloom only on the first press; subsequent presses
      // within the punch window reuse it so rapid taps don't accumulate.
      if (_bloomOrig === null) _bloomOrig = render.bloomPass.strength;
      clearTimeout(_bloomTimer);
      render.bloomPass.strength = Math.min(1.5, _bloomOrig + 0.8);
      _bloomTimer = setTimeout(() => {
        const v = _bloomOrig ?? 0.55;
        render.bloomPass.strength = v;
        syncParamUI('bloom', v);
        _bloomOrig  = null;
        _bloomTimer = null;
      }, 200);
      // Restart the beat-ring flash via Web Animations API — no layout reflow.
      const ring = DOM.beatRing;
      ring.classList.remove('flash');
      ring.getAnimations?.().forEach(a => a.cancel());
      ring.classList.add('flash');
      break;
    }
  }
});

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => render.onResize());

// ── Cleanup ───────────────────────────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  audio.dispose();
  ml.clear();
  output.stopAll();
  secondScreen.close();
  // Abort active recordings to release MediaRecorder streams + worker(s)
  if (gifRec.recording || gifRec.encoding) gifRec.abort();
  if (webmRec.recording)                    webmRec.abort();
  render.disposeCPUResources();
  mathViz.dispose();
});

// ── Freeze-frame & grid toggle ────────────────────────────────────────────────
let isFrozen = false;

// Bloom glitch: track original value so rapid S presses don't accumulate
let _bloomOrig  = null;
let _bloomTimer = null;

DOM.btnFreezeFrame.addEventListener('click', () => {
  isFrozen = !isFrozen;
  const btn = DOM.btnFreezeFrame;
  if (isFrozen) {
    btn.textContent = '▶ RESUME';
    btn.style.background = 'rgba(255,58,122,.22)';
  } else {
    btn.textContent = '⏸ STOP MOTION';
    btn.style.background = 'rgba(255,58,122,.08)';
  }
  // Pause/resume the volume-formula time accumulator. Volume formulas such
  // as 'twist' use `time` as their evolution parameter; without this they
  // would keep rotating even while the animate loop is frozen, because
  // mathViz.tick() is called every frame regardless of the freeze gate.
  mathViz?.setVolumeTimePaused?.(isFrozen);
});

DOM.btnToggleGrid.addEventListener('click', () => {
  render.grid.visible = !render.grid.visible;
  DOM.btnToggleGrid.style.opacity = render.grid.visible ? '1' : '0.45';
});

// Throttle uniform pushes: 30 fps on mobile, 60 fps on desktop.
const UNIFORM_INTERVAL = isMobile ? 33 : 16;

// Render-rate cap. On mobile we halve the rAF rate so the entire
// animate() body runs at ~30 fps (or ~60 on 120Hz ProMotion displays
// instead of 120). Audio analysis, math worker tick, and composer
// render all advance at this lower rate. Three observations:
//   • Beat detection runs on FFT windows of 1024–2048 samples (~20–
//     40Hz effective rate), so 30Hz analysis is more than enough.
//   • Math worker formulas are blended over multiple frames, so
//     halving the tick rate is visually imperceptible.
//   • GPU thermal load drops roughly in half — the dominant cost on
//     mobile devices, where the phone otherwise gets uncomfortably
//     hot during sustained use.
const RENDER_FRAME_SKIP = isMobile ? 2 : 1;
let renderFrameCounter = 0;

let time = 0, frames = 0, lastT = performance.now(), lastUniformUpdate = 0;

function animate() {
  requestAnimationFrame(animate);

  // Render-rate gate. Increment counter every rAF; only proceed with the
  // expensive composer pass when counter aligns with RENDER_FRAME_SKIP.
  // The early-return path still keeps the FPS counter updated below so
  // the operator sees the actual render rate (30 on mobile, 60 on desktop).
  renderFrameCounter++;
  if (renderFrameCounter % RENDER_FRAME_SKIP !== 0) return;

  // FPS counter ticks even while frozen, so the operator sees the engine alive.
  const now = performance.now();
  frames += 1;
  if (now - lastT >= 1000) {
    DOM.fps.textContent = frames;
    frames = 0; lastT = now;
    render.updatePerfMetrics();
  }

  // Freeze holds the last composed frame but skips audio analysis and updates.
  if (isFrozen) {
    render.composer.render();
    return;
  }

  time   += 0.008;

  // Audio analysis — updates bass/mid/treble/beatInt, fires seek + EQ callbacks.
  audio.update(time);

  // Sync detected BPM to camera programmer context.
  camera.estimatedBpm = audio.estimatedBpm;

  // Math formula CPU geometry update (when active).
  mathViz.tick(time);

  // Push audio values to GPU uniforms (throttled, see UNIFORM_INTERVAL).
  if (now - lastUniformUpdate >= UNIFORM_INTERVAL) {
    lastUniformUpdate = now;
    render.updateUniforms(time, audio);
  }

  // Lights + environment.
  render.updateLights(time, audio);
  render.updateSolarSystem(audio.bass);
  render.updateGlitch();

  // Camera.
  if (camera.autoRot && !camera.userInt) {
    if (camera.cpActive) {
      camera.setElapsedForKeyframe(audio.getElapsedFraction());
      camera.runScript(time, audio.bass, audio.mid, audio.treble, audio.beatInt);
    } else {
      camera.updatePhysics(time, audio.bass, audio.mid, audio.treble, audio.beatInt);
    }
  }

  // Update timeline playhead when the camera editor is open.
  if (DOM.camEditorOverlay.classList.contains('open')) {
    camera.updatePlayhead(audio.getElapsedFraction());
  }

  render.orbit.update();
  render.composer.render();
  output.tick();
}

animate();
