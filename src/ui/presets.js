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

// FIX(#18, r2): the non-param fields applyState() reads. With PARAM_FIELDS this
// defines "looks like a preset" for migratePreset(), so keep it in step with
// applyState or valid presets get turned away. Deliberately not captureState()'s
// list: gpuMode is written but never read back (the mode is restored from
// gpuSelVal), so a file carrying only gpuMode tells us nothing we can apply.
const STATE_FIELDS = [
  'shape', 'vizMode', 'material', 'particleStyle', 'gpuSelVal', 'deformMode',
  'volumeKey', 'gridVisible', 'camera', 'camScript', 'shader',
];

/**
 * Coerce a snapshot's keyframe list into something the camera and the timeline
 * renderer can consume. Exported for tests; applyState is the only caller.
 *
 * FIX(#18, r3): keyframes arrive from JSON we didn't write and land in
 * onTimelineRender (modals.js), which does kf.code.split('\n') and kf.t * 100
 * with no guards of its own. Unusable entries are dropped rather than repaired:
 * a keyframe with no code is a no-op, and inventing a `t` would silently retime
 * the script. Empty-string code is kept — it round-trips from an empty editor
 * and renders fine. t is clamped exactly as addKeyframeAtPlayhead clamps it.
 */
export function sanitizeKeyframes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const kf of list) {
    if (!kf || typeof kf !== 'object') continue;
    if (typeof kf.code !== 'string' || !Number.isFinite(kf.t)) continue;
    out.push({ t: Math.max(0, Math.min(1, kf.t)), code: kf.code });
  }
  return out;
}

// ── Preset format version ─────────────────────────────────────────────────
// Bump whenever captureState() changes the snapshot shape in a way older code
// (or older JSON) wouldn't read correctly: renaming or removing a field,
// changing what a value means (seconds → ms), moving one between nested
// objects. Adding an optional field needs no bump — applyState's `?? default`
// guards already read it as undefined. On a bump, add the matching
// `if (v < N)` block to migratePreset(); blocks run in sequence, so a v1 file
// picks up every step up to CURRENT.
export const CURRENT_PRESET_VERSION = 2;

/**
 * Normalize an incoming snapshot to the current schema version.
 *
 * Contract (what callers may rely on):
 *   • The result ALWAYS has `_version === CURRENT_PRESET_VERSION` — stamped
 *     unconditionally at the end, so no path hands back a half-migrated
 *     snapshot that merely looks current.
 *   • The input is never mutated; every step copies, so a caller holding the
 *     parsed record (the preset captured in _renderPresets' closure) sees what
 *     it passed in. Nested objects (camera, camScript, shader) are shared, not
 *     deep-cloned — applyState only reads them.
 *   • A missing / non-numeric / below-1 `_version` reads as v1: the stamp only
 *     started being written at v1, so anything without it is from that era or
 *     hand-written, and applyState's per-field guards make junk a no-op.
 *   • Input that isn't a preset is rejected with null. "Is a preset" is decided
 *     by content, not by the version stamp — see the check below.
 *   • A snapshot from a NEWER build loads best-effort with a warning: we can't
 *     transform forward, but the same guards plus getColor()'s safe default in
 *     shaders.js make unknown fields harmless. Only our in-memory copy is
 *     stamped down, so the stored file still opens in the newer build.
 *
 * Pure object transform — never touches the renderer / audio engine / DOM,
 * which is what keeps it testable with fixtures (tests/preset-migrations.test.js).
 *
 * @param {object} s  raw snapshot, typically JSON.parse(fileText)
 * @returns {object|null}  a copy whose _version === CURRENT_PRESET_VERSION,
 *                         or null if the input isn't a recognisable snapshot
 */
export function migratePreset(s) {
  if (!s || typeof s !== 'object') return null;

  // FIX(#18, r2): recognise a snapshot by what applyState can consume, not by
  // its version stamp. Without this, dropping the `v < 1` rejection leaves no
  // rejection path but non-objects, and a stranger's config or a package.json
  // comes back stamped as a current preset — reported to the user as loaded.
  // Content-based means unversioned/hand-written presets (the point of #18)
  // still pass. Arrays are called out explicitly: `typeof [] === 'object'`
  // slips past the guard above.
  if (Array.isArray(s)) return null;
  const looksLikePreset = PARAM_FIELDS.some(f => s[f] != null)
                       || STATE_FIELDS.some(f => s[f] != null);
  if (!looksLikePreset) return null;

  // FIX(#18): absent / NaN / 0 all mean "written before we versioned
  // snapshots" → read as v1 and run the chain, instead of rejecting the file.
  const rawV = s._version;
  const v    = (Number.isFinite(rawV) && rawV >= 1) ? rawV : 1;

  // Forward compatibility: a file written by a newer build. We can't safely
  // transform forward (we don't know what changed), so we read it best-effort
  // and warn — see the contract note above for why that's survivable.
  if (v > CURRENT_PRESET_VERSION) {
    console.warn(
      `[preset] snapshot from newer build (v${v} > current v${CURRENT_PRESET_VERSION}). ` +
      `Loading as-is — some fields may be ignored.`,
    );
  }

  // Migration chain. Add `if (v < N) out = {...transform...};` blocks as the
  // format evolves; each produces the next-version shape, so older inputs
  // compose (v1 → v2 → v3 → ...). Example:
  //   if (v < 3) { out = { ...out, gpuModeIdx: out.gpuMode }; delete out.gpuSelVal; }
  // FIX(#18): blocks must copy, not mutate — `s` belongs to the caller.
  let out = s;

  // FIX(#18): unconditional stamp — what makes the @returns promise true even
  // while the chain above is empty; the spread is also the no-mutation guarantee.
  return { ...out, _version: CURRENT_PRESET_VERSION };
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

    // FIX(#17): bindCameraParams() seeds #ce-code with cam.getDefaultCode() on
    // boot, so untouched default text would be baked into every preset and
    // autosave. Store '' instead — applyState skips falsy code, so restoring
    // such a preset leaves the editor alone rather than stomping it. Not
    // blanked while cpActive: a running script is state worth saving.
    // FIX: while a script is RUNNING, its source is cam.cpSource — set by
    // loadScript alongside cpFn. #ce-code is only the editor buffer, and the
    // camera preset gallery (modals.js) and selectKeyframe both overwrite it
    // without loading anything, so a snapshot built from it recorded whatever
    // script the user happened to be reading. Restoring such a preset runs
    // that one, because applyState calls loadScript on the carried code.
    // With no script running the buffer IS the state worth saving, and
    // FIX(#17) below still applies to it.
    const camCodeRaw = DOM.ceCode?.value ?? '';
    const camCode    = cam.cpActive
      ? (cam.cpSource ?? camCodeRaw)
      : (camCodeRaw === cam.getDefaultCode?.() ? '' : camCodeRaw);

    const state = {
      // Version stamp — read by migratePreset() on load. Sourced from
      // CURRENT_PRESET_VERSION so the writer can never drift from the reader.
      _version: CURRENT_PRESET_VERSION,

      // ── Visual ──────────────────────────────────────────────────────────
      shape:       r.currentShape,
      vizMode:     r.vizMode,
      // FIX: ask the panel, which knows the difference between "the finish on
      // screen" and "the finish chosen". WIRE and PTS force Matte for as long
      // as they are on screen, so a preset saved in either mode recorded Matte
      // and handed it back on the way out, losing the operator's pick.
      material:    this.getPresetMaterial?.() ?? r.currentMaterial ?? 'matte',
      // 'squares' covers both a build without particle styles and a snapshot
      // taken before the field existed — the two are the same look.
      particleStyle: r.currentParticleStyle ?? 'squares',
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
        code:      camCode,           // see FIX(#17) above
        params:    { ...cam.cpParams },
        keyframes: cam.cpKeyframes.map(kf => ({ t: kf.t, code: kf.code })),
      },

      // ── Custom shader ───────────────────────────────────────────────────
      // FIX: hasCustom describes the LIVE program (se.customVS is set only on a
      // successful compile), so the bodies beside it have to describe the same
      // program. se._vert/_frag are draft buffers — the gallery writes them
      // without compiling, switchTab writes them, and compileAndApply writes
      // them before its own trial compile, so a failed APPLY leaves broken
      // source there. Pairing the live flag with the draft text meant a preset
      // could carry a shader that was only being read, and applying it
      // compiled that one. _appliedVert/_appliedFrag are the bodies that last
      // compiled; with nothing custom live the draft is the right thing to keep.
      shader: {
        hasCustom: !!se.customVS,
        vert:      se.customVS ? (se._appliedVert ?? se._vert) : se._vert,
        frag:      se.customFS ? (se._appliedFrag ?? se._frag) : se._frag,
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
   * @param {boolean} [opts.preserveCamera]
   *   Apply the LOOK only — leave the live camera exactly as it is. Skips the
   *   position/target/fov tween, camPhysics, the auto-rotate wish and the whole
   *   camera-programmer block. Set by ClipPlayer while the user drives the
   *   camera by hand (ClipPlayer.camOverride); a preset saved with
   *   `autoRot: false` would otherwise switch their running script off at the
   *   very next step.
   * @param {boolean} [opts.preserveColor]
   *   Leave the live colour scheme alone — apply everything else the snapshot
   *   carries. Set by ClipPlayer while AUTO COLOUR is cycling the palette on
   *   its own, so a clip does not drag it back to each preset's saved colour.
   * @param {boolean} [opts.preserveMaterial]
   *   Same for the surface material, driven by AUTO MATERIAL. The viz-mode rule
   *   still applies underneath it: WIRE/PTS force Matte whatever is preserved,
   *   because reflections cannot be drawn there at all.
   * @returns {boolean} false when the snapshot was refused — migratePreset()
   *   didn't recognise it (nothing applied), or a field threw mid-apply
   *   (state may be partly applied). True once the state has been pushed.
   */
  applyState(s, opts = {}) {
    // Normalise via migratePreset first — handles unknown shape, version skew,
    // and future migration steps; null means "not a snapshot".
    // FIX(#18, r2): report that refusal to the caller instead of returning
    // silently — importSettings() used to announce "✔ State loaded" for a file
    // migratePreset had just rejected.
    s = migratePreset(s);
    if (!s) return false;

    // FIX(#18, r3): snapshots no longer have to be machine-written to get this
    // far, so a malformed field can throw mid-apply. Out of importSettings such
    // a throw escaped reader.onload — no toast, no clue, half the state applied.
    // Folding it into the boolean gives every call-site one contract to check.
    // What a hand-written file is KNOWN to get wrong is normalised before it
    // reaches the engine (sanitizeKeyframes); this is the net for the rest.
    // Deferred work (onFlat, tween onDone) runs after we return, outside it.
    try {
      this._applyStateFields(s, opts);
      return true;
    } catch (err) {
      console.error('[preset] snapshot rejected mid-apply', err);
      return false;
    }
  },

  /**
   * Field-by-field apply. Private: applyState owns migration and the
   * boolean/error contract, and every caller (import, preset list, ClipPlayer,
   * boot restore) goes through it.
   */
  _applyStateFields(s, opts = {}) {
    const r   = this.render;
    const cam = this.camera;
    const mv  = this.mathViz;
    const se  = this.shaderEditor;
    const ctx = { audio: this.audio, render: r, camera: cam };

    // ── Param fields (audio sensitivities, amp, wave-int, bloom, colorIdx) ──
    // applyParam keeps the slider + display in sync as a side effect.
    // colorIdx is skipped while AUTO COLOUR owns the palette (opts.preserveColor
    // — set per step by ClipPlayer); the other five are unaffected by it.
    for (const id of PARAM_FIELDS) {
      if (opts.preserveColor && id === 'colorIdx') continue;
      if (s[id] != null) applyParam(ctx, id, s[id]);
    }

    // ── Other visual state ──────────────────────────────────────────────────
    if (s.gridVisible != null && r.grid) {
      r.grid.visible = s.gridVisible;
      DOM.btnToggleGrid.style.opacity = s.gridVisible ? '1' : '0.45';
    }
    // ── Viz mode + surface material ────────────────────────────────────────
    // FIX(#15, r2): ONE decision, not two. WIRE/PTS force Matte and hide the
    // material dropdown (reconstructed normals are degenerate there), so a
    // snapshot's material can only be *remembered* in those modes, never shown.
    // Applying mode and material as independent steps left the snapshot's
    // mirror/metal live in a WIRE session with the dropdown hidden — unfixable
    // by the user. Passing matKey INTO syncVizModeUI keeps the rule in one
    // place. Both apply outside the morph block (uniform push, no geometry
    // rebuild); 'matte' covers presets saved before the field existed.
    // AUTO MATERIAL owns the finish while it runs, so the snapshot's material is
    // replaced by the live one and the viz-mode rule below still gets the final
    // say on whether it can be shown at all. Read from r.currentMaterial rather
    // than the dropdown so it stays right mid-fade — setSurfaceMaterialAnimated
    // names its destination the moment it starts.
    const matKey = opts.preserveMaterial
      ? (r.currentMaterial ?? 'matte')
      : (s.material ?? 'matte');
    const matSel = document.getElementById('surface-material-sel');
    // Same story one row down, minus the forcing: a particle style is simply
    // not drawn outside PTS, so it needs no mode rule of its own. 'squares' is
    // the pre-field default.
    const ptsKey = s.particleStyle ?? 'squares';
    // The viz mode that will be in effect once this snapshot is applied: the
    // snapshot's own, or — when it carries none — whatever the engine already
    // shows. The material rule keys off the mode the user will be looking at,
    // not off whether the snapshot happened to name one.
    const vizMode = s.vizMode ?? r.vizMode ?? 'surface';

    if (s.vizMode) r.setVizModeGPU(s.vizMode);

    let matHandled = false;
    // The engine is switched above; the UI half goes through the same helper a
    // click on #mode-* uses — button highlight plus the material rule. Optional
    // call: a build without the helper still gets the engine change, and the
    // fallback below still applies the material.
    if (this.syncVizModeUI) {
      this.syncVizModeUI(vizMode, matKey, ptsKey);
      // The helper's material half is a no-op when the dropdown is absent.
      matHandled = !!matSel;
    } else {
      // No helper: the particle style has no fallback path through a dropdown
      // event, so push it straight at the engine. Harmless in any mode — the
      // engine files it away and applies it when PTS next draws.
      r.setParticleStyle?.(ptsKey);
    }

    if (!matHandled) {
      // No helper (stripped build) or no dropdown in this HTML variant. Apply
      // directly, honouring the same rule the helper enforces: outside SURF the
      // only safe material is Matte.
      const effective = vizMode === 'surface' ? matKey : 'matte';
      if (matSel) {
        // Setting .value + dispatching change runs controls.js's _applyMat,
        // which calls render.setSurfaceMaterial and updates the descriptor.
        // Single source of truth for the apply path.
        matSel.value = effective;
        matSel.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        r.setSurfaceMaterial?.(effective);
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
        // FIX(r2): same live check as ui.applyMathFormula. The flat frame is up
        // to 400 ms away, and a shader picked in that window — by hand or by
        // the next clip step — owns the surface; arming this formula then sets
        // uMathMode = 1 and the shader draws nothing at all.
        onFlatActions.push(() => {
          if (mv && DOM.gpuSel.value === s.gpuSelVal) mv.setFormula(colId, key);
        });
      } else {
        // GPU shader mode — has its own crossfade (uModeBlend), doesn't need
        // to be inside the morph. Schedule it but NOT inside onFlat.
        if (mv) mv.deactivate();
        r.setGPUModeAnimated(+s.gpuSelVal);
      }
    }

    // A numeric gpuSelVal means a GPU shader owns pos.y, and the shader's whole
    // displacement is gated on uMathMode==0 (shaders.js). MathVisualizer
    // .deactivate() leaves _mode/_volumeKey as they were, so a snapshot taken
    // after switching from DEFORM: VOLUME to a GPU shader still carries
    // deformMode:'volume' — honouring it re-armed the CPU deformation, set
    // uMathMode to 1, and the restored GPU shader then drew nothing at all.
    //
    // Restore what the user was actually looking at: the shader, over an
    // undeformed surface. Not "skip the deform block" — the mode still has to
    // be written, or mathViz._mode stays stuck at 'volume' and the next 'm:'
    // formula the user picks auto-exits into COLLAPSE while the panel reads
    // SURFACE. 'collapse' needs no special case: unlike setVolumeFormula it
    // never touches uMathMode, so it round-trips over a GPU shader untouched.
    const cpuPath = s.gpuSelVal == null || s.gpuSelVal.startsWith('m:');
    const deformTarget = (!cpuPath && s.deformMode === 'volume') ? 'surface' : s.deformMode;

    if (deformTarget === 'volume' && s.volumeKey) {
      onFlatActions.push(() => { if (mv) mv.setVolumeFormula(s.volumeKey); });
    } else if (deformTarget && deformTarget !== 'surface') {
      onFlatActions.push(() => { if (mv) mv.setMode(deformTarget); });
    } else if (deformTarget === 'surface') {
      // Explicit surface mode — schedule restoration if mv was in volume/collapse.
      onFlatActions.push(() => { if (mv) mv.setMode('surface'); });
    }

    // FIX(#15): the branches above schedule only the ENGINE switch (inside the
    // morph). The deform buttons and #volume-formula-wrap are pure UI, synced
    // here and now — the helper touches no engine state, which is why calling
    // it outside onFlat can't duplicate the scheduled mv.setMode /
    // mv.setVolumeFormula. Optional call: a build without the helper is
    // unaffected.
    // FIX(#15, r2): run for EVERY snapshot. One without deformMode leaves the
    // engine mode alone (no branch above fires), so the row has to be re-lit
    // from mathViz._mode — the field captureState() records.
    // deformTarget, not s.deformMode: the row must show the mode that was
    // actually scheduled above, or it lights ⬡ VOLUME over a GPU shader that
    // carries no volume deformation.
    const deformMode = deformTarget ?? mv?._mode ?? null;
    if (deformMode) {
      const volKey = deformTarget === 'volume' ? (s.volumeKey ?? mv?._volumeKey ?? null) : null;
      this.syncDeformUI?.(deformMode, volKey);
    }

    if (onFlatActions.length > 0) {
      r.triggerMorphTransition(() => { for (const fn of onFlatActions) fn(); });
    }

    // ── Camera ──────────────────────────────────────────────────────────────
    // Anything that drives the camera every frame (physics, programmer script)
    // must start AFTER our tween finishes, otherwise it overwrites
    // camera.position on the next animate() tick and the tween is invisible.
    const postTweenCameraActions = [];

    // opts.preserveCamera: the caller (ClipPlayer, while the user drives the
    // camera manually) asked for a look-only apply. Both camera halves below
    // are gated on it — the tween/physics/auto-rotate block AND the programmer
    // block — because either one alone would still take the camera away: the
    // first by turning auto-rotate off, the second by re-arming the preset's
    // script over the user's. Everything above this line has already run:
    // shape, colour, formula, shader and params are what a clip step is for.
    const camOwned = !opts.preserveCamera;
    let startCameraTween = null;

    if (s.camera && camOwned) {
      const c = s.camera;
      // Hold the camera for the tween's duration so the physics loop and any
      // live programmer script don't fight our position writes.
      //
      // FIX: this used to write cam.autoRot = false and restore it afterwards.
      // autoRot is the AUTO-ROTATE button's own state, and nothing told the
      // button — so for the whole tween (about 30% of a clip step on the
      // default camera setting) the label read ON while the flag read OFF, and
      // the click handler builds both the new value and its claim/release
      // decision out of that flag. A click in that window did the opposite of
      // the label: rotation on, camera claimed from the clip player. Holding
      // through a flag of the tween's own leaves the user's setting alone.
      cam.tweenHold = true;

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
      }
      // Nothing to restore when there is no wish: the hold above is released in
      // onDone and the user's setting was never disturbed.

      // Built here, fired after the camera-programmer block below — with a
      // zero/negative duration tweenCameraTo commits synchronously and runs
      // onDone before this function returns, so starting it here meant the
      // "Snap (instant, old)" clip mode drained a queue that did not yet hold
      // the preset's camera script. The script was then never loaded and the
      // clip replayed with the generic auto-orbit instead.
      startCameraTween = () => r.tweenCameraTo(
        {
          pos:    { x: c.x,  y: c.y,  z: c.z  },
          target: { x: c.tx, y: c.ty, z: c.tz },
          fov:    c.fov,
        },
        {
          duration: opts.cameraTransitionMs,
          onDone: () => {
            // Released first, and before the re-check below can return: a hold
            // left standing would keep the physics loop and the programmer
            // script switched off for the rest of the session.
            cam.tweenHold = false;
            // Ownership can flip DURING the tween: the user hits AUTO-ROTATE
            // or applies a script in the first few hundred ms of a clip step.
            // The actions below were queued while the player still owned the
            // camera, so firing them now would switch the user's own rotation
            // straight back off. Re-check at fire time, and only for the clip
            // player's applies (it is the one that passes preserveCamera) —
            // clicking a preset by hand is an explicit request for ITS camera.
            if (opts.preserveCamera === false && this._clip?.camOverride) return;
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
    if (s.camScript && camOwned) {
      const cs = s.camScript;
      // FIX(#18, r3): type the fields before they reach the editor, cpParams
      // and `new Function` — a hand-written camScript is a valid preset now,
      // and nothing downstream re-checks. Keyframes especially: buildTimeline()
      // hands them straight to a renderer that assumes kf.code is a string.
      const code = typeof cs.code === 'string' ? cs.code : '';
      if (code) cam.cb.onSetCode(code);
      if (cs.params && typeof cs.params === 'object') {
        Object.assign(cam.cpParams, cs.params);
        // The sliders show cpParams; they have to be told when a snapshot
        // rewrites it, or the next drag starts from the previous value.
        cam.cb.onParamsChanged?.();
      }
      cam.cpKeyframes = sanitizeKeyframes(cs.keyframes);
      cam.cpSelectedKf = null;
      cam.buildTimeline();
      if (cs.active && code) {
        if (s.camera) {
          // Camera tween in flight — defer script activation to onDone.
          postTweenCameraActions.push(() => cam.loadScript(code));
        } else {
          // No camera tween — start script immediately.
          cam.loadScript(code);
        }
      }
    }

    // The queue is complete now — physics, auto-rotate wish, programmer script
    // — so the tween may run, instant path included.
    startCameraTween?.();

    // ── Custom shader ───────────────────────────────────────────────────────
    if (s.shader?.hasCustom) {
      se._vert = s.shader.vert;
      se._frag = s.shader.frag;
      // Re-apply the custom shader via the compileAndApply path.
      if (DOM.seCode) DOM.seCode.value = se._tab === 'vert' ? se._vert : se._frag;
      se.compileAndApply();
    } else if (s.shader && (se?.customVS || se?.customFS)) {
      // A snapshot that carries a shader record with hasCustom:false describes
      // the built-in look, so it has to be able to UNDO a live custom program —
      // otherwise the first clip step that carries a shader locks it in for the
      // whole set and no preset in the list can get the stock look back.
      //
      // Gated twice, and both gates matter. `s.shader` existing keeps a
      // pre-schema or hand-written preset with no shader field on today's
      // leave-it-alone behaviour. A custom program actually being live keeps a
      // plain apply a no-op — every preset this build saves carries a shader
      // record, so without that gate this branch would run on every preset
      // click and every clip step.
      //
      // Only the live program is touched, never se._vert / se._frag / #se-code:
      // those hold the user's own source, including keystrokes they have not
      // applied yet, and a clip step arriving every few seconds must not
      // overwrite what they are typing. revertToBuiltIn() for the same reason —
      // reset() would stomp the editor text back to the default snippets and
      // re-fire onOpen mid-clip.
      se.revertToBuiltIn();
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
   *   1. Restore: read PERSIST_KEY, scrub, applyState. An unusable snapshot is
   *      dropped and boot continues from defaults — no toast (see below).
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
        // FIX(#18, r3): the one call-site that ignored applyState's result.
        // Boot has no user gesture to answer and no reason to interrupt with a
        // toast, so a refused snapshot means "start from defaults" — but drop
        // the blob too, or every reload re-reads the same corpse and the next
        // autosave is the only thing that can clear it.
        if (!this.applyState(scrubbed.state)) {
          console.warn('[preset] persisted snapshot unusable — starting from defaults');
          this._clearPersisted();
        }
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
          // FIX(#14): MathVisualizer's fields are _collId / _formulaKey. The
          // old names were always undefined, so a hotkey formula swap never
          // moved the fingerprint and never scheduled a save.
          a.colorIdx, mv?._collId, mv?._formulaKey,
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

      // FIX(#18, r2): report what applyState actually did — announcing
      // "✔ State loaded" for JSON it turned away is the silence the rejection
      // was reinstated to break.
      // FIX(#18, r3): worded so it also fits a snapshot that threw mid-apply,
      // where "nothing applied" would be a lie.
      const REJECTED = '⚠ Preset rejected — unrecognised or malformed';

      if (scrubbed._hasScript) {
        // Ask user before retaining JS code
        this._confirmScriptImport(scrubbed.scriptCode, (allow) => {
          if (!allow && scrubbed.state.camScript) {
            // User declined — strip the code entirely
            scrubbed.state.camScript.code = '';
          }
          const ok = this.applyState(scrubbed.state);
          if (!ok) { this._showToast(REJECTED, true); return; }
          this._showToast(allow ? '✔ State loaded (script kept, not auto-running)'
                                : '✔ State loaded (script discarded)');
        });
      } else {
        const ok = this.applyState(scrubbed.state);
        this._showToast(ok ? '✔ State loaded' : REJECTED, !ok);
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
    // FIX(#16): re-saving under an existing name must not drop per-record
    // fields captureState() knows nothing about — holdMs lives on the record
    // (written by the inline editor in _renderPresets, read by
    // ClipPlayer.buildFromPresets), not inside `state`. Spread the old record
    // first so it survives; entry's own keys win.
    if (idx >= 0) presets[idx] = { ...presets[idx], ...entry }; else presets.push(entry);
    const ok = this._writePresetList(presets);
    this._renderPresets();
    return ok;
  },

  /**
   * Write the preset list, reporting whether it landed.
   *
   * FIX: all three writers swallowed the failure — `catch (_) {}` — and the
   * SAVE handler cleared the name field regardless, so a refused write (quota
   * exceeded, private mode, storage blocked for the origin) redrew the list
   * without the preset AND threw away the typed name, with nothing on screen
   * to say why.
   *
   * @returns {boolean} true when the list was stored
   */
  _writePresetList(list) {
    try {
      localStorage.setItem('vimathic_presets', JSON.stringify(list));
      return true;
    } catch (_) {
      return false;
    }
  },

  deletePreset(name) {
    const presets = this._loadPresetList().filter(p => p.name !== name);
    const ok = this._writePresetList(presets);
    this._renderPresets();
    return ok;
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
      // FIX(#18, r2): same honesty as Import — a record whose `state` applyState
      // refused (hand-edited localStorage, a half-written entry) must not flash
      // the success toast.
      loadBtn.onclick = () => {
        if (this.applyState(p.state)) this._showToast(`✔ ${p.name}`);
        else this._showToast(`⚠ '${p.name}' — unusable snapshot`, true);
      };

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
        const stored = this._writePresetList(this._loadPresetList().map(
          x => x.name === p.name ? { ...x, holdMs: p.holdMs } : x
        ));
        if (!stored) this._showToast?.('⚠ Could not save the hold — storage is full or blocked', true);
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
