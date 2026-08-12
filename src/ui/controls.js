// ── Controls bindings ──────────────────────────────────────────────────────
// Panel controls: shape/gpu/color/mode/deform selects, audio sliders, camera
// buttons, fullscreen, keyboard-drag, track overlay,
// preset-name input, ctrl-collapse, touch swipe, model import, transport,
// playlist, beat ring, escape-close-modals, hotkey hint.
//
// Called once from UIController.bindAll().

import { DOM } from '../dom.js';
import { bindParamSliders, resetParamsToDefault, PARAMS, applyParam, COLOR_SCHEME_COUNT } from '../params.js';
import { bindAboutModal, ABOUT_OVERLAY_ID } from './about-modal.js';
import { AutoCycler } from './auto-cycle.js';

export function bindControls(ui) {
  const a   = ui.audio;
  const r   = ui.render;
  const cam = ui.camera;
  const se  = ui.shaderEditor;
  const ml  = ui.modelLoader;
  const ctx = { audio: a, render: r, camera: cam };

  // ── Beat ring flash — no reflow, uses Web Animations API ────────────────
  const _beatRing = DOM.beatRing;
  const _flashRing = () => {
    _beatRing.classList.remove('flash');
    _beatRing.getAnimations?.().forEach(anim => anim.cancel());
    _beatRing.classList.add('flash');
  };
  a.cb.onBeat = _flashRing;

  // ── Transport ─────────────────────────────────────────────────────────────
  document.getElementById('play-btn').addEventListener('click',  () => a.togglePlay());
  document.getElementById('prev-btn').addEventListener('click',  () => a.prevTrack());
  document.getElementById('next-btn').addEventListener('click',  () => a.nextTrack());
  document.getElementById('pl-clear').addEventListener('click',  () => { a.clearPlaylist(); ui.renderPL(); });
  document.getElementById('pl-drop') .addEventListener('click',  () => document.getElementById('audio-file').click());
  document.getElementById('audio-file').addEventListener('change', e => { if (e.target.files.length) a.addFiles(e.target.files); });
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop',     e => { e.preventDefault(); if (e.dataTransfer.files.length) a.addFiles(e.dataTransfer.files); });

  // ── Seek ──────────────────────────────────────────────────────────────────
  document.getElementById('seek-track').addEventListener('click', e => {
    const pct = (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.offsetWidth;
    a.seek(pct);
  });

  // ── Shape / mode selects ──────────────────────────────────────────────────
  document.getElementById('shape-sel').addEventListener('change', e => r.setShapeAnimated(e.target.value));

  // ── Surface material (studio-env reflections) ─────────────────────────────
  // Global visual-style control — applies in every DEFORM mode (surface/
  // volume/collapse). But it's only meaningful on filled surfaces: in
  // WIRE / PTS viz modes the reconstructed normal is degenerate and
  // reflections look broken, so there the material is forced to Matte and
  // the whole dropdown is hidden. The previously-selected material is
  // remembered and restored when the user returns to SURF viz mode.
  const _matSel  = document.getElementById('surface-material-sel');
  const _matDesc = document.getElementById('surface-material-desc');
  const _matWrap = _matSel ? _matSel.closest('.cg') : null;  // the label+select container
  const _matDescriptions = {
    matte:  'Flat shaded — original look, no reflections',
    glossy: 'Soft lacquer sheen with gentle highlights',
    metal:  'Brushed metal with moving studio reflections',
    mirror: 'Sharp chrome — full environment reflection',
    velvet: 'Matte fabric with soft fresnel rim, no glints',
    glass:  'Translucent edge-reflective, clear at center',
  };
  // Material the user picked while in SURF — restored when they come back
  // from WIRE/PTS. Defaults to whatever the dropdown shows at boot.
  let _savedMaterial = _matSel ? _matSel.value : 'matte';

  // durationMs: undefined → the engine's default material fade; 0 → instant.
  // Boot and the WIRE/PTS force-to-Matte pass 0 (nothing to fade from, and a
  // fade in WIRE would show 700 ms of reflections off a degenerate normal);
  // every human-triggered change takes the fade.
  const _applyMat = (durationMs) => {
    if (!_matSel) return;
    const key = _matSel.value;
    if (_matDesc) _matDesc.textContent = _matDescriptions[key] ?? '';
    r.setSurfaceMaterialAnimated(key, { duration: durationMs });
  };
  if (_matSel) {
    // Wrapped rather than passed straight in: a listener is called with the
    // Event, which would land in `durationMs`. The AUTO countdown restarts on
    // the same beat — a hand-picked material earns a full period on screen
    // instead of being replaced by whatever was already half-counted.
    _matSel.addEventListener('change', () => { _applyMat(); ui.autoMaterial?.defer(); });
    _applyMat(0); // pick up the default (matte) on boot
  }

  // Called by the viz-mode buttons and by ui.syncVizModeUI (preset load).
  // SURF → restore saved material + show dropdown. WIRE/PTS → remember
  // current, force Matte, hide dropdown.
  //
  // FIX(#15, r2): `presetMaterial` is the snapshot's material and becomes the
  // REMEMBERED pick, not necessarily the active one. Writing it to the dropdown
  // after this call instead strands a mirror material in a hidden-dropdown WIRE
  // session and leaves _savedMaterial on the pre-preset pick. null = plain user
  // switch (stash whatever the dropdown shows).
  const _syncMaterialForVizMode = (vizMode, presetMaterial = null) => {
    if (!_matSel) return;

    // Decide what "the remembered material" is before touching the dropdown.
    // A snapshot may name a material this build doesn't ship; assigning an
    // unknown value to a <select> silently blanks it (the same trap
    // syncDeformUI guards for the volume formula), so an unknown key is
    // ignored and we fall back to the normal stash-the-current-pick rule.
    if (presetMaterial && Array.from(_matSel.options).some(o => o.value === presetMaterial)) {
      _savedMaterial = presetMaterial;
    } else if (vizMode !== 'surface' && _matSel.value !== 'matte') {
      // Entering WIRE / PTS by hand — stash the current pick (unless it's
      // already Matte from a previous WIRE/PTS visit).
      _savedMaterial = _matSel.value;
    }

    if (vizMode === 'surface') {
      if (_matWrap) _matWrap.style.display = '';
      // Restore the material the user (or the preset) had before switching away.
      _matSel.value = _savedMaterial;
      _applyMat();
    } else {
      // WIRE / PTS — force Matte and hide the dropdown. Instant: the material
      // is being taken away because it cannot be drawn correctly here, and a
      // fade would spend its whole length showing exactly that.
      _matSel.value = 'matte';
      _applyMat(0);
      if (_matWrap) _matWrap.style.display = 'none';
    }
  };

  // ── AUTO MATERIAL ─────────────────────────────────────────────────────────
  // The ⟳ AUTO toggle beside the material dropdown. Lives on `ui` so the two
  // other systems that need to know about it can ask: ClipPlayer (which stops
  // applying each preset's material while this is on) and RESET ALL.
  ui.autoMaterial = new AutoCycler({
    pool:      _matSel ? Array.from(_matSel.options).map(o => o.value) : [],
    current:   () => _matSel?.value,
    isPlaying: () => !!a.isPlaying,
    bpm:       () => a.estimatedBpm,
    // Material is forced to Matte and its dropdown hidden in WIRE/PTS, where
    // the reconstructed normal makes reflections nonsense. AUTO holds its
    // breath there and picks up again on the way back to SURF, rather than
    // switching itself off behind the user's back.
    //
    // FIX: this used to ask `_matSel.offsetParent !== null`, i.e. "is the row
    // on screen". offsetParent is null under any display:none ancestor, and
    // collapsing the panel — or just the ▸ VISUAL STYLE section — is one, so an
    // armed AUTO MATERIAL froze for as long as the panel stayed shut while AUTO
    // COLOUR kept running and nothing reported the stall. Clearing the view
    // mid-set is ordinary. The question is about the viz mode, so it is asked
    // of the engine.
    canFire:   () => !!_matSel && r.vizMode === 'surface',
    apply:     (key, ms) => { _matSel.value = key; _applyMat(ms); },
    // Twice the colour period. A finish change rewrites how the whole surface
    // reads, and on the colour cadence the two together strobe.
    bars: 16, idleMs: 20000,
    onToggle:  on => DOM.surfaceMaterialAuto?.classList.toggle('active', on),
  });
  DOM.surfaceMaterialAuto?.addEventListener('click', () => ui.autoMaterial.toggle());

  // ── Particle style (PTS viz mode) ─────────────────────────────────────────
  // The PTS counterpart of Surface Material, and the same rule in mirror image:
  // a point sprite only exists while POINTS is the mode, so the row is shown
  // there and hidden everywhere else. Unlike the material there is nothing to
  // force — outside PTS the style is simply not drawn, so the pick is kept as
  // it is and comes back with the mode (render.currentParticleStyle).
  const _ptsSel  = DOM.particleStyleSel;
  const _ptsDesc = DOM.particleStyleDesc;
  const _ptsWrap = DOM.particleStyleWrap;
  const _ptsDescriptions = {
    squares: 'Flat square sprites — the original look',
    dots:    'Small round particles with a soft edge',
    smoke:   'Small particles trailing a decaying smoke wake',
  };

  const _applyParticle = () => {
    if (!_ptsSel) return;
    const key = _ptsSel.value;
    if (_ptsDesc) _ptsDesc.textContent = _ptsDescriptions[key] ?? '';
    r.setParticleStyle?.(key);
  };
  if (_ptsSel) _ptsSel.addEventListener('change', _applyParticle);

  // Called by the viz-mode buttons and by ui.syncVizModeUI (preset load).
  // `presetStyle` is a snapshot's style; an unknown key is ignored rather than
  // assigned, because writing an unknown value to a <select> silently blanks it
  // — the same trap _syncMaterialForVizMode guards against.
  const _syncParticleForVizMode = (vizMode, presetStyle = null) => {
    if (!_ptsSel) return;
    if (presetStyle && Array.from(_ptsSel.options).some(o => o.value === presetStyle)) {
      _ptsSel.value = presetStyle;
    }
    if (_ptsWrap) _ptsWrap.style.display = vizMode === 'points' ? '' : 'none';
    // Always applied, not only in PTS: outside it the engine just files the
    // choice away (setParticleStyle returns early), which is what makes the
    // style survive a trip through SURF and come back with the mode.
    _applyParticle();
  };

  // The viz-mode button row. Declared here so the boot sync just below and
  // _setVizModeBtns further down share one list.
  const _vizBtns = ['surface','wireframe','points'];

  // Boot-time sync: the HTML default viz mode is wireframe (mode-wireframe
  // carries class="active"). Without this, the dropdown would show at boot
  // even though we're in WIRE. Read the active mode button and sync.
  //
  // FIX(#15, r3): ask the #mode-* buttons by id — `.mode-btns` wraps the deform
  // row too, so `.mode-btns .mbtn.active` picked by document order and would
  // read `deform-surface` as the viz mode if the sections were ever reordered.
  {
    const bootMode = _vizBtns.find(
      m => document.getElementById('mode-' + m)?.classList.contains('active')
    ) || 'wireframe';
    _syncMaterialForVizMode(bootMode);
    _syncParticleForVizMode(bootMode);
  }

  // ── Deform mode (Surface / Volume / Collapse) ─────────────────────────────
  //
  // Defined BEFORE the gpu-sel handler below so that handler can call
  // _setDeformMode('collapse') as part of the volume→collapse auto-switch
  // when a user picks an `m:` formula while in volume mode. See the
  // gpu-sel handler for the motivation. Without this ordering the call
  // would hit a temporal dead zone.
  const _deformBtns    = ['surface','volume','collapse'];
  const _volWrap       = document.getElementById('volume-formula-wrap');
  const _volSel        = document.getElementById('volume-formula-sel');
  const _volDesc       = document.getElementById('volume-formula-desc');

  const _volDescriptions = {
    breathe:       'Uniform expansion/contraction along surface normals',
    lorenzField:   'Classic chaotic attractor as displacement field',
    twist:         'Rotation around Y axis proportional to height',
    rippleVolume:  'Spherical wavefronts emanating from origin',
    magneticDipole:'B-field of a magnetic dipole at origin',
    fluidVortex:   'Incompressible vortex flow (curl field)',
  };

  // Set deform mode and update UI. `runFormula` (optional) is called inside
  // the same triggerMorphTransition that handles the mode switch, so an
  // auto-switch + formula change happens in one morph animation rather than
  // two competing ones. Without this, the gpu-sel handler doing setMode and
  // setFormula in separate morphs would fire deflate→inflate twice.
  const _setDeformMode = (mode, runFormula) => {
    _deformBtns.forEach(m => {
      const btn = document.getElementById('deform-'+m);
      if (btn) btn.classList.toggle('active', m === mode);
    });
    if (mode === 'volume') {
      _volWrap.style.display = '';
      const key = _volSel.value;
      _volDesc.textContent = _volDescriptions[key] ?? '';
      // Morph transition into volume mode
      r.triggerMorphTransition(() => {
        if (ui.mathViz) ui.mathViz.setVolumeFormula(key);
        if (runFormula) runFormula();
      });
    } else {
      _volWrap.style.display = 'none';
      // Morph transition into surface/collapse mode
      r.triggerMorphTransition(() => {
        if (ui.mathViz) ui.mathViz.setMode(mode);
        if (runFormula) runFormula();
      });
    }
  };

  /**
   * Apply a CPU (`m:`) formula, moving the deform panel with the engine.
   *
   * MathVisualizer.setFormula auto-exits volume mode — the 192 scalar formulas
   * have nothing to apply there — and the panel has to follow, or it describes
   * a mode the engine has left.
   *
   * FIX: this used to live inside the dropdown's change handler only, while the
   * R and F hotkeys called setFormula through their own path in main.js. So a
   * hotkey press in DEFORM: VOLUME moved the engine to Collapse and left
   * VOLUME highlighted with its formula row open — one click away from writing
   * a volume formula that no longer applies. Exposed on `ui` so the hotkeys use
   * the same one, which is what their own JSDoc already claims.
   *
   * @param {string}     colId  — collection id
   * @param {string}     key    — formula key
   * @param {function}   [onFlat] — extra work for the same flat frame (R's
   *                                shape swap: two morphs would cancel out)
   */
  ui.applyMathFormula = (colId, key, onFlat) => {
    const runFormula = () => {
      if (onFlat) onFlat();
      if (ui.mathViz) ui.mathViz.setFormula(colId, key);
    };
    const isVolumeActive = document.getElementById('deform-volume')?.classList.contains('active');
    if (isVolumeActive) {
      // Combined: switch mode AND apply formula inside one morph.
      _setDeformMode('collapse', runFormula);
      ui._showToast?.('Volume → Collapse · scalar formulas need a surface mode');
    } else {
      r.triggerMorphTransition(runFormula);
    }
  };

  document.getElementById('gpu-sel').addEventListener('change', e => {
    const val = e.target.value;
    if (val.startsWith('m:')) {
      // CPU math formula. The 192 m:-formulas are scalar fields (Z = f(x,y))
      // — they only fit Surface and Collapse modes. Volume mode uses a
      // separate 6-formula registry of vector fields (_volSel above).
      //
      // If we're currently in Volume mode and the user picks an m:-formula,
      // auto-switch to Collapse mode so the formula actually applies —
      // collapse runs the scalar formula along surface normals on the 3D
      // shape, which is the closest 3D-preserving rendering. Without this
      // auto-switch the formula change appeared to do nothing: setFormula
      // updates _formulaFn but _tickVolume only reads _volumeFn, so the
      // mesh kept showing the previous volume deformation.
      const [, colId, key] = val.split(':');
      ui.applyMathFormula(colId, key);
    } else {
      // GPU shader — deactivate math and switch uMode with crossfade.
      // FIX: same disclaimer as the R/F hotkeys in main.js — a formula still
      // queued for the next flat frame would re-arm the CPU path over the
      // shader, and the shader's displacement is gated on uMathMode == 0.
      r.cancelPendingMorph();
      if (ui.mathViz) ui.mathViz.deactivate();
      r.setGPUModeAnimated(+val);
    }
  });

  // ── Viz mode buttons ──────────────────────────────────────────────────────
  //
  // FIX(#15, r2): `.mbtn` is shared by three unrelated rows — viz mode
  // (#mode-*), deform (#deform-*) and the clip time base (#clip-mode-*). Toggle
  // only inside our own group: a blanket `.active` clear un-lights rows nobody
  // down the call path lights back up. (_vizBtns lives up by the boot sync.)
  const _setVizModeBtns = (mode) => {
    _vizBtns.forEach(m => {
      const btn = document.getElementById('mode-' + m);
      if (btn) btn.classList.toggle('active', m === mode);
    });
  };

  _vizBtns.forEach(mode => {
    document.getElementById('mode-'+mode).addEventListener('click', () => {
      _setVizModeBtns(mode);
      r.setVizModeGPU(mode);
      // Material is only meaningful on filled surfaces — force Matte and
      // hide the dropdown in WIRE/PTS, restore the saved material in SURF.
      _syncMaterialForVizMode(mode);
      // Mirror image for particles: their row belongs to PTS and nowhere else.
      _syncParticleForVizMode(mode);
    });
  });

  // ── Deform mode buttons ───────────────────────────────────────────────────
  _deformBtns.forEach(mode => {
    const btn = document.getElementById('deform-'+mode);
    if (btn) btn.addEventListener('click', () => _setDeformMode(mode));
  });

  // ── UI-sync adapters for applyState ───────────────────────────────────────
  //
  // FIX(#15): the mode helpers above are closures inside bindControls and so
  // invisible to presets.js applyState — hence two thin adapters on `ui`,
  // rather than widening those closures into module scope.
  //
  // Contract: UI ONLY. The caller has already applied the mode to the engine;
  // these must not re-drive it, or preset apply would stack a second morph
  // transition on the one already running. Both are null-safe so a stripped
  // HTML variant can't turn a preset load into a TypeError.

  /**
   * Mirror a deform mode into the panel: #deform-* active state,
   * #volume-formula-wrap visibility, #volume-formula-sel selection.
   * Does NOT call mathViz.setMode / setVolumeFormula.
   *
   * @param {'surface'|'volume'|'collapse'} mode
   * @param {string|null} volumeKey Volume formula id; only meaningful when
   *                                mode === 'volume'. Ignored otherwise.
   */
  ui.syncDeformUI = (mode, volumeKey = null) => {
    _deformBtns.forEach(m => {
      const btn = document.getElementById('deform-' + m);
      if (btn) btn.classList.toggle('active', m === mode);
    });
    if (mode !== 'volume') {
      if (_volWrap) _volWrap.style.display = 'none';
      return;
    }
    if (_volSel && volumeKey) {
      // Guard against a preset carrying a formula id this build doesn't ship:
      // assigning an unknown value to a <select> silently blanks it, which
      // would leave the picker empty and the description stale.
      const known = Array.from(_volSel.options).some(o => o.value === volumeKey);
      if (known) _volSel.value = volumeKey;
    }
    // Read back from the <select> so the description always describes what
    // the user can actually see selected.
    const key = _volSel ? _volSel.value : volumeKey;
    if (_volDesc) _volDesc.textContent = _volDescriptions[key] ?? '';
    if (_volWrap) _volWrap.style.display = '';
  };

  /**
   * Mirror a viz mode into the panel: the #mode-* active state plus the same
   * material show/hide/restore logic the mode buttons run.
   * Does NOT call r.setVizModeGPU.
   *
   * FIX(#15, r2): touches only the #mode-* row (via _setVizModeBtns) — the
   * deform and clip time-base rows share `.mbtn` and must keep their highlight.
   *
   * @param {'surface'|'wireframe'|'points'} mode
   * @param {string|null} material  Material key from the snapshot being applied.
   *   It becomes the remembered pick: shown immediately in SURF, restored on
   *   the way back from WIRE/PTS (where Matte stays forced). Omit for a plain
   *   UI refresh that must leave the material choice alone.
   * @param {string|null} particleStyle  Particle style from the same snapshot,
   *   for the PTS row. Same contract: omit to leave the current choice alone,
   *   and an unknown key is ignored rather than blanking the dropdown.
   */
  ui.syncVizModeUI = (mode, material = null, particleStyle = null) => {
    _setVizModeBtns(mode);
    // both no-op when their select is absent
    _syncMaterialForVizMode(mode, material);
    _syncParticleForVizMode(mode, particleStyle);
  };

  if (_volSel) {
    _volSel.addEventListener('change', () => {
      const key = _volSel.value;
      _volDesc.textContent = _volDescriptions[key] ?? '';
      // Morph on volume formula change too
      r.triggerMorphTransition(() => {
        if (ui.mathViz) ui.mathViz.setVolumeFormula(key);
      });
    });
  }

  // ── Audio sliders ─────────────────────────────────────────────────────────
  // Slider id, value display id, range and engine-write target all live in
  // params.js. bindParamSliders wires the <input> events for every entry
  // that declares a slider key.
  bindParamSliders(ctx);

  DOM.colorSel.addEventListener('change', e => {
    a.colorIdx = +e.target.value;
    r.setColorSchemeAnimated(+e.target.value);
    ui.autoColor?.defer();
  });

  // ── AUTO COLOUR ───────────────────────────────────────────────────────────
  // Same shape as AUTO MATERIAL above, over the palette pool. The write path
  // deliberately mirrors the Q/E/R hotkeys (audio.colorIdx + engine crossfade +
  // dropdown) rather than going through applyParam: applyParam would re-enter
  // PARAMS.colorIdx.set, which starts the crossfade again at its own default
  // duration and would undo the longer, cadence-scaled fade asked for here.
  ui.autoColor = new AutoCycler({
    pool:      Array.from({ length: COLOR_SCHEME_COUNT }, (_, i) => i),
    current:   () => a.colorIdx,
    isPlaying: () => !!a.isPlaying,
    bpm:       () => a.estimatedBpm,
    apply:     (idx, ms) => {
      a.colorIdx = idx;
      r.setColorSchemeAnimated(idx, { duration: ms });
      if (DOM.colorSel) DOM.colorSel.value = String(idx);
    },
    onToggle:  on => DOM.colorAuto?.classList.toggle('active', on),
  });
  DOM.colorAuto?.addEventListener('click', () => ui.autoColor.toggle());

  // ── Camera reset / auto-rot ───────────────────────────────────────────────
  DOM.btnReset.addEventListener('click', () => {
    r.camera.position.set(5.5, 4.2, 6.8);
    r.orbit.target.set(0, .1, 0);
    r.orbit.update();
  });

  // ── Reset ALL — hard reset to startup state ──────────────────────────────
  // Restores: shape (Pyramid Smooth), formula (Nonlinear Pendulum Phase),
  // viz mode (Wireframe) + material (Matte), color scheme (Amber, idx 16),
  // grid (OFF), camera (looking up at object's bottom), all sliders to
  // defaults, deform mode (surface), freeze-frame (off), custom shader
  // (cleared).
  //
  // FIX(#2/#28): the Amber line above only holds while PARAMS.colorIdx.default
  // is 16 — resetParamsToDefault() runs last and stomps the explicit write
  // below. Keep params.js, main.js and index.html's `selected` in agreement.
  DOM.btnResetAll.addEventListener('click', () => {
    // ── AUTO COLOUR / AUTO MATERIAL off ───────────────────────────────────
    // They are modes, not values, and this button means "back to the startup
    // state". Left armed, they would undo the reset a few seconds later — from
    // a control the user had forgotten was on.
    ui.autoColor?.disable();
    ui.autoMaterial?.disable();

    // ── Visual mode + shape + formula ─────────────────────────────────────
    // FIX(#15, r3): route the viz-mode reset through the same engine call + UI
    // adapter as every other mode switch. A blanket `.mbtn` clear here left the
    // clip time-base row dark, and setVizModeGPU alone left a mirror material
    // live in WIRE with its dropdown hidden. 'matte' also resets the remembered
    // SURF pick, which would otherwise outlive the reset — and 'squares' does
    // the same for the remembered PTS particle style.
    r.setVizModeGPU('wireframe');
    ui.syncVizModeUI('wireframe', 'matte', 'squares');

    r.setShapeAnimated('pyramid-smooth');
    DOM.shapeSel.value = 'pyramid-smooth';

    // CPU formula via morph transition (deflate → swap → inflate).
    // Shape swap and formula switch are combined in one morph callback so
    // they both apply at the flat frame.
    DOM.gpuSel.value = 'm:differentialEqs:pendulumNonLinear';
    r.triggerMorphTransition(() => {
      r.setShape('pyramid-smooth');
      if (ui.mathViz) ui.mathViz.setFormula('differentialEqs', 'pendulumNonLinear');
    });

    // Color scheme — Amber (option 16).
    // FIX(#2): duplicates what resetParamsToDefault() does below via
    // PARAMS.colorIdx.set — kept for the immediate visual response, before the
    // full param sweep. Source of truth is PARAMS.colorIdx.default; changing
    // the number only here would be silently undone by the sweep.
    a.colorIdx = 16;
    r.setColorSchemeAnimated(16);
    DOM.colorSel.value = '16';

    // Deform mode — surface. FIX(#15, r3): same split, engine call plus the
    // shared adapter, so this row can't drift from what _setDeformMode paints.
    if (ui.mathViz) ui.mathViz.setMode('surface');
    ui.syncDeformUI('surface');

    // Grid OFF.
    if (r.grid) r.grid.visible = false;
    DOM.btnToggleGrid.style.opacity = '0.45';

    // All registered params (amp, wave-int, bass/treble-sens, bloom, colorIdx,
    // rotSpeed) reset to their factory defaults declared in params.js.
    resetParamsToDefault(ctx);

    // ── Camera — bottom-up view of the object ─────────────────────────────
    // Position directly below origin, slight z-offset to avoid gimbal lock,
    // looking up at the object center.
    r.camera.position.set(0, -7, 0.001);
    r.orbit.target.set(0, 0, 0);
    r.camera.fov = 45;
    r.camera.updateProjectionMatrix();
    r.camera.up.set(0, 1, 0);
    r.orbit.update();

    // Auto-rotate starts OFF — the user opts in via the AUTO-ROTATE button.
    cam.setCamPhysics('dark_matter');
    cam.autoRot = false;
    cam.cb.onAutoRotChanged(false);

    // Reset camera programmer.
    cam.cpActive = false;
    cam.cpFn     = null;
    cam.cpKeyframes = [];
    cam.cpSelectedKf = null;
    cam.buildTimeline();

    // Custom shader cleared.
    if (se && (se.customVS || se.customFS)) {
      se.reset?.();
    }

    // Freeze-frame off — the freeze flag lives in main.js, so click through.
    if (DOM.btnFreezeFrame.textContent.includes('RESUME')) DOM.btnFreezeFrame.click();

    // Stop clip player if running.
    if (ui._clip?.playing) ui._clip.stop();

    // Clear auto-persisted state — without this, the next reload would
    // restore whatever was here before the reset.
    ui._clearPersisted?.();

    ui._showToast('⟳ Reset to defaults');
  });

  // ── Auto-rotate button — controls only the camera orbit ───────────────
  // Volume-formula time is paused by the STOP MOTION button (#btn-freeze-frame),
  // not here, so 'twist' and friends keep evolving while the camera is parked.
  const _syncAutoRot = () => {
    DOM.btnAr.textContent =
      cam.autoRot ? '↺ AUTO-ROTATE: ON' : '⏹ AUTO-ROTATE: OFF';
  };

  DOM.btnAr.addEventListener('click', () => {
    cam.autoRot = !cam.autoRot;
    _syncAutoRot();
    // Switching auto-rotate on by hand outranks the clip player's camera:
    // from here on its steps change the look but not the viewpoint, so a
    // Camera Programmer armed mid-clip keeps running past the next preset.
    // Switching it off hands the camera back. Both are no-ops when no clip
    // is playing (see ClipPlayer.claimCamera).
    if (cam.autoRot) ui._clip?.claimCamera(); else ui._clip?.releaseCamera();
  });
  // Orbit user interaction
  let autoRotTimer = null;
  r.orbit.addEventListener('start', () => {
    cam.userInt = true;
    if (cam.autoRot) {
      clearTimeout(autoRotTimer);
      // Dragging the view kills auto-rotate — same end state as the button,
      // so the clip player takes its camera back here too.
      autoRotTimer = setTimeout(() => {
        cam.autoRot = false;
        _syncAutoRot();
        ui._clip?.releaseCamera();
      }, 500);
    }
  });
  r.orbit.addEventListener('end', () => {
    cam.userInt = false;
    clearTimeout(autoRotTimer);
  });

  // ── Controls panel collapse → floating button ────────────────────────────
  // Note: declared early so _enterFS / _exitFS can capture `panel` via closure.
  const panel       = document.querySelector('.controls-panel');
  const collapseBtn = document.getElementById('ctrl-collapse');

  let ctrlCollapsed = false;

  DOM.ctrlHeader.addEventListener('click', () => {
    ctrlCollapsed = !ctrlCollapsed;
    panel.classList.toggle('collapsed', ctrlCollapsed);
    collapseBtn.style.display = ctrlCollapsed ? 'none' : '';
  });

  // ── Enhanced fullscreen mode ──────────────────────────────────────────────
  let _fsActive = false;

  // FIX: hide the panel only once the browser has actually gone fullscreen.
  // This used to fire the request, swallow any failure and hide the panel
  // regardless — and `fs-hidden` is `opacity:0;pointer-events:none`, with
  // #btn-fullscreen (the control that would undo it) living inside that very
  // panel. So where the request cannot succeed — no requestFullscreen at all,
  // which is the case the optional chaining was there for, or a promise
  // rejected by an iframe without allow="fullscreen" — no `fullscreenchange`
  // ever arrives either, and the entire panel stayed invisible and unclickable
  // for the rest of the session. Nothing else could bring it back.
  const _enterFS = async () => {
    const req = document.documentElement.requestFullscreen;
    if (!req) {
      ui._showToast?.('⚠ Fullscreen is not available in this browser');
      return;
    }
    try {
      await req.call(document.documentElement);
    } catch (_) {
      // Refused by policy (embedded without allow="fullscreen") or by the user.
      ui._showToast?.('⚠ Fullscreen was refused by the browser');
      return;
    }
    panel.classList.add('fs-hidden');
    document.body.style.cursor = 'none';
    _fsActive = true;
    DOM.btnFullscreen.textContent = '✕ EXIT FULLSCREEN';
  };

  const _exitFS = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    panel.classList.remove('fs-hidden');
    document.body.style.cursor = '';
    _fsActive = false;
    DOM.btnFullscreen.textContent = '🖵 FULLSCREEN';
  };

  DOM.btnFullscreen.addEventListener('click', () => {
    _fsActive ? _exitFS() : _enterFS();
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && _fsActive) _exitFS();
  });

  // ── Keyboard-drag slider control (works in fullscreen AND normal mode) ──
  // Hold key + drag mouse/touchpad horizontally to adjust the mapped param.
  //
  // Each entry maps a key to a PARAMS id. min/max for the drag interaction
  // come from PARAMS[id] — using extendedMax as the ceiling so the drag can
  // push the value beyond the slider's visible HTML max. applyParam handles
  // engine write + slider grow + display sync uniformly, so the slider
  // remains a usable fine-tuner after an extension instead of clamping back.
  //
  // Two key letters per param — original L/K/J/N/B (right side of the
  // keyboard, easy reach for a right-handed mouse user) plus aliases
  // Z/X/V/C/A (left side, easier when the right hand is on a mouse and
  // the left wants to grab a parameter without crossing over). Both map
  // to the same param via PARAMS[id], so there's no duplicated state and
  // adding more aliases later is a one-line change here.
  //
  // Why min uses Math.max(p.min, 0.1): some PARAMS allow min=0 (bassSens,
  // trebleSens, bloom) but hold-and-drag at exactly 0 makes the
  // visualizer go silent, which feels broken mid-performance. 0.1 keeps a
  // sliver of motion. PARAMS.min stays at 0 for MIDI / preset / reset paths.
  // FIX(#28): waveInt is not in that list — params.js declares min 0.3
  // (aligned with the index.html slider), so the clamp never moves it.
  const _fsParams = {
    // Right-hand cluster (original)
    'l': 'bassSens',
    'k': 'trebleSens',
    'j': 'amp',
    'n': 'waveInt',
    'b': 'bloom',
    // Left-hand cluster (aliases)
    'x': 'bassSens',
    'z': 'trebleSens',
    'v': 'amp',
    'c': 'waveInt',
    'a': 'bloom',
  };
  let _dragKey = null;

  document.addEventListener('keydown', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    const key = e.key.toLowerCase();
    if (_fsParams[key]) { _dragKey = key; e.preventDefault(); }
  });
  document.addEventListener('keyup', e => {
    if (e.key.toLowerCase() === _dragKey) _dragKey = null;
  });
  // ── NOTE on touchpad freezing while a drag key is held ────────────────
  // All three desktop OSes ship "disable touchpad while typing" enabled
  // by default. JavaScript cannot override this — it happens before the
  // input event ever reaches the browser. Affected users have OS-level
  // remedies; external USB mouse / wheel handler below are unaffected.
  //
  //   Windows  — Touchpad PalmCheck (Synaptics/ELAN/Precision drivers).
  //              Settings → Bluetooth & devices → Touchpad → Taps →
  //              "Touchpad sensitivity" → Most sensitive.
  //              Or vendor driver panel → Palm Check / Tracking → Off.
  //
  //   Linux    — libinput "Disable While Typing" (DWT).
  //              GNOME:  Settings → Mouse & Touchpad → Disable while typing → OFF
  //              CLI:    gsettings set org.gnome.desktop.peripherals.touchpad \
  //                          disable-while-typing false
  //              KDE:    Settings → Input Devices → Touchpad
  //              Hypr/Sway: input { disable_while_typing = false }
  //              libinput ≥1.31 also exposes an adjustable DWT timeout
  //              (100ms..5s) for users who want a shorter block window
  //              rather than a full disable.
  //
  //   macOS    — Built-in palm rejection, NO user-facing toggle since
  //              Mavericks. The old "Ignore accidental trackpad input"
  //              setting was removed when it became always-on. There is
  //              no clean fix; use an external mouse or external Magic
  //              Trackpad (smart-pairing exempts external pointing
  //              devices from the typing-induced block).
  // ── Delta dispatch — shared by mouse and touchpad inputs ──────────────
  // Pulled out of the mousemove listener so wheel/touchpad events can
  // drive the same speed-scaling math without duplication.
  //
  // Drag speed adapts to the live value but with log-bounded growth, NOT
  // strict proportionality. Strict proportionality (spd = |cur|/600) is
  // a self-reinforcing loop: each pixel of drag scales with current
  // value, which grows, which scales the next pixel, which grows... a
  // fast sustained drag can hit 1e+20 in a second.
  //
  // Two-regime sensitivity, matching MIDI relative dispatch:
  //   • Normal range (|cur| ≤ extendedMax): 600 px = full sweep of
  //     [min..extendedMax]. Standard slider feel for routine use.
  //   • Extended range (|cur| > extendedMax): speed grows with
  //     log₂(|cur| / extendedMax + 1). Reaching 1e+27 by drag is
  //     mathematically infeasible — multiplier grows logarithmically
  //     while value grows linearly with the drag.
  const _applyDragDelta = (id, pixels) => {
    const p = PARAMS[id];
    if (!p) return;
    const hi        = p.extendedMax ?? p.max;
    const lo        = Math.max(p.min, 0.1);
    const cur       = p.get(ctx);
    const spdBase   = (hi - lo) / 600;
    const absVal    = Math.abs(cur);
    const overshoot = absVal > hi ? absVal / hi : 1;
    const mult      = overshoot > 1 ? Math.log2(overshoot + 1) : 1;
    const spd       = spdBase * mult;
    const v         = Math.max(lo, cur + pixels * spd);
    applyParam(ctx, id, v);
  };

  document.addEventListener('mousemove', e => {
    if (!_dragKey) return;
    _applyDragDelta(_fsParams[_dragKey], e.movementX);
  });

  // ── Touchpad / wheel support ──────────────────────────────────────────
  // Two-finger swipe on a touchpad and mouse-wheel both fire `wheel`
  // events. We map them to the same drag system so users without a
  // physical mouse can still operate hold-and-drag parameters.
  //
  // Axis pick: deltaX is the natural choice (horizontal swipe = horizontal
  // drag intent). When deltaX is zero — e.g. a traditional vertical mouse
  // wheel without horizontal capability — we fall back to deltaY so the
  // user gets *some* control. Sign of deltaY is inverted: scrolling UP
  // increases value (matches the convention of right-drag = up).
  //
  // Step normalisation: wheel `deltaMode` can be PIXEL (0), LINE (1) or
  // PAGE (2). Most touchpads send pixels; some mice send lines. We
  // convert lines (~16px) and pages (~400px) to pixels so the
  // _applyDragDelta math stays consistent across input devices.
  //
  // preventDefault on the wheel event stops the page from scrolling
  // while the user is holding a drag key — otherwise the panel scrolls
  // around as a side effect of trying to adjust amplitude.
  document.addEventListener('wheel', e => {
    if (!_dragKey) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16   // lines → ~one text row in px
              : e.deltaMode === 2 ? 400  // pages → ~one screen height
              : 1;                       // pixels (default for touchpads)
    // Prefer horizontal axis when present; otherwise use vertical (inverted
    // so up = positive, matching right-drag convention).
    const dx = e.deltaX !== 0 ? e.deltaX * unit : -e.deltaY * unit;
    _applyDragDelta(_fsParams[_dragKey], dx);
  }, { passive: false }); // passive:false required to call preventDefault

  // ── Track name overlay ────────────────────────────────────────────────────
  const _overlayChk  = document.getElementById('show-track-name');
  const _overlayEl   = document.getElementById('track-overlay');
  const _overlayName = document.getElementById('track-overlay-name');
  let   _overlayTimer = null;

  const _showOverlay = name => {
    if (!_overlayChk?.checked || !name) return;
    if (_overlayName) _overlayName.textContent = name;
    if (_overlayEl) {
      _overlayEl.style.opacity = '0';
      _overlayEl.style.display = 'flex';
      // Force reflow then fade in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { _overlayEl.style.opacity = '1'; });
      });
      clearTimeout(_overlayTimer);
      _overlayTimer = setTimeout(() => {
        if (_overlayEl) _overlayEl.style.opacity = '0';
      }, 4000);
    }
  };

  a.cb.onTrackChange = name => _showOverlay(name);
  if (_overlayChk) {
    _overlayChk.addEventListener('change', () => {
      if (!_overlayChk.checked && _overlayEl) {
        _overlayEl.style.opacity = '0';
      }
    });
  }

  // ── Import/Export & Preset save ───────────────────────────────────────────
  document.getElementById('btn-export').addEventListener('click', () => ui.exportSettings());
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('state-file').click());
  document.getElementById('state-file').addEventListener('change', e => {
    if (e.target.files[0]) { ui.importSettings(e.target.files[0]); e.target.value = ''; }
  });
  const presetNameInput = document.getElementById('preset-name');
  document.getElementById('btn-preset-save').addEventListener('click', () => {
    const name = presetNameInput?.value.trim();
    if (!name) { ui._showToast('⚠ Enter a preset name', true); return; }
    ui.savePreset(name);
    if (presetNameInput) presetNameInput.value = '';
  });
  if (presetNameInput) {
    presetNameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { document.getElementById('btn-preset-save').click(); }
    });
  }
  ui._renderPresets();

  // ── Model import ──────────────────────────────────────────────────────────
  const mdz = document.getElementById('model-drop-zone');
  const mfi = document.getElementById('model-file');
  mdz.addEventListener('click',  () => mfi.click());
  mfi.addEventListener('change', e => { if (e.target.files[0]) ml.load(e.target.files[0], (v,p,m)=>ui.setLoading(v,p,m), ()=>({ vs:se.customVS, fs:se.customFS })); });
  // FIX: ✕ CLEAR MODEL was revealed by every import and bound by nobody — an
  // imported model could not be removed for the rest of the session (clear()
  // was reached only from beforeunload). Clearing the file input too: without
  // it, picking the same file again fires no 'change' event, so the one way
  // back to the model would be dead as well.
  const bcm = document.getElementById('btn-clear-model');
  bcm.addEventListener('click', () => {
    ml.clear();
    document.getElementById('model-info').textContent = '';
    mfi.value = '';
    bcm.style.display = 'none';
  });
  mdz.addEventListener('dragover',  e => { e.preventDefault(); e.stopPropagation(); mdz.classList.add('drag-over'); });
  mdz.addEventListener('dragleave', () => mdz.classList.remove('drag-over'));
  mdz.addEventListener('drop',      e => { e.preventDefault(); e.stopPropagation(); mdz.classList.remove('drag-over'); if(e.dataTransfer.files[0]) ml.load(e.dataTransfer.files[0], (v,p,m)=>ui.setLoading(v,p,m), ()=>({ vs:se.customVS, fs:se.customFS })); });

  // ── Close any open modal on Escape ────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    ['shader-editor-overlay','cam-editor-overlay','audio-src-overlay','output-overlay', ABOUT_OVERLAY_ID].forEach(id => {
      document.getElementById(id)?.classList.remove('open');
    });
    // FIX: and out of fullscreen mode. The button that says "✕ EXIT
    // FULLSCREEN" is inside the panel fullscreen hides, so it can neither be
    // seen nor clicked — leaving the browser's own Escape as the only way back,
    // and that only restores the panel by way of `fullscreenchange`. This makes
    // the app's own state follow the same key, whether or not the event
    // arrives.
    if (_fsActive) _exitFS();
  });

  // ── About / documentation modal ──────────────────────────────────────────
  // Self-contained: own button, own overlay, own Escape entry above.
  // Content comes from `documents/*.md` via the vimathic-docs Vite plugin.
  bindAboutModal();

  // ── First-launch: auto-open About so the user discovers the docs ─────────
  // Flag lives in localStorage and is independent of the auto-persist state,
  // so RESET ALL doesn't reset this — once the user has seen the modal, the
  // intro tour is done for good.
  try {
    if (!localStorage.getItem('vimathic_about_seen')) {
      localStorage.setItem('vimathic_about_seen', '1');
      // Defer one frame so layout settles before the modal animates in.
      requestAnimationFrame(() => document.getElementById('btn-about')?.click());
    }
  } catch (_) {
    // localStorage unavailable (private mode, sandbox): skip the tour.
  }

  // ── Show hotkey hint briefly on load ──────────────────────────────────────
  setTimeout(() => {
    const h = document.getElementById('hotkey-hint');
    h.classList.add('visible');
    setTimeout(() => h.classList.remove('visible'), 3000);
  }, 1000);
}
