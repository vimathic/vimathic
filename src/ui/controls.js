// ── Controls bindings ──────────────────────────────────────────────────────
// Panel controls: shape/gpu/color/mode/deform selects, audio sliders, camera
// buttons, fullscreen, keyboard-drag, track overlay,
// preset-name input, ctrl-collapse, touch swipe, model import, transport,
// playlist, beat ring, escape-close-modals, hotkey hint.
//
// Called once from UIController.bindAll().

import { DOM } from '../dom.js';
import { bindParamSliders, resetParamsToDefault } from '../params.js';
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
  document.getElementById('gpu-sel').addEventListener('change', e => {
    const val = e.target.value;
    if (val.startsWith('m:')) {
      // CPU math formula — trigger same deflate→inflate morph as GPU mode change
      const [, colId, key] = val.split(':');
      r.triggerMorphTransition(() => {
        if (ui.mathViz) ui.mathViz.setFormula(colId, key);
      });
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

  const _setDeformMode = (mode) => {
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
      });
    } else {
      _volWrap.style.display = 'none';
      // Morph transition into surface/collapse mode
      r.triggerMorphTransition(() => {
        if (ui.mathViz) ui.mathViz.setMode(mode);
      });
    }
  };

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
  const _fsParams = {
    'l': { get: () => a.bassSens,           set: v => { a.bassSens   = v; const el=document.getElementById('bass-sens');   if(el)el.value=v; const lv=document.getElementById('bsv');   if(lv)lv.textContent=v.toFixed(2); },              min:0.1, max:3.0 },
    'k': { get: () => a.trebleSens,         set: v => { a.trebleSens = v; const el=document.getElementById('treble-sens'); if(el)el.value=v; const lv=document.getElementById('tsv');   if(lv)lv.textContent=v.toFixed(2); },              min:0.1, max:3.0 },
    'j': { get: () => a.amp,                set: v => { a.amp=v; r.U.uAmp.value=v; const el=document.getElementById('amplitude');   if(el)el.value=v; const lv=document.getElementById('ampv'); if(lv)lv.textContent=v.toFixed(2); },   min:0.1, max:2.0 },
    'n': { get: () => a.waveInt,            set: v => { a.waveInt=v; r.U.uWI.value=v; const el=document.getElementById('wave-int'); if(el)el.value=v; const lv=document.getElementById('wiv');  if(lv)lv.textContent=v.toFixed(2); },   min:0.1, max:3.0 },
    'b': { get: () => r.bloomPass.strength, set: v => { r.bloomPass.strength=v; const el=document.getElementById('bloom'); if(el)el.value=v; const lv=document.getElementById('blmv'); if(lv)lv.textContent=v.toFixed(2); },             min:0.0, max:2.0 },
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
  document.addEventListener('mousemove', e => {
    if (!_dragKey || !_fsParams[_dragKey]) return;
    const p   = _fsParams[_dragKey];
    const spd = (p.max - p.min) / 600;
    const v   = Math.max(p.min, Math.min(p.max, p.get() + e.movementX * spd));
    p.set(v);
  });

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

  // ── Touch swipe for track navigation ──────────────────────────────────────
  let tx = 0, ty = 0;
  document.body.addEventListener('touchstart', e => { if (e.target.closest('.controls-panel')) return; tx=e.touches[0].clientX; ty=e.touches[0].clientY; }, {passive:true});
  document.body.addEventListener('touchend',   e => { if (e.target.closest('.controls-panel')) return; const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty; if(Math.abs(dx)>80&&Math.abs(dx)>Math.abs(dy)*2){dx<0?a.nextTrack():a.prevTrack();} }, {passive:true});

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
