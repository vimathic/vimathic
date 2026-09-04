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
// COLOR_SCHEME_COUNT is deliberately NOT imported any more: every colour pick
// in this file now goes through a POOL (ALL_SCHEMES or NIGHT_SCHEMES), and a
// count in scope beside them is the thing that invites a fourth spelling of
// "how many palettes are there". ALL_SCHEMES.length is the same number.
import { applyParam, syncParamUI, NIGHT_SCHEMES, ALL_SCHEMES, nextInPool, PARAMS } from './params.js';
import { OutputManager, SecondScreen } from './outputs.js';
import { GifRecorder, WebmRecorder } from './recorder.js';
import { MathVisualizer } from './math-visualizer.js';
import { getAllFormulasList } from './math-collections.js';
import { FormulaPicker, isMathValue } from './formula-picker.js';
import { SHAPE_NAMES } from './shapes.js';
import { DOM } from './dom.js';
import { isAboutModalOpen } from './ui/about-modal.js';

// ── App config ──────────────────────────────────────────────────────────────
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
// FIX(#29): dropped beatCooldown / beatThreshold. They duplicated
// AudioEngine.BEAT_COOLDOWN / BEAT_FLOOR (audio.js — the second was called
// BEAT_THRESHOLD until round 11 turned it into a floor) but CFG is only ever
// handed to RenderEngine and CameraSystem — neither reads them, and the audio
// engine never sees CFG at all — so the values could silently drift from the
// ones actually used by the detector. audio.js owns them.
const CFG = {
  planeSize: 7,
  planeSegs: isMobile ? 80 : 160,
  autoRotRadius: 7.2,
};

// ── Instantiate services ────────────────────────────────────────────────────
const audio  = new AudioEngine();
// Auto-load the bundled intro track, but not before the first user gesture.
// Fire-and-forget when it does run: init never blocks on the fetch, and if the
// user has previously clicked Clear this no-ops silently (see audio.js
// _loadIntroIfNeeded for the logic).
//
// FIX: the wait is what makes the math worker arrive on time. The track is
// 3.9 MB pulled by fetch(), which Chromium gives priority High, while the
// module of a dedicated Worker is requested at VeryLow — and both travel the
// one HTTP/2 connection that also carried the document. On a narrow link the
// track starves math-worker-*.js outright: measured on a reporting machine,
// track 27.91s and worker 27.85s, finishing together. Fifteen of those seconds
// tripped the cold-start watchdog in math-visualizer.js, which then computed
// every surface frame on the main thread — the visible symptom was "the site
// opens slowly", and the cause was a download nobody was waiting for.
//
// Waiting costs nothing audible. loadPlay() reaches _startSource() through
// ensureCtx(), and an AudioContext created without a gesture stays suspended:
// the track could not be heard before one either way. That suspension is the
// "AudioContext was not allowed to start" warning this path already printed on
// every load.
//
// Deliberately no timeout fallback: a visitor who never touches the page never
// needs the track, and not spending 3.9 MB of their traffic is the point.
const INTRO_GESTURES = ['pointerdown', 'keydown'];
const loadIntroOnGesture = () => {
  for (const ev of INTRO_GESTURES) window.removeEventListener(ev, loadIntroOnGesture);
  audio._loadIntroIfNeeded();
};
for (const ev of INTRO_GESTURES) {
  window.addEventListener(ev, loadIntroOnGesture, { passive: true });
}
const render = new RenderEngine(isMobile, CFG);
const camera = new CameraSystem(render.camera, render.orbit, CFG);
const se     = new ShaderEditor(render);
const ml     = new ModelLoader(render);

const midi   = new MIDIController();
const ctx    = { audio, render, camera };

// MIDI → engine: one PARAMS lookup replaces the per-parameter switch.
// Adding a new mappable parameter is now a single-place change in params.js.
midi.cb.onParamSet = (id, val) => {
  applyParam(ctx, id, val);
  // A knob turn is a manual pick, so the AUTO COLOUR countdown restarts with
  // it — same rule as the dropdown and the hotkeys. Deferred here rather than
  // inside applyParam because only this site knows the write came from a
  // person: applyParam is also how a clip step and an autosave restore write,
  // and deferring on those would keep an armed AUTO from ever firing during a
  // clip. Same reason the preset path is deliberately left alone.
  if (id === 'colorIdx') ui.autoColor?.defer();
};

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

// A bloom punch that hands the value back moves the slider with it — the S
// hotkey used to write the engine and the panel by hand, from the key handler.
render.cb.onBloomRestored = v => syncParamUI('bloom', v);

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
//   • _colorPool   — the schemes 'Q', 'E' and 'R' may reach: the whole
//                    catalogue, or the NIGHT ten while that mode is on
//   • _colorBag    — the shuffled deck over _colorPool, for 'R' and 'Q' (same
//                    instance; Q won't reproduce a color R just set, and vice
//                    versa). 'E' walks the pool in order and needs no deck.
//   • _picker      — formula pool for 'R' and 'F' (same instance), covering
//                    BOTH families in #gpu-sel: GPU shaders and CPU formulas
// Each bag deals every value once before reshuffling; the reshuffle guarantees
// the new top is not equal to the last drawn, so even at deck boundaries the
// caller never sees the same value twice in a row.
// FIX: the shape pool WAS a nine-name literal here — plane, sphere, torus,
// torusknot, cylinder, cone, icosahedron, pyramid, box — and the other eleven
// shapes the picker offers could not be reached with R at all. Nothing recorded
// why those nine; the list simply stopped being extended as shapes were added,
// and shapes.js's own docblock names the hazard ("what keeps a fourth list from
// drifting in") without this being one of the three lists it checks. R now
// draws from the whitelist itself, so a shape added to the picker joins the
// randomiser by construction rather than by remembering.
const _shapeBag = new ShuffleBag(SHAPE_NAMES);
// Color pool sourced from params.js — single source of truth.
// Previously a local COLOR_COUNT=36 lived here, which was correct but invited
// drift if shaders.js gained another palette.
//
// The POOL is named as well as the bag, because the three colour hotkeys use it
// two different ways: Q and R take a shuffled draw from the bag, E steps to the
// next entry along. E used to step the CATALOGUE instead — see FIX(night) on
// its case below, which is the bug this pair of names exists to close.
let _colorPool = ALL_SCHEMES;
let _colorBag  = new ShuffleBag(_colorPool);

// NIGHT narrows Q, E and R to the NIGHT series. The pool lives here, so the mode
// asks for the swap rather than reaching in: ui.setNightly calls this hook, and
// controls.js does the same to its own AUTO COLOUR cycler.
//
// The bag is rebuilt, not filtered — a ShuffleBag's no-repeat guard is a dealt
// deck, and a deck holding schemes that just left the pool would keep dealing
// them until it emptied.
ui.onColorPoolChange = night => {
  _colorPool = night ? NIGHT_SCHEMES : ALL_SCHEMES;
  _colorBag  = new ShuffleBag(_colorPool);
};
// bootPersist() above may already have restored a snapshot with NIGHT on, back
// when this hook did not exist yet. Sync once so the pool matches the mode
// rather than matching the order of this file.
ui.onColorPoolChange(render.nightly);

// Formula pool, built once on first use and shared by R and F.
//
// FIX: the pool used to be getAllFormulasList() alone — the 192 CPU math
// formulas. #gpu-sel also carries 38 GPU shaders (numeric values), and they
// were not in the bag at all, so neither hotkey could ever land on one. Both
// families now go in; FormulaPicker (src/formula-picker.js) owns the split and
// the reasoning behind it.
//
// The GPU half is read from the live <select> rather than from a count in JS —
// same rule as the D and T hotkeys, so a shader added to index.html is
// reachable without touching this file. The CPU half stays on
// getAllFormulasList() because that is what setFormula() resolves against: a
// stale `m:` option in the HTML would name a formula the engine cannot find.
let _picker = null;
function _getPicker() {
  if (_picker) return _picker;
  const gpuValues = Array.from(DOM.gpuSel?.options ?? [])
    .map(o => o.value)
    .filter(v => v && !isMathValue(v));
  const p = new FormulaPicker({ gpuValues, cpuFormulas: getAllFormulasList() });
  if (p.isEmpty) return null;
  _picker = p;
  return _picker;
}

/**
 * Set the colour scheme the way the palette dropdown does — engine, the value
 * the dropdown shows, and the AUTO COLOUR countdown.
 *
 * FIX: Q, E and R each wrote those first two by hand and never deferred, so a
 * hand-picked palette could be crossfaded away a tenth of a second later if the
 * cycler happened to be near the end of its period — the app appearing to fight
 * the operator. AutoCycler's class doc states the invariant ("hotkeys, the
 * dropdown and preset loads all keep writing colour … defer() restarts the
 * countdown, so a manual pick gets its full period of screen time"); defer()
 * had exactly two call sites, both change handlers on a <select>.
 */
function _pickColorScheme(i) {
  audio.colorIdx = i;
  render.setColorSchemeAnimated(i);
  DOM.colorSel.value = i;
  ui.autoColor?.defer();
}

// Pick and apply a random formula — GPU shader or CPU formula.
function _randomFormula() {
  const picker = _getPicker();
  if (!picker) return;
  ui.applyFormulaValue(picker.next(DOM.gpuSel?.value));
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

window.addEventListener('keydown', e => {
  if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  // The About dialog is modal for the pointer and was not for the keyboard, so
  // space toggled playback and D changed the shape behind a reader's back — on
  // first run, where the modal opens itself. Escape still reaches its own
  // listener in controls.js, which is what closes this.
  if (isAboutModalOpen()) return;
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

    // T — step to next surface material, looping. No-op outside SURF, where
    // the finish is forced to Matte. The panel owns the rule; see
    // ui.cycleMaterial in controls.js.
    case 't': ui.cycleMaterial(); break;

    // F — random math formula from catalog (shuffle-bag, no repeats)
    case 'f': {
      _randomFormula();
      break;
    }

    // R — randomise everything: color scheme + shape + formula.
    // Each draw comes from a shared shuffle-bag, so values do not repeat
    // until the corresponding pool is exhausted. The shape swap rides in the
    // formula's morph callback when there is one (see ui.applyFormulaValue), so
    // both apply at the same flat frame instead of one cancelling the other.
    case 'r': {
      // Each bag is told what is on screen: the deck only remembers what IT
      // dealt, and D, E, the dropdowns, presets and clip steps all write these
      // same values — after any of those, a blind draw can hand back what is
      // already there and R looks like a dropped keypress.
      const shape = _shapeBag.next(render.currentShape);
      _pickColorScheme(_colorBag.next(audio.colorIdx));
      DOM.shapeSel.value = shape;

      const picker = _getPicker();
      if (!picker) {
        // No formulas and no shaders — just morph the shape.
        render.setShapeAnimated(shape);
        break;
      }
      ui.applyFormulaValue(picker.next(DOM.gpuSel?.value), () => render.setShape(shape));
      break;
    }

    case 'q':
      _pickColorScheme(_colorBag.next(audio.colorIdx));
      break;
    // E — step to the next scheme IN THE CURRENT POOL, looping. Was hardcoded
    // to %24, which silently skipped schemes 24-35; then to
    // %COLOR_SCHEME_COUNT, which is the whole catalogue.
    //
    // FIX(night): the catalogue was one mode too wide. NIGHT narrows what the
    // app picks unattended, and controls.js states the invariant in as many
    // words — narrowing one picker and not the other "would leave a bright
    // palette one keypress away from a mode whose whole claim is that it does
    // not do that". Q and R were narrowed through the shuffle bag; E was not,
    // and it is the one key that walks in a straight line: the mode opens on
    // scheme 44, so ten presses of "next colour" left the NIGHT ten and landed
    // on scheme 0, the brightest thing in the build. Nothing turned the mode
    // off on the way, so the room stayed dark and the picture did not.
    //
    // The step itself is nextInPool() in params.js, not an expression here —
    // this switch is the one place in the app no test can reach, and it is
    // where the rule was wrong. Its two edge cases (outside NIGHT the step is
    // bit-identical to the old line; a scheme the pool does not hold steps INTO
    // the pool) are documented and pinned there.
    case 'e':
      _pickColorScheme(nextInPool(_colorPool, audio.colorIdx));
      break;
    // W — flip to the other side of the subject. The camera system owns
    // rotAngle and the camera, so it owns the turn; see flipAzimuth().
    case 'w': camera.flipAzimuth(); break;
    // G — fade grid in/out. Was 'C' historically; moved to G when C was
    // claimed by the hold-and-drag alias for Wave Intensity (see
    // controls.js _fsParams). Single-letter alias for 'grid'.
    // FIX: the fade now lives on the engine that owns the grid. Keeping it
    // here meant the key handler owned grid.material.opacity while everything
    // else owned grid.visible, and the two drifted apart — see fadeGrid().
    case 'g': render.fadeGrid(!render.grid.visible); break;
    case 'h': DOM.hotkeyHint.classList.toggle('visible'); break;

    // Note: the letters L K J N B V C A X Z and S are all reserved for hold-
    // and-drag parameter control (see controls.js _fsParams). They deliberately
    // have no tap-action — the drag handler owns them. Adding a tap-action
    // for any of them here would fight the drag arming via preventDefault.
    //
    // S joined that list on 01.09 (it drives Spectrum Rings),
    // which is why the glitch below answers to Y and not to S any more.

    case 'y': {
      e.preventDefault();
      render.triggerGlitch(200);
      // The punch lives on the engine that owns bloom — see punchBloom. The
      // panel follows through onBloomRestored, wired beside the other engine
      // callbacks above.
      render.punchBloom();
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
// FIX(#50): frame stamp for the formula clock's dt. Deliberately separate from
// `lastT`, which is the FPS counter's one-second window and resets once a
// second — a dt taken from it would run the clock at 1/20th speed.
let lastFrameT = performance.now();

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

  // FIX(#50): formula time is measured, not counted. The old `time += 0.008`
  // per rendered frame tied the clock to the render rate: 0.24 units/s on the
  // mobile path, 0.48 on a 60 Hz desktop, 1.152 at 144 Hz — a ×9.6 spread
  // (and `isMobile` includes `innerWidth < 768` at load, so a desktop opened
  // in a narrow window sat at half speed for the whole session). Same class
  // of bug as the beatInt decay repaired in audio.js. Now the clock runs at
  // 0.48 units per real second on every path — exactly the old 60 Hz desktop
  // speed; the mobile path doubles, which is the fix, not a side effect.
  //   • The cap is 0.05·RENDER_FRAME_SKIP, not a bare 0.05: dt is taken after
  //     the gate, so a counted frame on the mobile path spans SKIP rAF
  //     intervals, and a fixed cap would shave every live frame below 40 Hz
  //     (−25 % at 30 Hz). The cap exists only to swallow the huge interval a
  //     backgrounded tab hands back on resume.
  //   • The 1e-4 floor is load-bearing: performance.now() is coarsened by
  //     browsers, dt = 0 is reachable and would mute the tick counter in
  //     math-collections.js.
  // Known gap, left deliberately: camera.updatePhysics and
  // render.updateSolarSystem still advance per call, so they keep the old
  // frame-rate dependence. Fixing only `time` also SPLITS one pair: the
  // cosmos camera's sin(time·k) wobble now runs in real time next to an
  // orbit angle and damper that stay per-call — before this fix the two
  // were consistently wrong together at every refresh rate. See
  // MATHEMATICAL_ACCURACY.md, "The clock".
  //
  // FIX(#8) still holds: the visual clock stops under freeze, the audio clock
  // does not. `lastFrameT` updates unconditionally so STOP MOTION stays an
  // exact hold — resuming continues from a one-frame dt instead of jumping by
  // the length of the freeze.
  const dt = Math.max(1e-4, Math.min(0.05 * RENDER_FRAME_SKIP, (now - lastFrameT) / 1000));
  lastFrameT = now;
  if (!isFrozen) time += dt * 0.48;

  // Audio analysis — updates bass/mid/treble/beatInt, fires seek + EQ callbacks.
  //
  // FIX(#8): hoisted ABOVE the freeze gate. STOP MOTION must freeze the
  // PICTURE, not the audio pipeline. Everything inside audio.update() that is
  // obliged to keep ticking lives here: _checkCrossfadeCleanup(), the beat
  // detector, _trackBpm() and _updateSeek(). Crossfade cleanup in particular is
  // polled on audioCtx.currentTime rather than scheduled with setTimeout
  // precisely so it cannot be starved (see audio.js _checkCrossfadeCleanup) —
  // freezing mid-crossfade used to leave the outgoing AudioBufferSourceNode and
  // both GainNodes connected and unstopped for the entire freeze, which is the
  // exact leak that polling design exists to prevent.
  //
  // Clock choice while frozen: pass the FROZEN `time`. Inside audio.update()
  // `time` reaches only the idle-LFO branch (the !isPlaying fallback that keeps
  // bass/mid/treble breathing when nothing is loaded); beat detection uses
  // Date.now(), BPM uses performance.now(), and seek + crossfade cleanup use
  // audioCtx.currentTime — none of them read `time`, so beat behaviour is
  // untouched. Holding `time` still leaves the idle animation exactly where the
  // freeze caught it, so resuming doesn't jump — same contract as the
  // mathViz.setVolumeTimePaused(isFrozen) call on the freeze button.
  audio.update(time);

  // The camera editor's playhead is a readout of the same audio clock as the
  // seek bar, not a visual effect — FIX: it sat below the freeze gate, so under
  // STOP MOTION the transport kept advancing while the timeline marker stood
  // still and "+ ADD KEYFRAME", which reads the live fraction, dropped its
  // keyframe where the marker was not.
  if (DOM.camEditorOverlay.classList.contains('open')) {
    camera.updatePlayhead(audio.getElapsedFraction());
  }

  // Freeze holds the last composed frame but skips the visual updates below.
  if (isFrozen) {
    render.composer.render();
    return;
  }

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

  // Camera. FIX(#13, r3): gate the script branch on camera.isScriptDriving()
  // rather than restating the condition here — camera.applyRoll() below reads
  // the same predicate, and the two must not disagree about whether it runs.
  if (camera.isScriptDriving()) {
    camera.setElapsedForKeyframe(audio.getElapsedFraction());
    camera.runScript(time, audio.bass, audio.mid, audio.treble, audio.beatInt);
  } else if (camera.autoRot && !camera.userInt && !camera.tweenHold) {
    // tweenHold: a preset or clip step is tweening the camera right now, and
    // physics writing position on the same frame would make the tween
    // invisible. It used to be expressed by switching autoRot off, which is
    // the user's own setting — see the flag's note in camera.js.
    camera.updatePhysics(time, audio.bass, audio.mid, audio.treble, audio.beatInt);
  }

  render.orbit.update();
  // FIX(#13, r2): the camera programmer's roll goes on HERE — after the frame's
  // last orbit.update(), whose lookAt() would erase it, and before the composer
  // pass. No-ops unless a script is driving the camera and asked for a roll.
  camera.applyRoll();
  render.composer.render();
  output.tick();
}

animate();
