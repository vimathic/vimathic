// ── AutoCycler ────────────────────────────────────────────────────────────────
/**
 * Unattended, non-repeating cycling of one enumerated look parameter — the
 * engine behind the ⟳ AUTO buttons next to Color Scheme and Surface Material.
 *
 * The class knows nothing about colours, materials or the DOM. It owns three
 * things and nothing else:
 *
 *   1. WHEN to change      — see "Cadence" below;
 *   2. WHAT to change to   — a ShuffleBag draw, so a palette does not come back
 *                            until the whole pool has been through;
 *   3. HOW LONG the change should take — a duration handed to `apply`, scaled
 *      off the cadence so the fade is always a fraction of the gap, never a cut.
 *
 * Everything device-specific is injected as a callback, which is also what
 * makes the whole file testable under plain `node --test` (see
 * tests/auto-cycle.test.js) — no document, no engine, no audio graph.
 *
 * ── Cadence ──────────────────────────────────────────────────────────────────
 * Two regimes, decided fresh at every reschedule so switching between them
 * needs no notification:
 *
 *   music playing  → musical time: `bars` bars of the detected BPM
 *                    (8 bars @ 120 BPM ≈ 16 s), so the visual turns over with
 *                    the track instead of drifting across its phrasing;
 *   music stopped  → wall time: a fixed `idleMs`, because there is no beat to
 *                    hang the change on and a frozen picture is not what the
 *                    button was switched on for.
 *
 * A BPM of 0 / NaN (nothing detected yet) falls back to the idle interval
 * rather than dividing by it.
 *
 * ── Why setTimeout and not the render loop ───────────────────────────────────
 * Same reasoning as ClipPlayer: wall-clock scheduling keeps running at (a
 * throttled) pace when the tab is hidden, where an rAF-driven counter would
 * freeze entirely. There is no timeline to be in sync with here, so unlike
 * ClipPlayer there is no catch-up pass — a hidden tab simply changes its look
 * less often, and picks the cadence back up when it returns.
 *
 * ── Interaction with everything else that writes the same parameter ──────────
 * The cycler is not exclusive: hotkeys, the dropdown and preset loads all keep
 * writing colour and material while AUTO is on. Two rules keep that from
 * reading as a fight:
 *   • `current()` is consulted before every draw, so the bag never hands back
 *     what is already on screen (its own no-repeat guard only knows about its
 *     own draws — a hand-picked value is invisible to it);
 *   • `defer()` restarts the countdown, so a manual pick gets its full period
 *     of screen time instead of being overwritten a moment later.
 *
 * Ownership over the *clip player's* preset steps is deliberately NOT here:
 * ClipPlayer reads `enabled` and passes preserveColor / preserveMaterial into
 * applyState, the same shape as the camera's claim (see clip-player.js).
 */

import { ShuffleBag } from '../utils.js';

export class AutoCycler {
  /**
   * @param {object}            opts
   * @param {Array}             opts.pool          — values to draw from (copied).
   * @param {(v, ms) => void}   opts.apply         — apply a drawn value; `ms` is
   *                                                 the transition duration the
   *                                                 cadence asks for.
   * @param {() => any}         [opts.current]     — live value, so a draw never
   *                                                 repeats what is on screen.
   * @param {() => boolean}     [opts.isPlaying]   — is music playing right now.
   * @param {() => number}      [opts.bpm]         — detected BPM (0 if unknown).
   * @param {() => boolean}     [opts.canFire]     — veto for a single tick with
   *                                                 the schedule left running
   *                                                 (material is meaningless in
   *                                                 WIRE/PTS, where its dropdown
   *                                                 is hidden).
   * @param {(on:boolean)=>void}[opts.onToggle]    — enabled-state changed.
   * @param {number}            [opts.bars]        — musical period, default 8.
   * @param {number}            [opts.idleMs]      — silent period, default 12000.
   * @param {number}            [opts.minFadeMs]   — fade floor, default 600.
   * @param {number}            [opts.maxFadeMs]   — fade ceiling, default none
   *                                                 (Infinity). See below.
   * @param {number}            [opts.fadeRatio]   — fade as a share of the
   *                                                 period, default 1 — the
   *                                                 fade IS the period.
   * @param {(a,b)=>boolean}    [opts.eq]          — value equality, default ===.
   */
  constructor(opts = {}) {
    this.pool       = (opts.pool ?? []).slice();
    this.bars       = opts.bars      ?? 8;
    this.idleMs     = opts.idleMs    ?? 12000;
    this.minFadeMs  = opts.minFadeMs ?? 600;
    this.maxFadeMs  = opts.maxFadeMs ?? Infinity;
    this.fadeRatio  = opts.fadeRatio ?? 1;

    this._apply     = opts.apply     ?? (() => {});
    this._current   = opts.current   ?? (() => null);
    this._isPlaying = opts.isPlaying ?? (() => false);
    this._bpm       = opts.bpm       ?? (() => 0);
    this._canFire   = opts.canFire   ?? (() => true);
    this._onToggle  = opts.onToggle  ?? (() => {});
    this._eq        = opts.eq        ?? ((a, b) => a === b);

    // ShuffleBag throws on an empty pool — a build variant without the control
    // (or a <select> that lost its options) should switch AUTO into a no-op,
    // not take boot down with it.
    this._bag = this.pool.length ? new ShuffleBag(this.pool, this._eq) : null;

    this.enabled  = false;
    this._timerId = null;
  }

  /**
   * Swap the pool this draws from — NIGHT narrows AUTO COLOUR to its own
   * palettes and back again.
   *
   * The bag is rebuilt rather than filtered: a ShuffleBag's no-repeat guard is
   * a deck it deals from, and a deck holding values that are no longer in the
   * pool would keep dealing them until it emptied. Rebuilding also resets the
   * "not twice in a row" seam, which is right — across a pool change there is
   * no run to protect.
   *
   * Does not fire, and does not reschedule: what is on screen keeps its full
   * period. A caller that wants the new pool visible now says so itself.
   */
  setPool(pool) {
    this.pool = (pool ?? []).slice();
    // Same reason as the constructor: an empty pool makes AUTO a no-op rather
    // than throwing out of a UI event handler.
    this._bag = this.pool.length ? new ShuffleBag(this.pool, this._eq) : null;
  }

  // ── Cadence ───────────────────────────────────────────────────────────────

  /** Milliseconds until the next change, under the regime in force right now. */
  periodMs() {
    if (!this._isPlaying()) return this.idleMs;
    const bpm = this._bpm();
    if (!Number.isFinite(bpm) || bpm <= 0) return this.idleMs;
    const barMs = (60000 / bpm) * 4;              // 4/4, same assumption as ClipPlayer
    return Math.max(1, Math.round(barMs * this.bars));
  }

  /**
   * How long the fade into the next value should take.
   *
   * The whole period, by default — so there is no dwell at all: a value
   * arrives and is already on its way to the next one.
   *
   * This used to be 0.35 of the period under a 3 s ceiling, and the ceiling is
   * what the owner was looking at when he said "the palette just hangs there
   * for ages". At the shipped 8-bar cadence that is 3 s of crossfade and 13 s
   * of a still picture (16 bars for material: 3 s and 29 s) — which reads as a
   * switch, not as drift, because the in-between shades go past in a fifth of
   * the time they are on screen. The old rationale here — "slow ones don't
   * spend ten seconds in a half-mixed state" — had it backwards for this
   * instrument: the half-mixed state IS the thing worth looking at.
   *
   * Chaining back-to-back is safe rather than lucky. setColorSchemeAnimated
   * lands on uCM = uCMNext, uCMBlend = 0 in its onDone, and TransitionManager
   * retires a tween BEFORE calling onDone specifically so a callback can start
   * the next one in the same slot. Timer jitter is invisible either way: a
   * touch early leaves startBlend > 0.5 and the engine rebases onto the value
   * it was nearly at, a touch late is a few ms of stillness.
   *
   * The floor still matters, and now it is the only clamp: at a period under
   * minFadeMs the fade would outlast its own period and each change would
   * cancel the one before it mid-way. That needs a cadence below 600 ms — 8
   * bars at 3200 BPM — but a floor is cheaper than finding out.
   */
  fadeMs(period = this.periodMs()) {
    return Math.round(
      Math.max(this.minFadeMs, Math.min(this.maxFadeMs, period * this.fadeRatio)),
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Switch on. Fires once straight away: a mode that acts on its own has to
   * show it is on, and with the fade in place that first change reads as the
   * feature introducing itself rather than as a jump.
   */
  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this._onToggle(true);
    this.fire();
  }

  /** Switch off. Leaves whatever value is currently applied on screen. */
  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this._clearTimer();
    this._onToggle(false);
  }

  /** @returns {boolean} the new enabled state. */
  toggle() {
    if (this.enabled) this.disable(); else this.enable();
    return this.enabled;
  }

  /**
   * Someone else just set this parameter by hand (dropdown, hotkey, preset).
   * Give their pick a full period before the next automatic change instead of
   * overwriting it on a countdown that was already half spent. No-op while off.
   */
  defer() {
    if (!this.enabled) return;
    this._schedule();
  }

  /** Draw and apply one value, then arm the next tick. */
  fire() {
    if (!this.enabled) return;
    if (this._bag && this._canFire()) {
      const period = this.periodMs();
      this._apply(this._draw(), this.fadeMs(period));
    }
    this._schedule();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * One bag draw, with a single retry when it lands on the value already on
   * screen. The bag guards its own seams, but a value set by hand between two
   * draws is invisible to it — without the retry, switching AUTO on right after
   * picking Mirror by hand could "change" to Mirror.
   */
  _draw() {
    const v = this._bag.next();
    const cur = this._current();
    if (cur == null || this._bag.size < 2 || !this._eq(v, cur)) return v;
    return this._bag.next();
  }

  _schedule() {
    this._clearTimer();
    this._timerId = setTimeout(() => {
      this._timerId = null;
      this.fire();
    }, this.periodMs());
  }

  _clearTimer() {
    if (this._timerId !== null) clearTimeout(this._timerId);
    this._timerId = null;
  }
}
