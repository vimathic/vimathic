// ── Controls bindings ──────────────────────────────────────────────────────
// Panel controls: shape/gpu/color/mode/deform selects, audio sliders, camera
// buttons, fullscreen, keyboard-drag, track overlay,
// preset-name input, ctrl-collapse, touch swipe, model import, transport,
// playlist, beat ring, escape-close-modals, hotkey hint.
//
// Called once from UIController.bindAll().

import { DOM } from '../dom.js';
import { bindParamSliders, resetParamsToDefault, PARAMS, applyParam } from '../params.js';
import { bindAboutModal, ABOUT_OVERLAY_ID } from './about-modal.js';

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
      const isVolumeActive = document.getElementById('deform-volume')?.classList.contains('active');
      if (isVolumeActive) {
        // Combined: switch mode AND apply formula inside one morph.
        _setDeformMode('collapse', () => {
          if (ui.mathViz) ui.mathViz.setFormula(colId, key);
        });
        ui._showToast?.('Volume → Collapse · scalar formulas need a surface mode');
      } else {
        r.triggerMorphTransition(() => {
          if (ui.mathViz) ui.mathViz.setFormula(colId, key);
        });
      }
    } else {
      // GPU shader — deactivate math and switch uMode with crossfade
      if (ui.mathViz) ui.mathViz.deactivate();
      r.setGPUModeAnimated(+val);
    }
  });

  // ── Viz mode buttons ──────────────────────────────────────────────────────
  ['surface','wireframe','points'].forEach(mode => {
    document.getElementById('mode-'+mode).addEventListener('click', () => {
      document.querySelectorAll('.mbtn').forEach(b => b.classList.remove('active'));
      document.getElementById('mode-'+mode).classList.add('active');
      r.setVizModeGPU(mode);
    });
  });

  // ── Deform mode buttons ───────────────────────────────────────────────────
  _deformBtns.forEach(mode => {
    const btn = document.getElementById('deform-'+mode);
    if (btn) btn.addEventListener('click', () => _setDeformMode(mode));
  });

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
  });

  // ── Camera reset / auto-rot ───────────────────────────────────────────────
  DOM.btnReset.addEventListener('click', () => {
    r.camera.position.set(5.5, 4.2, 6.8);
    r.orbit.target.set(0, .1, 0);
    r.orbit.update();
  });

  // ── Reset ALL — hard reset to startup state ──────────────────────────────
  // Restores: shape (Pyramid Smooth), formula (Nonlinear Pendulum Phase),
  // viz mode (Wireframe), color scheme (Amber, idx 16), grid (OFF),
  // camera (looking up at object's bottom), all sliders to defaults,
  // deform mode (surface), freeze-frame (off), custom shader (cleared).
  DOM.btnResetAll.addEventListener('click', () => {
    // ── Visual mode + shape + formula ─────────────────────────────────────
    document.querySelectorAll('.mbtn').forEach(b => b.classList.remove('active'));
    DOM.modeWireframe.classList.add('active');
    r.setVizModeGPU('wireframe');

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
    a.colorIdx = 16;
    r.setColorSchemeAnimated(16);
    DOM.colorSel.value = '16';

    // Deform mode — surface.
    if (ui.mathViz) ui.mathViz.setMode('surface');
    document.querySelectorAll('[id^="deform-"]').forEach(b => b.classList.remove('active'));
    DOM.deformSurface.classList.add('active');
    DOM.volumeFormulaWrap.style.display = 'none';

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
  });
  // Orbit user interaction
  let autoRotTimer = null;
  r.orbit.addEventListener('start', () => {
    cam.userInt = true;
    if (cam.autoRot) {
      clearTimeout(autoRotTimer);
      autoRotTimer = setTimeout(() => { cam.autoRot = false; _syncAutoRot(); }, 500);
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

  const _enterFS = () => {
    // Optional chaining covers older browsers and the jsdom test environment
    // where requestFullscreen is undefined.
    document.documentElement.requestFullscreen?.().catch(() => {});
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
  // trebleSens, bloom, waveInt) but hold-and-drag at exactly 0 makes the
  // visualizer go silent, which feels broken mid-performance. 0.1 keeps a
  // sliver of motion. PARAMS.min stays at 0 for MIDI / preset / reset paths.
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
  mdz.addEventListener('dragover',  e => { e.preventDefault(); e.stopPropagation(); mdz.classList.add('drag-over'); });
  mdz.addEventListener('dragleave', () => mdz.classList.remove('drag-over'));
  mdz.addEventListener('drop',      e => { e.preventDefault(); e.stopPropagation(); mdz.classList.remove('drag-over'); if(e.dataTransfer.files[0]) ml.load(e.dataTransfer.files[0], (v,p,m)=>ui.setLoading(v,p,m), ()=>({ vs:se.customVS, fs:se.customFS })); });

  // ── Close any open modal on Escape ────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    ['shader-editor-overlay','cam-editor-overlay','audio-src-overlay','output-overlay', ABOUT_OVERLAY_ID].forEach(id => {
      document.getElementById(id)?.classList.remove('open');
    });
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
