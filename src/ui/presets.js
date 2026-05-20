// ── Preset / state management mixin ───────────────────────────────────────
// Methods that operate on a UIController instance — applied via Object.assign
// to UIController.prototype so they appear as instance methods.
//
// ClipPlayer calls ui.applyState() and ui._loadPresetList(), so these must
// live on the instance. Keeping them in a separate file keeps the controller
// from becoming a 1500-line monolith.

import { DOM } from '../dom.js';
import { PARAMS, applyParam } from '../params.js';

// Fields captured from PARAMS and restored via applyParam. Listed explicitly
// so adding a new param to params.js doesn't silently start writing into
// preset JSON until we've thought about migration.
const PARAM_FIELDS = ['bassSens', 'trebleSens', 'amp', 'waveInt', 'bloom', 'colorIdx'];

// ── Preset format version ─────────────────────────────────────────────────
// Bump this constant whenever captureState() changes the snapshot shape in
// a way that older code (or older JSON files) wouldn't read correctly.
//
// What counts as a breaking change vs additive change:
//   ADDITIVE (no bump needed): adding a new optional field. Old code that
//     doesn't know about it ignores it; new code reading old JSON treats it
//     as undefined and the existing `?? default` guards handle it.
//   BREAKING (bump): renaming a field, removing a field, changing the
//     semantics of an existing field's value (e.g. seconds → milliseconds),
//     moving a field between nested objects, splitting/merging fields.
//
// When you bump, add the matching `if (v < N)` block to migratePreset() that
// transforms the previous-version shape into the new one. Migration blocks
// run in sequence, so a v1 file picks up every block up to CURRENT.
export const CURRENT_PRESET_VERSION = 2;

/**
 * Normalize an incoming snapshot to the current schema version.
 * Returns the migrated object, or null if the input is unusable.
 *
 * Design notes — why a linear nested-if chain instead of a MIGRATIONS map:
 *   • At time of writing we have exactly one version in the wild (v2). A
 *     map indexed by version number is the same shape but with more
 *     ceremony around it.
 *   • If migrations multiply, each new `if (v < N)` block reads as a step
 *     in a transformation pipeline — no harder to follow than a map.
 *   • All migrations are pure object transforms; the function never touches
 *     the renderer / audio engine / DOM. That keeps it trivially testable
 *     with snapshot fixtures (see tests/preset-migrations.test.js if added).
 *
 * @param {object} s  raw snapshot, typically JSON.parse(fileText)
 * @returns {object|null}  snapshot whose _version === CURRENT_PRESET_VERSION,
 *                         or null if migration isn't possible
 */
export function migratePreset(s) {
  if (!s || typeof s !== 'object') return null;
  const v = s._version ?? 0;
  if (v < 1) return null;  // pre-versioned snapshots → reject (no known shape)

  // Forward compatibility: a file written by a newer build. We can't safely
  // transform forward (we don't know what changed), so try our luck reading
  // it as-is and warn. captureState's `?? default` guards plus getColor()'s
  // safe-default in shaders.js mean a "best effort" load is usually fine.
  if (v > CURRENT_PRESET_VERSION) {
    console.warn(
      `[preset] snapshot from newer build (v${v} > current v${CURRENT_PRESET_VERSION}). ` +
      `Loading as-is — some fields may be ignored.`,
    );
    return s;
  }

  // Migration chain. Add `if (v < N) s = {...transform...};` blocks as the
  // format evolves. Each block returns the next-version shape; the chain
  // composes naturally for older inputs (v1 → v2 → v3 → ...).
  //
  // Example for future use (left as a comment placeholder):
  //   if (v < 3) {
  //     // v3 renamed `gpuMode` (integer) to `gpuModeIdx` and removed `gpuSelVal`.
  //     s = { ...s, _version: 3, gpuModeIdx: s.gpuMode };
  //     delete s.gpuSelVal;
  //   }

  return s;
}

export const PresetMixin = {

  // ── State snapshot / restore ────────────────────────────────────────────
  /** Capture the complete visual + audio state as a plain serialisable object */
  captureState() {
    const r   = this.render;
    const cam = this.camera;
    const mv  = this.mathViz;
    const se  = this.shaderEditor;
    const ctx = { audio: this.audio, render: r, camera: cam };

    const state = {
      // Version stamp — read by migratePreset() on load. Sourced from
      // CURRENT_PRESET_VERSION so the writer can never drift from the reader.
      _version: CURRENT_PRESET_VERSION,

      // ── Visual ──────────────────────────────────────────────────────────
      shape:       r.currentShape,
      vizMode:     r.vizMode,
      material:    r.currentMaterial ?? 'matte',
      gpuSelVal:   DOM.gpuSel.value || String(r.U.uMode.value),  // e.g. "3" or "m:waves:standingWave"
      gpuMode:     r.U.uMode.value,                              // GPU integer mode (when not CPU)
      deformMode:  mv?._mode      ?? 'surface',
      volumeKey:   mv?._volumeKey ?? null,
      gridVisible: r.grid?.visible ?? true,

      // ── Camera ──────────────────────────────────────────────────────────
      camera: {
        x:       r.camera.position.x,
        y:       r.camera.position.y,
        z:       r.camera.position.z,
        tx:      r.orbit.target.x,
        ty:      r.orbit.target.y,
        tz:      r.orbit.target.z,
        fov:     r.camera.fov,
        physics: cam.camPhysics,
        autoRot: cam.autoRot,
      },

      // ── Camera programmer ───────────────────────────────────────────────
      camScript: {
        active:    cam.cpActive,
        code:      DOM.ceCode?.value ?? '',
        params:    { ...cam.cpParams },
        keyframes: cam.cpKeyframes.map(kf => ({ t: kf.t, code: kf.code })),
      },

      // ── Custom shader ───────────────────────────────────────────────────
      shader: {
        hasCustom: !!se.customVS,
        vert:      se._vert,
        frag:      se._frag,
      },
    };

    // Audio + bloom + color params are flat top-level fields for
    // backward compatibility with v1 preset JSON.
    for (const id of PARAM_FIELDS) state[id] = PARAMS[id].get(ctx);

    return state;
  },

  /**
   * Apply a state object (from captureState or loaded JSON).
   *
   * @param {object} s     — state snapshot
   * @param {object} [opts]
   * @param {number} [opts.cameraTransitionMs]
   *   Duration in ms for the camera position/target/fov tween.
   *   Default: r._tDurCamera (≈1000ms desktop, 600ms mobile).
   *   Pass 0 for an instant snap.
   *   Used by ClipPlayer to make scene-to-scene camera moves smooth.
   */
  applyState(s, opts = {}) {
    // Normalise via migratePreset first — handles unknown shape, version skew,
    // and future migration steps. migratePreset returns null for snapshots
    // too old/corrupt to use.
    s = migratePreset(s);
    if (!s) return;

    const r   = this.render;
    const cam = this.camera;
    const mv  = this.mathViz;
    const se  = this.shaderEditor;
    const ctx = { audio: this.audio, render: r, camera: cam };

    // ── Param fields (audio sensitivities, amp, wave-int, bloom, colorIdx) ──
    // applyParam keeps the slider + display in sync as a side effect.
    for (const id of PARAM_FIELDS) {
      if (s[id] != null) applyParam(ctx, id, s[id]);
    }

    // ── Other visual state ──────────────────────────────────────────────────
    if (s.gridVisible != null && r.grid) {
      r.grid.visible = s.gridVisible;
      DOM.btnToggleGrid.style.opacity = s.gridVisible ? '1' : '0.45';
    }
    if (s.vizMode) {
      r.setVizModeGPU(s.vizMode);
      document.querySelectorAll('.mbtn').forEach(b => b.classList.remove('active'));
      const mb = DOM.modeBtn(s.vizMode);
      if (mb) mb.classList.add('active');
    }

    // ── Surface material ───────────────────────────────────────────────────
    // Applied outside the morph block — it's a uniform push, no geometry
    // rebuild needed. Default 'matte' for presets saved before this field
    // existed (forward/backward compatible via the ?? guard).
    {
      const matKey = s.material ?? 'matte';
      const matSel = document.getElementById('surface-material-sel');
      if (matSel) {
        // Setting .value + dispatching change runs controls.js's _applyMat,
        // which calls render.setSurfaceMaterial and updates the descriptor.
        // Single source of truth for the apply path.
        matSel.value = matKey;
        matSel.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // No dropdown in this HTML variant — apply directly.
        r.setSurfaceMaterial?.(matKey);
      }
    }

    // ── Shape + Formula + Deform: single coordinated morph ──────────────────
    // All geometry/formula/mode changes are scheduled inside one onFlat
    // callback so they apply together at the flat frame of a single morph
    // animation. Scheduling them as separate calls would have each one
    // cancel the previous via transitions.start('morph-deflate', 0).
    const onFlatActions = [];

    if (s.shape) {
      DOM.shapeSel.value = s.shape;
      onFlatActions.push(() => r.setShape(s.shape));
    }

    if (s.gpuSelVal != null) {
      DOM.gpuSel.value = s.gpuSelVal;

      if (s.gpuSelVal.startsWith('m:')) {
        const [, colId, key] = s.gpuSelVal.split(':');
        onFlatActions.push(() => { if (mv) mv.setFormula(colId, key); });
      } else {
        // GPU shader mode — has its own crossfade (uModeBlend), doesn't need
        // to be inside the morph. Schedule it but NOT inside onFlat.
        if (mv) mv.deactivate();
        r.setGPUModeAnimated(+s.gpuSelVal);
      }
    }

    if (s.deformMode === 'volume' && s.volumeKey) {
      onFlatActions.push(() => { if (mv) mv.setVolumeFormula(s.volumeKey); });
    } else if (s.deformMode && s.deformMode !== 'surface') {
      onFlatActions.push(() => { if (mv) mv.setMode(s.deformMode); });
    } else if (s.deformMode === 'surface') {
      // Explicit surface mode — schedule restoration if mv was in volume/collapse.
      onFlatActions.push(() => { if (mv) mv.setMode('surface'); });
    }

    if (onFlatActions.length > 0) {
      r.triggerMorphTransition(() => { for (const fn of onFlatActions) fn(); });
    }

    // ── Camera ──────────────────────────────────────────────────────────────
    // Anything that drives the camera every frame (physics, programmer script)
    // must start AFTER our tween finishes, otherwise it overwrites
    // camera.position on the next animate() tick and the tween is invisible.
    const postTweenCameraActions = [];

    if (s.camera) {
      const c = s.camera;
      // Pause auto-rotate during the tween so the physics loop doesn't
      // fight with our position writes. Restore the previous state on done.
      const prevAutoRot = cam.autoRot;
      cam.autoRot = false;

      // Defer setCamPhysics — it sets autoRot=true internally, which makes
      // main.js call camera.updatePhysics() each frame and overwrite our
      // tweened position.
      if (c.physics) {
        postTweenCameraActions.push(() => cam.setCamPhysics(c.physics));
      }

      // Defer autoRot wish to AFTER setCamPhysics.
      if (c.autoRot != null) {
        postTweenCameraActions.push(() => {
          cam.autoRot = c.autoRot;
          cam.cb.onAutoRotChanged(c.autoRot);
        });
      } else if (!c.physics) {
        // No physics, no wish — restore pre-tween state at end.
        postTweenCameraActions.push(() => {
          cam.autoRot = prevAutoRot;
          cam.cb.onAutoRotChanged(prevAutoRot);
        });
      }

      r.tweenCameraTo(
        {
          pos:    { x: c.x,  y: c.y,  z: c.z  },
          target: { x: c.tx, y: c.ty, z: c.tz },
          fov:    c.fov,
        },
        {
          duration: opts.cameraTransitionMs,
          onDone: () => {
            // Physics first, then autoRot toggles, then programmer script.
            for (const fn of postTweenCameraActions) fn();
          },
        }
      );
    }

    // ── Camera programmer ───────────────────────────────────────────────────
    // Static parts (code text, params, keyframe list) apply immediately —
    // they don't drive camera position. But cam.loadScript() sets cpActive=true
    // which makes main.js call camera.runScript() each frame; that DOES drive
    // position. So we defer loadScript to the same post-tween bucket.
    if (s.camScript) {
      const cs = s.camScript;
      if (cs.code)   cam.cb.onSetCode(cs.code);
      if (cs.params) Object.assign(cam.cpParams, cs.params);
      cam.cpKeyframes = (cs.keyframes || []).map(kf => ({ t: kf.t, code: kf.code }));
      cam.cpSelectedKf = null;
      cam.buildTimeline();
      if (cs.active && cs.code) {
        if (s.camera) {
          // Camera tween in flight — defer script activation to onDone.
          postTweenCameraActions.push(() => cam.loadScript(cs.code));
        } else {
          // No camera tween — start script immediately.
          cam.loadScript(cs.code);
        }
      }
    }

    // ── Custom shader ───────────────────────────────────────────────────────
    if (s.shader?.hasCustom) {
      se._vert = s.shader.vert;
      se._frag = s.shader.frag;
      // Re-apply the custom shader via the compileAndApply path.
      if (DOM.seCode) DOM.seCode.value = se._tab === 'vert' ? se._vert : se._frag;
      se.compileAndApply();
    }
  },

  // ── Auto-persist: keep the full state in localStorage across page reloads ─
  // Key contract:
  //   PERSIST_KEY holds a JSON snapshot of captureState(). It uses the same
  //   schema as Export/Import, so migratePreset() handles version drift here
  //   too. Writes are debounced (DEBOUNCE_MS) to avoid hammering localStorage
  //   on every slider tick, with a final flush on beforeunload to catch the
  //   change the user just made before closing the tab.
  // Security:
  //   Same as Import — the snapshot may contain camScript.code. boot-time
  //   restore routes through _scrubImportedState() so auto-execution stays
  //   off. We do NOT prompt for the script-confirm modal on auto-restore
  //   because the user wrote that code themselves in this browser; the
  //   threat model is foreign JSON, not state they produced and saved.

  _persistKey: 'vimathic_persisted_state',

  /** Synchronous write of the current state. Called from debounce + beforeunload. */
  _persistNow() {
    try {
      const snapshot = this.captureState();
      localStorage.setItem(this._persistKey, JSON.stringify(snapshot));
    } catch (_) {
      // Quota exceeded, private-mode storage disabled, etc. — silent: the
      // app keeps working, the user just doesn't get auto-restore.
    }
  },

  /** Drop the persisted snapshot. Called from RESET ALL. */
  _clearPersisted() {
    try { localStorage.removeItem(this._persistKey); } catch (_) {}
  },

  /**
   * Boot-time entry point. Call exactly once after bindAll() and after the
   * initial defaults (audio.colorIdx, mathViz.setFormula) have been applied
   * in main.js — so a stored snapshot overrides the defaults rather than
   * the other way around.
   *
   * Wires three things:
   *   1. Restore: read PERSIST_KEY, scrub, applyState. Failures are silent.
   *   2. Debounced auto-save: any user gesture that mutates state will fire
   *      one of the existing setters/handlers; we hook the events that
   *      already exist (input/change on the panel, model swap, etc.) by
   *      installing a delegated listener on the controls panel root, plus
   *      a fallback rAF tick so off-panel changes (hotkeys, MIDI) also
   *      eventually persist.
   *   3. beforeunload: synchronous final flush.
   */
  bootPersist() {
    // ── 1. Restore ────────────────────────────────────────────────────────
    let raw;
    try { raw = localStorage.getItem(this._persistKey); } catch (_) { raw = null; }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const scrubbed = this._scrubImportedState(parsed);
        // Auto-restore: never prompt, never keep JS code. If the user wants
        // their camera script back they re-enable it via the editor.
        if (scrubbed.state.camScript) scrubbed.state.camScript.code = '';
        this.applyState(scrubbed.state);
      } catch (_) {
        // Corrupt snapshot — drop it so next save starts clean.
        this._clearPersisted();
      }
    }

    // ── 2. Debounced auto-save ────────────────────────────────────────────
    const DEBOUNCE_MS = 1500;
    let timer = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { this._persistNow(); timer = null; }, DEBOUNCE_MS);
    };
    // Delegated capture-phase listener picks up every input/change inside
    // the controls panel — sliders, selects, checkboxes, text inputs.
    const panel = document.querySelector('.controls-panel');
    if (panel) {
      panel.addEventListener('input',  schedule, { capture: true });
      panel.addEventListener('change', schedule, { capture: true });
      panel.addEventListener('click',  schedule, { capture: true });
    }
    // Hotkeys + MIDI + drag-orbit fire outside the panel — catch them via
    // a periodic low-cost tick. We compare a cheap fingerprint (color + 
    // formula + camera position) to decide whether to schedule a real save.
    let _lastFp = '';
    const fingerprint = () => {
      try {
        const a = this.audio, r = this.render, mv = this.mathViz;
        const cp = r.camera.position;
        return [
          a.colorIdx, mv?._colId, mv?._key,
          cp.x.toFixed(2), cp.y.toFixed(2), cp.z.toFixed(2),
        ].join('|');
      } catch (_) { return ''; }
    };
    setInterval(() => {
      const fp = fingerprint();
      if (fp && fp !== _lastFp) { _lastFp = fp; schedule(); }
    }, 1000);

    // ── 3. Final flush on tab close ───────────────────────────────────────
    // beforeunload runs synchronously, so localStorage.setItem must complete
    // here — no chance for a debounced write to land afterward.
    window.addEventListener('beforeunload', () => this._persistNow());
  },

  // ── Export: download JSON ─────────────────────────────────────────────────
  exportSettings() {
    const state = this.captureState();
    const blob  = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href = url; a.download = `vimathic_state_${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  },

  // ── Import: load JSON file → applyState ─────────────────────────────────
  // SECURITY (v6): imported state may contain camScript.code which is JS that
  // gets executed via `new Function(...)` inside camera.js. A malicious preset
  // could exfiltrate localStorage, run fetch() to a remote server, or modify
  // the DOM. Two layers of defence:
  //   1. _scrubImportedState() unconditionally sets camScript.active = false
  //      so the script doesn't auto-execute on apply.
  //   2. If JS code is present, _confirmScriptImport() shows a modal preview
  //      and asks the user before keeping the code at all. If they decline,
  //      the code is dropped from the state — only non-script settings apply.
  // GLSL shader strings (s.shader.vert/frag) are NOT prompted because GLSL
  // executes in WebGL sandbox and has no JS API access.
  importSettings(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      let state;
      try { state = JSON.parse(e.target.result); }
      catch (_) { this._showToast('⚠ Invalid state file', true); return; }

      const scrubbed = this._scrubImportedState(state);

      if (scrubbed._hasScript) {
        // Ask user before retaining JS code
        this._confirmScriptImport(scrubbed.scriptCode, (allow) => {
          if (!allow && scrubbed.state.camScript) {
            // User declined — strip the code entirely
            scrubbed.state.camScript.code = '';
          }
          this.applyState(scrubbed.state);
          this._showToast(allow ? '✔ State loaded (script kept, not auto-running)'
                                : '✔ State loaded (script discarded)');
        });
      } else {
        this.applyState(scrubbed.state);
        this._showToast('✔ State loaded');
      }
    };
    reader.readAsText(file);
  },

  /**
   * Defang an imported state object before applyState consumes it.
   * Sets camScript.active=false unconditionally so loadScript() is never
   * auto-invoked on apply. Returns { state, _hasScript, scriptCode }.
   */
  _scrubImportedState(state) {
    if (!state || typeof state !== 'object') return { state: state || {}, _hasScript: false, scriptCode: '' };
    const cs = state.camScript;
    let hasScript = false;
    let scriptCode = '';
    if (cs && typeof cs === 'object') {
      if (typeof cs.code === 'string' && cs.code.trim().length > 0) {
        hasScript = true;
        scriptCode = cs.code;
      }
      // Always disable auto-run — user must manually open Camera Programmer
      // and click Apply to actually execute. This prevents drive-by execution.
      cs.active = false;
    }
    return { state, _hasScript: hasScript, scriptCode };
  },

  /**
   * Show a modal asking the user whether to keep the imported JS code.
   * Code is displayed verbatim in a <pre> so the user can review.
   * Calls onDecide(true) to keep, onDecide(false) to drop.
   */
  _confirmScriptImport(code, onDecide) {
    // Build modal once, reuse — avoids stacking if user imports multiple files
    let overlay = document.getElementById('_vimathic_script_confirm');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '_vimathic_script_confirm';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);' +
        'display:flex;align-items:center;justify-content:center;font-family:var(--mono);' +
        'opacity:0;transition:opacity .2s;pointer-events:none';
      overlay.innerHTML = `
        <div style="background:#0a0a1a;border:2px solid var(--accent);border-radius:8px;
          padding:20px 22px;max-width:580px;width:92%;max-height:80vh;display:flex;flex-direction:column;
          box-shadow:0 0 30px rgba(255,58,122,.4)">
          <h3 style="margin:0 0 8px 0;color:var(--accent);font-size:13px;letter-spacing:1.5px;
            font-family:var(--display)">⚠ IMPORTED PRESET CONTAINS SCRIPT</h3>
          <p style="margin:0 0 10px 0;color:#bbc;font-size:11px;line-height:1.55">
            This preset includes JavaScript code for the Camera Programmer.
            Running untrusted code can read your data and contact remote servers.<br>
            <strong style="color:var(--green)">If you keep the code it will NOT auto-run</strong> — you'll
            still need to open Camera Programmer manually and click Apply.<br>
            Review below:
          </p>
          <pre id="_vsc_code" style="background:#050510;border:1px solid #223;border-radius:5px;
            padding:10px;color:#a0c8f0;font-size:10px;font-family:var(--mono);line-height:1.5;
            max-height:280px;overflow:auto;margin:0 0 12px 0;white-space:pre-wrap;word-break:break-all"></pre>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button id="_vsc_drop" style="background:rgba(255,58,122,.10);border:1px solid var(--accent);
              color:var(--accent);padding:8px 18px;border-radius:5px;cursor:pointer;font-family:var(--mono);
              font-size:11px;letter-spacing:1px">DISCARD CODE</button>
            <button id="_vsc_keep" style="background:rgba(0,255,170,.10);border:1px solid var(--green);
              color:var(--green);padding:8px 18px;border-radius:5px;cursor:pointer;font-family:var(--mono);
              font-size:11px;letter-spacing:1px">KEEP CODE</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    document.getElementById('_vsc_code').textContent = code;
    overlay.style.pointerEvents = 'auto';
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });

    const close = () => {
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
    };
    document.getElementById('_vsc_drop').onclick = () => { close(); onDecide(false); };
    document.getElementById('_vsc_keep').onclick = () => { close(); onDecide(true);  };
  },

  // ── Named presets (localStorage) ─────────────────────────────────────────
  /** Save current state as a named preset */
  savePreset(name) {
    if (!name?.trim()) return;
    const presets = this._loadPresetList();
    const idx = presets.findIndex(p => p.name === name.trim());
    const entry = { name: name.trim(), state: this.captureState(), savedAt: Date.now() };
    if (idx >= 0) presets[idx] = entry; else presets.push(entry);
    try { localStorage.setItem('vimathic_presets', JSON.stringify(presets)); } catch (_) {}
    this._renderPresets();
  },

  deletePreset(name) {
    const presets = this._loadPresetList().filter(p => p.name !== name);
    try { localStorage.setItem('vimathic_presets', JSON.stringify(presets)); } catch (_) {}
    this._renderPresets();
  },

  _loadPresetList() {
    try { return JSON.parse(localStorage.getItem('vimathic_presets') || '[]'); } catch (_) { return []; }
  },

  _renderPresets() {
    const wrap = document.getElementById('preset-list');
    if (!wrap) return;
    const presets  = this._loadPresetList();
    const holdSecs = +(document.getElementById('clip-hold')?.value || 5);

    if (!presets.length) {
      wrap.innerHTML = '<span style="color:#334;font-size:10px">No saved presets</span>';
      return;
    }
    wrap.innerHTML = '';
    presets.forEach((p, i) => {
      const holdMs = p.holdMs ?? (holdSecs * 1000);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;align-items:center;padding:2px 0;border-bottom:1px solid #0d0d20';

      // Index number
      const num = document.createElement('span');
      num.style.cssText = 'color:#334;font-size:9px;min-width:14px;text-align:right;flex-shrink:0';
      num.textContent = i + 1;

      // Load button
      const loadBtn = document.createElement('button');
      loadBtn.className = 'preset-load-btn';
      loadBtn.style.cssText = 'flex:1;text-align:left;background:rgba(0,255,200,.06);' +
        'border:1px solid rgba(0,255,200,.2);border-radius:4px;color:#0fc;font-size:10px;' +
        'font-family:var(--mono);padding:4px 6px;cursor:pointer;overflow:hidden;' +
        'white-space:nowrap;text-overflow:ellipsis;min-width:0';
      loadBtn.title  = `Load '${p.name}'`;
      loadBtn.textContent = p.name;
      loadBtn.onclick = () => { this.applyState(p.state); this._showToast(`✔ ${p.name}`); };

      // Hold time inline editor. Visual styling comes from the global
      // input[type=number] rule in index.html — same visual as clip-hold,
      // including a width that fits three-digit values like 600.
      // flex-shrink:0 stays inline because flex-row shrinking would hide
      // the native spinner arrows on narrow panel widths.
      const holdEl = document.createElement('input');
      holdEl.type  = 'number'; holdEl.min = '1'; holdEl.max = '600';
      holdEl.value = Math.round(holdMs / 1000);
      holdEl.title = 'Hold (seconds) for this step in clip';
      holdEl.style.flexShrink = '0';
      holdEl.addEventListener('change', () => {
        p.holdMs = Math.max(500, +holdEl.value * 1000);
        try { localStorage.setItem('vimathic_presets', JSON.stringify(this._loadPresetList().map(
          x => x.name === p.name ? { ...x, holdMs: p.holdMs } : x
        ))); } catch (_) {}
      });

      // Delete button — compact (×8px, no padding around the cross)
      const delBtn = document.createElement('button');
      delBtn.style.cssText = 'background:none;border:none;color:#777;cursor:pointer;' +
        'font-size:10px;line-height:1;padding:2px 3px;flex-shrink:0;opacity:0.6;' +
        'transition:opacity .15s,color .15s';
      delBtn.title = 'Delete';
      delBtn.textContent = '✕';
      delBtn.onmouseenter = () => { delBtn.style.opacity = '1'; delBtn.style.color = '#f44'; };
      delBtn.onmouseleave = () => { delBtn.style.opacity = '0.6'; delBtn.style.color = '#777'; };
      delBtn.onclick = () => this.deletePreset(p.name);

      row.append(num, loadBtn, holdEl, delBtn);
      wrap.appendChild(row);
    });
  },
};
