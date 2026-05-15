// math-visualizer.js — CPU-driven deformation of the shared GPU mesh.
//
// The render mesh is normally driven entirely by the vertex shader: it
// computes pos.y from audio uniforms and a chosen GLSL formula. When a
// "CPU formula" (from math-collections.js) is activated, control of the
// height field crosses over to JavaScript — the shader steps aside via a
// single uniform and reads whatever the CPU wrote into the geometry.
//
//   uMathMode = 0 → GPU shader owns pos.y (default path).
//   uMathMode = 1 → CPU writes pos.y / position attribute; shader leaves
//                   it untouched and only uses vH = pos.y for coloring.
//
// Three deformation modes share this surface:
//   surface  — Y-only height field on a grid. Default, worker-accelerated.
//   volume   — Full XYZ displacement from snapshotted base positions,
//              driven by VOLUME_FORMULAS (twist, breathe, etc.).
//   collapse — Displacement along stored vertex normals, formula
//              evaluated in spherical (θ, φ) coords relative to centroid.
//              Reuses the currently-active Surface formula.
//
// ── Computation strategy ──────────────────────────────────────────────────
// Surface mode prefers an off-thread Web Worker (math-worker.js) with
// zero-copy Transferable round-trip. If the worker is unavailable (e.g.
// missing file in production), the visualizer transparently falls back to
// synchronous evaluation on the main thread. Same numeric result, just
// blocks the render loop.
//
// Volume and Collapse modes always run on the main thread: their per-vertex
// non-grid coordinates would require a different worker protocol, and the
// formulas they use are cheaper than Surface in practice.
//
// ── Transition blending ───────────────────────────────────────────────────
// When setFormula() is called while another formula is active, the current
// height field is captured into _prevHF and linearly blended toward the new
// formula's output over _blendDuration ms with an ease-in-out curve. The
// blend buffer (_blendBuf) and the worker-receive buffer (_hfBuffer) are
// pre-allocated and reused every frame to keep allocation out of the hot
// path entirely.

import {
  getFormula,
  generateSurfaceFromFormula,
  applyHeightField,
  generateVolumeFromFormula,
  applyDisplacementField,
  generateCollapseScalarField,
  applyCollapseField,
  VOLUME_FORMULAS,
} from './math-collections.js';

// ── Worker bootstrap ───────────────────────────────────────────────────────
// Returns the Worker instance, or null if construction fails. A failure here
// is recoverable (sync fallback covers the same surface), but we log it
// clearly: a silent fallback would only surface as a mysterious FPS drop on
// heavy formulas. The window flag is read by deploy-verification scripts to
// confirm the worker file shipped alongside index.html.
function createMathWorker() {
  try {
    const w = new Worker(new URL('./math-worker.js', import.meta.url), { type: 'module' });
    if (typeof window !== 'undefined') window._vimathic_worker_active = true;
    return w;
  } catch (e) {
    console.warn(
      '[MathVisualizer] Worker unavailable — math will run synchronously on main thread.\n' +
      'Cause:', e.message, '\n' +
      'Hint: math-worker-*.js must be at the same path as index.html on the server.'
    );
    if (typeof window !== 'undefined') window._vimathic_worker_active = false;
    return null;
  }
}

// Cubic ease-in-out for the formula-transition blend curve.
// Smoother than a linear ramp; cheaper than a spring.
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class MathVisualizer {
  constructor(render, audio) {
    this.render      = render;
    this.audio       = audio;
    this.active      = false;
    this._formulaFn  = null;
    this._collId     = null;
    this._formulaKey = null;
    this._gridSize   = null;

    // Frame throttle: mobile evaluates every 2nd frame. The formulas
    // themselves are smooth enough that 30Hz on mobile is indistinguishable
    // from 60Hz to the eye while halving CPU load.
    this._frame      = 0;
    this._throttle   = render.isMobile ? 2 : 1;

    // ── Worker channel ──────────────────────────────────────────────────
    // _workerBusy gates posting a new tick while the previous one is still
    // in flight — we accept 1-frame latency rather than queueing work that
    // would arrive stale. _pendingHF holds the latest result waiting to be
    // applied; it's cleared once consumed.
    this._worker      = createMathWorker();
    this._workerReady = !!this._worker;
    this._pendingHF   = null;
    this._workerBusy  = false;

    if (this._worker) {
      this._worker.onmessage = ({ data }) => {
        this._workerBusy = false;
        if (data.type === 'result') {
          // Copy the transferred buffer into our persistent receive buffer
          // so the worker can reuse its own buffer next tick. Without this
          // copy, every tick allocates a new Float32Array on the main
          // thread — visible as steady GC pressure on long sessions.
          if (!this._hfBuffer || this._hfBuffer.length !== data.hf.length) {
            this._hfBuffer = new Float32Array(data.hf.length);
          }
          this._hfBuffer.set(data.hf);
          this._pendingHF = this._hfBuffer;
        } else if (data.type === 'error') {
          console.warn('[MathVisualizer worker]', data.message);
          this._workerReady = false;
        }
      };
      this._worker.onerror = (e) => {
        console.warn('[MathVisualizer] Worker error, falling back to sync:', e.message);
        this._workerReady = false;
        this._workerBusy  = false;
      };
    }

    // ── Surface blend state ─────────────────────────────────────────────
    // Persistent buffers so a formula change does not allocate during the
    // 400-800ms blend window.
    this._prevHF        = null;
    this._blendBuf      = null;
    this._hfBuffer      = null;
    this._blendActive   = false;
    this._blendStart    = 0;
    this._blendDuration = render.isMobile ? 400 : 800;

    // ── Volume / collapse state ─────────────────────────────────────────
    // _basePositions  — snapshot of geometry at mode entry; both Volume and
    //                   Collapse modes write base + offset back into the
    //                   live attribute, so we must keep the originals.
    // _baseNormals    — parallel to _basePositions; Collapse projects its
    //                   scalar field along the surface normal.
    // _basePts*       — same pair for the optional points-mesh proxy.
    // _dfBuffer       — displacement field reused each Volume tick.
    // _collapseBuf    — scalar field reused each Collapse tick.
    this._mode             = 'surface';
    this._basePositions    = null;
    this._baseNormals      = null;
    this._basePtsPositions = null;
    this._basePtsNormals   = null;
    this._volumeFn         = null;
    this._dfBuffer         = null;
    this._collapseBuf      = null;
    this._collapseStrength = 1.0;

    // ── Volume time accumulator ─────────────────────────────────────────
    // Volume formulas like 'twist' use `time` as their evolution parameter.
    // Pausing the accumulator lets the freeze-frame button hold a Volume
    // figure at its current deformation state instead of continuing to
    // rotate. Audio reactivity keeps working either way — only the
    // monotonic time argument freezes.
    this._volumeTimePaused = false;
    this._volumeAccumTime  = 0;
    this._lastTickTime     = null;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Activate a Surface-mode formula from math-collections.js.
   * If another formula is currently active, the existing height field is
   * captured and a blend to the new formula's output begins automatically.
   */
  setFormula(collectionId, formulaKey) {
    const f = getFormula(collectionId, formulaKey);
    if (!f) return;

    // Snapshot the current heights so the blend has a "from" state.
    // We read from the live geometry rather than _hfBuffer because the
    // user may have been in a different mode (volume/collapse) where the
    // hf buffer is stale.
    if (this.active && this._gridSize) {
      const pos   = this.render.gpuMesh.geometry.attributes.position;
      const count = pos.count;
      if (!this._prevHF || this._prevHF.length !== count) {
        this._prevHF   = new Float32Array(count);
        this._blendBuf = new Float32Array(count);
      }
      for (let i = 0; i < count; i++) this._prevHF[i] = pos.getY(i);
      this._blendActive = true;
      this._blendStart  = performance.now();
    }

    this._formulaFn  = f.f;
    this._collId     = collectionId;
    this._formulaKey = formulaKey;
    this.active      = true;
    this._pendingHF  = null;
    this._workerBusy = false;

    const pos = this.render.gpuMesh.geometry.attributes.position;
    this._gridSize = Math.round(Math.sqrt(pos.count));

    if (this._worker && this._workerReady) {
      this._worker.postMessage({ type: 'setFormula', collectionId, formulaKey });
    }

    this.render.U.uMathMode.value = 1;
  }

  /**
   * Switch to Volume mode using one of the built-in VOLUME_FORMULAS.
   * @param {string} key — key into VOLUME_FORMULAS
   */
  setVolumeFormula(key) {
    const f = VOLUME_FORMULAS[key];
    if (!f) {
      console.warn(`[MathVisualizer] Unknown volume formula: ${key}`);
      return;
    }
    this._snapshotBasePositions();
    this._volumeFn  = f.f;
    this._volumeKey = key;
    this._mode      = 'volume';
    this.active     = true;
    this._pendingHF = null;
    this.render.U.uMathMode.value = 1;
  }

  /**
   * Volume mode with a caller-supplied function. Intended for AI-API use
   * where formulas are generated at runtime rather than picked from the
   * registry.
   * @param {Function} fn — f(x, y, z, t, params) → { dx, dy, dz }
   */
  setVolumeFn(fn) {
    if (typeof fn !== 'function') return;
    this._snapshotBasePositions();
    this._volumeFn = fn;
    this._mode     = 'volume';
    this.active    = true;
    this._pendingHF = null;
    this.render.U.uMathMode.value = 1;
  }

  /**
   * Switch deformation mode without changing the formula.
   * @param {'surface'|'volume'|'collapse'} mode
   */
  setMode(mode) {
    if (mode === this._mode) return;

    // Entering volume with no formula yet — pick a sensible default rather
    // than leave the mesh undeformed and confused.
    if (mode === 'volume' && !this._volumeFn) {
      this.setVolumeFormula('breathe');
      return;
    }

    // Volume and Collapse both write displaced positions over the base
    // snapshot. Surface mode, by contrast, expects pos.y to be writable
    // directly. Restoring the snapshot on exit guarantees Surface starts
    // from clean geometry rather than from a frozen deformation.
    if ((mode === 'surface') &&
        (this._mode === 'volume' || this._mode === 'collapse') &&
        this._basePositions) {
      this._restoreBasePositions();
    }

    if (mode === 'volume' || mode === 'collapse') {
      this._snapshotBasePositions();
    }
    this._mode = mode;
  }

  /**
   * Strength multiplier for collapse mode.
   * 0 = no displacement (geometry unchanged), 1 = default, 2 = double.
   */
  setCollapseStrength(s) {
    this._collapseStrength = Math.max(0, s);
  }

  /**
   * Pause or resume the volume-mode time accumulator. Audio reactivity
   * continues; only the monotonic time argument stops advancing. Called
   * by main.js from the freeze-frame handler so volume formulas like
   * 'twist' don't keep rotating while the render loop is held.
   */
  setVolumeTimePaused(paused) {
    this._volumeTimePaused = !!paused;
  }

  /** Descriptors for every available volume formula. */
  getVolumeFormulaKeys() {
    return Object.entries(VOLUME_FORMULAS).map(([key, f]) => ({ key, name: f.name, description: f.description }));
  }

  /**
   * Return control of the height field to the GPU shader. Resets pos.y to
   * zero on both the main mesh and the points-mesh proxy so the next GPU
   * frame starts from a flat surface.
   */
  deactivate() {
    this.active       = false;
    this._formulaFn   = null;
    this._pendingHF   = null;
    this._workerBusy  = false;
    this._blendActive = false;

    if (this._worker && this._workerReady) {
      this._worker.postMessage({ type: 'deactivate' });
    }

    this.render.U.uMathMode.value = 0;

    const pos = this.render.gpuMesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, 0);
    pos.needsUpdate = true;
    if (this.render.gpuPtsProxy) {
      const pp = this.render.gpuPtsProxy.geometry.attributes.position;
      for (let i = 0; i < pp.count; i++) pp.setY(i, 0);
      pp.needsUpdate = true;
    }
  }

  /**
   * Per-frame entry point. Called unconditionally by main.js; a no-op
   * when inactive. Handles geometry-resize invalidation, then dispatches
   * to the mode-specific tick.
   */
  tick(time) {
    if (!this.active) return;

    // Geometry can be rebuilt under us when the user changes shape. The
    // vertex count and grid size change, so worker state and snapshots
    // are invalidated. Cheaper to detect here than to thread a callback
    // through the shape-change path.
    const currentCount = this.render.gpuMesh.geometry.attributes.position.count;
    const currentGrid  = Math.round(Math.sqrt(currentCount));
    if (currentGrid !== this._gridSize) {
      this._gridSize    = currentGrid;
      this._pendingHF   = null;
      this._workerBusy  = false;
      this._blendActive = false;
      this._basePositions    = null;
      this._baseNormals      = null;
      this._basePtsPositions = null;
      this._basePtsNormals   = null;
      if (this._worker && this._workerReady && this._collId) {
        this._worker.postMessage({ type: 'setFormula', collectionId: this._collId, formulaKey: this._formulaKey });
      }
    }

    if (this._mode === 'volume') {
      this._tickVolume(time);
      return;
    }
    if (this._mode === 'collapse') {
      this._tickCollapse(time);
      return;
    }
    this._tickSurface(time);
  }

  /**
   * Collapse tick: evaluate the active Surface formula in spherical
   * (θ, φ) coords relative to the geometry centroid, then displace each
   * vertex along its stored normal by scalar · _collapseStrength.
   *
   * Reuses _formulaFn from the last setFormula() call. No-op when no
   * formula is active. Geometry restoration on mode exit is handled by
   * setMode('surface'), not here.
   *
   * Runs synchronously on the main thread: the worker protocol is grid-
   * oriented, and routing per-vertex spherical evaluation through it
   * would require a different message shape for marginal gain.
   */
  _tickCollapse(time) {
    if (!this._formulaFn || !this._basePositions || !this._baseNormals) return;

    this._frame++;
    if (this._frame % this._throttle !== 0) return;

    const { bass, mid, treble, beatInt, amp, waveInt } = this.audio;
    const audioParams = {
      amp:  amp     * (1 + bass   * 0.5),
      freq: waveInt * (1 + treble * 0.3),
      comp: 0.5     + mid * 0.4,
    };
    const t = time + beatInt * 0.3;

    const N = this._basePositions.length / 3;
    if (!this._collapseBuf || this._collapseBuf.length !== N) {
      this._collapseBuf = new Float32Array(N);
    }

    const sf = generateCollapseScalarField(
      this._formulaFn, audioParams, this._basePositions, t
    );

    // Scale displacement by the current shape-morph progress so a
    // collapse-mode formula does not snap into full strength mid-morph.
    // Matches how Surface mode multiplies pos.y by uMorphProgress.
    const morphScale = this.render.U.uMorphProgress?.value ?? 1.0;
    const strength   = this._collapseStrength * morphScale;

    applyCollapseField(
      this.render.gpuMesh.geometry, sf,
      this._basePositions, this._baseNormals, strength
    );
    if (this.render.gpuPtsProxy && this._basePtsPositions && this._basePtsNormals) {
      // Points geometry has a different vertex count, so the scalar field
      // has to be recomputed for it rather than reused.
      const sfPts = generateCollapseScalarField(
        this._formulaFn, audioParams, this._basePtsPositions, t
      );
      applyCollapseField(
        this.render.gpuPtsProxy.geometry, sfPts,
        this._basePtsPositions, this._basePtsNormals, strength
      );
    }
  }

  /** Volume tick: full XYZ displacement from base positions. */
  _tickVolume(time) {
    if (!this._volumeFn || !this._basePositions) return;

    this._frame++;
    if (this._frame % this._throttle !== 0) return;

    // Advance the internal time accumulator only when not paused. Two
    // guards on dt: reject backwards jumps (rAF clock quirks under DST or
    // worker-thread time sources) and reject huge deltas (tab was hidden
    // and we got a single 30-second tick on return — that would teleport
    // the formula instead of animating it).
    if (this._lastTickTime !== null) {
      const dt = time - this._lastTickTime;
      if (dt > 0 && dt < 1) {
        if (!this._volumeTimePaused) this._volumeAccumTime += dt;
      }
    }
    this._lastTickTime = time;

    const { bass, mid, treble, amp } = this.audio;
    const audioParams = {
      amp:  amp  * (1 + bass  * 0.5),
      freq: 1    + treble * 0.3,
      comp: 0.5  + mid   * 0.4,
    };

    const count = this._gridSize * this._gridSize;
    if (!this._dfBuffer || this._dfBuffer.length !== count * 3) {
      this._dfBuffer = new Float32Array(count * 3);
    }

    const df = generateVolumeFromFormula(
      this._volumeFn, audioParams,
      this._gridSize, 3.5, this._volumeAccumTime,
      this._basePositions
    );

    applyDisplacementField(this.render.gpuMesh.geometry, df, this._basePositions);
    if (this.render.gpuPtsProxy) {
      applyDisplacementField(this.render.gpuPtsProxy.geometry, df, this._basePtsPositions ?? this._basePositions);
    }
  }

  /** Surface tick: Y-only height field, worker-preferred. */
  _tickSurface(time) {
    if (this._frame % this._throttle !== 0) return;

    // Apply whatever the worker delivered last tick (1-frame latency).
    // The pending field is consumed before we post a new request so the
    // worker never has more than one tick of work queued.
    if (this._pendingHF) {
      const hf = this._pendingHF;
      this._pendingHF = null;
      this._applyHFWithBlend(hf);
    }

    const { bass, mid, treble, beatInt, amp, waveInt } = this.audio;
    const audioParams = {
      amp:  amp   * (1 + bass   * 0.5),
      freq: waveInt * (1 + treble * 0.3),
      comp: 0.5   + mid   * 0.4,
    };
    const t = time + beatInt * 0.3;

    // Worker path: post next tick, return immediately. The result lands
    // in onmessage and is picked up at the top of the next tick.
    if (this._workerReady && this._worker && !this._workerBusy) {
      this._workerBusy = true;
      this._worker.postMessage({ type: 'tick', time: t, gridSize: this._gridSize, extent: 3.5, audioParams });
      return;
    }

    // Sync fallback: compute on main thread and apply immediately.
    if (!this._formulaFn) return;
    const hf = generateSurfaceFromFormula(this._formulaFn, audioParams, this._gridSize, 3.5, t);
    this._applyHFWithBlend(hf);
  }

  /** Tear down the worker. Called from main.js on beforeunload. */
  dispose() {
    if (this._worker) { this._worker.terminate(); this._worker = null; }
  }

  // ── Private — volume / collapse helpers ──────────────────────────────────

  /**
   * Snapshot current geometry positions AND normals as the base for
   * displacement modes. Both Volume and Collapse read base+offset every
   * tick, so the originals must be kept somewhere they won't be overwritten.
   *
   * Normals are assumed already correct — RenderEngine._buildShapeGeo
   * calls computeVertexNormals() after creating each shape. The defensive
   * recompute below is for the unlikely case of a geometry arriving
   * without a normal attribute at all.
   */
  _snapshotBasePositions() {
    const geo = this.render.gpuMesh.geometry;
    const pos = geo.attributes.position;
    const n   = pos.count;

    if (!geo.attributes.normal) geo.computeVertexNormals();
    const nrm = geo.attributes.normal;

    this._basePositions = new Float32Array(n * 3);
    this._baseNormals   = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this._basePositions[i * 3]     = pos.getX(i);
      this._basePositions[i * 3 + 1] = pos.getY(i);
      this._basePositions[i * 3 + 2] = pos.getZ(i);
      this._baseNormals[i * 3]     = nrm.getX(i);
      this._baseNormals[i * 3 + 1] = nrm.getY(i);
      this._baseNormals[i * 3 + 2] = nrm.getZ(i);
    }
    this._gridSize = Math.round(Math.sqrt(n));

    if (this.render.gpuPtsProxy) {
      const ptsGeo = this.render.gpuPtsProxy.geometry;
      const pp = ptsGeo.attributes.position;
      if (!ptsGeo.attributes.normal) ptsGeo.computeVertexNormals();
      const pn = ptsGeo.attributes.normal;
      this._basePtsPositions = new Float32Array(pp.count * 3);
      this._basePtsNormals   = new Float32Array(pp.count * 3);
      for (let i = 0; i < pp.count; i++) {
        this._basePtsPositions[i * 3]     = pp.getX(i);
        this._basePtsPositions[i * 3 + 1] = pp.getY(i);
        this._basePtsPositions[i * 3 + 2] = pp.getZ(i);
        this._basePtsNormals[i * 3]     = pn.getX(i);
        this._basePtsNormals[i * 3 + 1] = pn.getY(i);
        this._basePtsNormals[i * 3 + 2] = pn.getZ(i);
      }
    }
  }

  /** Restore geometry to the snapshotted base positions. */
  _restoreBasePositions() {
    if (!this._basePositions) return;
    const pos = this.render.gpuMesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i,
        this._basePositions[i * 3],
        this._basePositions[i * 3 + 1],
        this._basePositions[i * 3 + 2]
      );
    }
    pos.needsUpdate = true;
  }

  // ── Private — surface blend ───────────────────────────────────────────────

  /**
   * Apply hf, blending from _prevHF if a formula transition is in progress.
   * Steady-state allocations are zero — _blendBuf is reused every frame
   * and only resized when the geometry's vertex count changes.
   */
  _applyHFWithBlend(hf) {
    if (!this._blendActive) {
      this._applyHF(hf);
      return;
    }

    const elapsed = performance.now() - this._blendStart;
    const rawT    = Math.min(1, elapsed / this._blendDuration);
    const blendT  = easeInOutCubic(rawT);

    // _prevHF can mismatch hf in size if a geometry rebuild slipped
    // between the snapshot and the first new tick. Skip the blend rather
    // than try to interpolate between incompatible shapes.
    if (!this._prevHF || this._prevHF.length !== hf.length) {
      this._blendActive = false;
      this._applyHF(hf);
      return;
    }

    if (!this._blendBuf || this._blendBuf.length !== hf.length) {
      this._blendBuf = new Float32Array(hf.length);
    }

    const buf  = this._blendBuf;
    const prev = this._prevHF;
    for (let i = 0, n = hf.length; i < n; i++) {
      buf[i] = prev[i] + (hf[i] - prev[i]) * blendT;
    }

    this._applyHF(buf);

    if (rawT >= 1) this._blendActive = false;
  }

  /** Push a height field into both the main mesh and the points proxy. */
  _applyHF(hf) {
    applyHeightField(this.render.gpuMesh.geometry, hf);
    if (this.render.gpuPtsProxy) applyHeightField(this.render.gpuPtsProxy.geometry, hf);
  }
}
