// ── FormulaPicker ─────────────────────────────────────────────────────────────
/**
 * The pool behind the R and F hotkeys: one random draw from everything the
 * FORMULA dropdown offers.
 *
 * ── The bug this exists to prevent ───────────────────────────────────────────
 * #gpu-sel holds two families: 38 GPU shaders (numeric values, drawn on the GPU
 * through uMode) and 192 CPU math formulas (`m:collection:key`, height fields
 * computed in the worker). The randomiser used to build its bag straight from
 * getAllFormulasList(), which knows only the second family — so no amount of
 * pressing R or F could ever land on a GPU shader. Not a weighting problem: the
 * shaders were not in the pool at all.
 *
 * Keeping the pool here, behind one class with both families passed in, is what
 * makes that answerable by a test instead of by pressing the key and waiting.
 *
 * ── Why 50/50 and not one flat pool ──────────────────────────────────────────
 * A flat pool of 230 would fix "never", and replace it with "one press in six".
 * Ten presses would show no shader about one time in six — indistinguishable
 * from still-broken for the operator who reported it. The two families are also
 * what the dropdown itself groups by, and they are different kinds of thing to
 * look at, not 230 interchangeable items. So the coin is flipped between the
 * families first, and the draw happens inside the chosen one. gpuShare makes
 * that a number rather than an opinion buried in code.
 *
 * Each family keeps its own ShuffleBag, so within a family nothing repeats until
 * that family has been dealt out — the "Spotify shuffle" property the hotkeys
 * already had, now per family.
 */

import { ShuffleBag } from './utils.js';

export class FormulaPicker {
  /**
   * @param {object}   opts
   * @param {string[]} [opts.gpuValues]   — #gpu-sel values of the GPU shaders
   *                                        (numeric strings). Read from the live
   *                                        dropdown by the caller, so a shader
   *                                        added to index.html is reachable with
   *                                        no JS edit — same rule the D and T
   *                                        hotkeys follow for their selects.
   * @param {object[]} [opts.cpuFormulas] — getAllFormulasList() entries
   *                                        ({ collectionId, key, … }).
   * @param {number}   [opts.gpuShare]    — probability of drawing from the GPU
   *                                        family when both are available.
   * @param {function} [opts.random]      — injectable RNG, for tests.
   */
  constructor({ gpuValues = [], cpuFormulas = [], gpuShare = 0.5, random = Math.random } = {}) {
    this.gpuShare = gpuShare;
    this._random  = random;

    // ShuffleBag throws on an empty pool; an absent family must degrade to
    // "draw from the other one", not take the hotkey down.
    this._gpuBag = gpuValues.length ? new ShuffleBag(gpuValues.slice()) : null;
    this._cpuBag = cpuFormulas.length
      // Compared by (collectionId, key): getAllFormulasList() builds fresh
      // objects on every call, so reference identity would not survive a
      // re-list and the no-repeat guard at the deck seam would go blind.
      ? new ShuffleBag(cpuFormulas.slice(),
                       (a, b) => a.collectionId === b.collectionId && a.key === b.key)
      : null;
  }

  /** True when there is anything at all to draw. */
  get isEmpty() { return !this._gpuBag && !this._cpuBag; }

  /**
   * One draw, as a #gpu-sel value string — either a numeric GPU shader index or
   * `m:collection:key`. null when both families are empty.
   *
   * The value shape is deliberate: it is exactly what the dropdown carries, so
   * the caller applies it through the same branch the dropdown's own change
   * handler uses and no third code path can drift from the other two.
   */
  next() {
    if (!this._gpuBag) return this._nextCpu();
    if (!this._cpuBag) return this._gpuBag.next();
    return this._random() < this.gpuShare ? this._gpuBag.next() : this._nextCpu();
  }

  _nextCpu() {
    if (!this._cpuBag) return null;
    const pick = this._cpuBag.next();
    return `m:${pick.collectionId}:${pick.key}`;
  }
}

/** True if a #gpu-sel value names a CPU math formula rather than a GPU shader. */
export const isMathValue = value => typeof value === 'string' && value.startsWith('m:');
