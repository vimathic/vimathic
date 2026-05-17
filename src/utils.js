// utils.js — shared utilities used across the app.
//
// Three independent exports, grouped here because each is too small for
// its own file and they have no internal coupling:
//
//   • fmt            — human-readable mm:ss for the seek bar.
//   • MIDIController — Web MIDI access, CC↔param mapping persistence, learn
//                      mode, and dispatch of mapped CCs to the engine.
//   • ShuffleBag     — non-repeating random draw for hotkey randomisers.
//
// MIDI_PARAMS is defined in params.js (the registry that drives sliders,
// MIDI mappings and preset capture). It's re-exported from here so older
// call sites that grew up importing from utils.js keep working without an
// import-site rewrite.

import { MIDI_PARAMS } from './params.js';
export { MIDI_PARAMS };

// ── Time formatting ─────────────────────────────────────────────────────────

/**
 * Format seconds as m:ss for the seek bar. Negative / non-finite inputs
 * return '0:00' rather than NaN — protects the UI from a transient
 * duration=NaN frame while audio metadata is still loading.
 */
export const fmt = s =>
  !isFinite(s) || s < 0 ? '0:00'
  : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ── MIDIController ──────────────────────────────────────────────────────────
//
// Owns the Web MIDI access lifecycle and the CC → paramId mapping table
// persisted in localStorage. Mapped CC moves dispatch through onParamSet,
// which UIController turns into applyParam() calls (slider + display + engine).
//
// Three event sources, all handled via the cb callbacks:
//   • Raw CC firing      → onCC          (every Control Change, mapped or not)
//   • Mapped CC firing   → onParamSet    (after CC→param resolution + scaling)
//   • Learn completed    → onLearnDone   (after startLearn → first CC received)
//   • Device count change → onDevices    (statechange from MIDI subsystem)
//
// ── Relative vs absolute CC interpretation ──────────────────────────────
// Each mapping has a `mode` field — 'relative' or 'absolute' — stored in
// the mapping table alongside paramId.
//
//   absolute: CC value 0..127 maps linearly to [param.min, param.max].
//             Standard MIDI knob/fader behaviour. The same physical
//             position always produces the same engine value.
//
//   relative: CC value is a signed delta — each turn of an infinite
//             encoder ticks the engine value up or down by an increment.
//             The encoder never "overrides" the engine value; it adjusts
//             from wherever the value currently is. This is the right
//             choice for VJ rigs where the user may have pushed a value
//             to 500 via click-to-type and doesn't want the next knob
//             twist to clobber it back to the 0..3 absolute range.
//
//             Relative requires reading the current engine value to add
//             the delta to — done via the cb.getParamValue(paramId)
//             callback, which UIController wires to PARAMS[id].get(ctx).
//
// Default for new mappings is 'relative' — the project ships for
// hardware-encoder rigs. Absolute is selectable per-mapping in the MIDI
// panel UI for users with traditional pot/fader controllers.
//
// ── Relative encoder format detection ───────────────────────────────────
// Three formats are in the wild:
//   • Two's complement / signed 7-bit:  +1 = 0x01,  -1 = 0x7F   (most)
//   • Sign-magnitude:                   +1 = 0x01,  -1 = 0x41
//   • Binary offset:                    +1 = 0x41,  -1 = 0x3F
//
// We decode Two's complement by default — by far the most common format
// (Mackie Control, MPK Mini Plus in relative mode, most DAW-grade
// encoders). Other formats can be added per-mapping if/when a user
// reports their controller misbehaves. _decodeRelativeDelta() is the
// single point of change.
//
// The class also writes the small "🎹 MIDI: N" badge in the top bar
// directly via getElementById — see _init's `attach` for the rationale.
export class MIDIController {
  constructor() {
    // CC → mapping table, persisted across sessions in localStorage.
    //
    // Shape: { [ccNumber]: { paramId, mode } } where mode is
    // 'relative' (default — for rotary encoders) or 'absolute' (linear
    // CC→range, classic potentiometer/fader behaviour).
    //
    // Legacy persisted shape was { [ccNumber]: paramId } — a bare string
    // per CC. _loadMap migrates that on read: any string entry is
    // upgraded to { paramId, mode: 'relative' }. Saving always uses the
    // new shape, so the legacy form disappears after one save cycle.
    this._map        = this._loadMap();
    // Last-seen CC value per cc, for relative encoders that use absolute
    // CC values internally (fallback when delta decode is ambiguous).
    // Two's complement decode doesn't need this — kept for future
    // sign-magnitude / binary-offset modes.
    this._lastCC     = {};
    // Learn-mode state: when _learnParam is non-null, the next incoming CC
    // becomes the mapping target for that param, and normal dispatch is
    // skipped for that one message.
    this._learnCC    = null;
    this._learnParam= null;

    // Callbacks wired by UIController. No-op defaults mean a CC can arrive
    // before the UI has attached without a TypeError.
    this.cb = {
      onCC:           (_cc, _val01)  => {},
      onParamSet:     (_id, _val)    => {},
      // Relative mode needs to read the current engine value before
      // adding the delta. UIController wires this to PARAMS[id].get(ctx).
      // Default 0 keeps relative mappings inert until the UI attaches —
      // safer than NaN propagating into engine state.
      getParamValue:  (_id)          => 0,
      onLearnDone:    (_cc, _id)     => {},
      onDevices:      (_n)           => {},
    };

    this._init();
  }

  // ── Learn mode ────────────────────────────────────────────────────────────

  /**
   * Arm learn mode. The next CC received from any input will be mapped
   * to paramId, after which normal dispatch resumes. Calling startLearn
   * again before a CC arrives simply retargets the pending learn.
   */
  startLearn(paramId) {
    this._learnCC    = null;
    this._learnParam = paramId;
  }

  /** Abandon a pending learn without consuming the next CC. */
  cancelLearn() {
    this._learnCC    = null;
    this._learnParam = null;
  }

  /**
   * Bind a CC to a param explicitly (dropdown-driven, not learn-driven).
   *
   * Enforces one-CC-per-param: if paramId is already attached to a
   * different CC, that older binding is dropped before the new one is
   * written. The sentinel paramId 'none' deletes the binding entirely.
   * Without this rule, the dropdown UI could leave two CCs pointing at
   * the same param, with the most-recent-touched winning silently.
   *
   * @param {number} cc       — MIDI CC number
   * @param {string} paramId  — registry key, or 'none' to delete
   * @param {string} [mode]   — 'relative' (default for new bindings) or
   *                            'absolute'. When omitted on an update,
   *                            preserves any existing mode for that CC.
   */
  setMapping(cc, paramId, mode) {
    for (const k of Object.keys(this._map)) {
      if (this._map[k]?.paramId === paramId && paramId !== 'none') delete this._map[k];
    }
    if (paramId === 'none') {
      delete this._map[cc];
    } else {
      const existing = this._map[cc];
      this._map[cc] = {
        paramId,
        mode: mode ?? existing?.mode ?? 'relative',
      };
    }
    this._saveMap();
  }

  /** Switch a CC's mode between 'relative' and 'absolute'. No-op for unmapped CCs. */
  setMappingMode(cc, mode) {
    const entry = this._map[cc];
    if (!entry) return;
    entry.mode = mode === 'absolute' ? 'absolute' : 'relative';
    this._saveMap();
  }

  /** Look up the param id bound to a CC; 'none' for unmapped. */
  getMapping(cc) { return this._map[cc]?.paramId ?? 'none'; }

  /** Look up the full mapping record for a CC, or null. */
  getMappingEntry(cc) { return this._map[cc] ?? null; }

  /** All current bindings as [{cc, paramId, mode}], sorted by CC number. */
  getMappings() {
    return Object.entries(this._map)
      .map(([cc, entry]) => ({ cc: +cc, paramId: entry.paramId, mode: entry.mode }))
      .sort((a, b) => a.cc - b.cc);
  }

  /** Wipe every binding. UI calls this from the "Clear All" button. */
  clearAllMappings() {
    this._map = {};
    this._saveMap();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Decode a raw 0–127 CC byte into a signed delta normalised to ±N/63
   * where N is the encoder tick count. Mackie-style relative (signed
   * 7-bit, "Relative #1"):
   *   0x01..0x3F  →  +1..+63    (positive ticks; magnitude in low 6 bits)
   *   0x40        →  0          (rarely sent, treat as inert)
   *   0x41..0x7F  →  -1..-63    (negative ticks; sign bit 0x40 set,
   *                              magnitude in low 6 bits)
   *   0x00        →  0          (some encoders idle at 0)
   *
   * Returns the normalised delta in units of "fraction of normal range",
   * i.e. ±1/63 per encoder click (so a 63-click sweep covers one full
   * normal range). Caller multiplies by (def.max - def.min) to convert
   * to engine-space delta.
   *
   * Why 63 not 127 as the divisor: in this encoding, the magnitude part
   * is 6 bits (max value 63), not 7. Dividing by 127 would make every
   * click feel half as sensitive as the encoder hardware intends.
   *
   * Other formats (sign-magnitude #2, binary-offset, etc.) can be added
   * here when a controller reports incorrectly. The decoder is the single
   * point of change for encoder hardware quirks.
   */
  _decodeRelativeDelta(raw) {
    if (raw === 0 || raw === 0x40) return 0;
    // Sign bit is 0x40 (bit 6). Low 6 bits (mask 0x3F) hold magnitude.
    const magnitude = raw & 0x3F;
    const negative  = (raw & 0x40) !== 0;
    return (negative ? -magnitude : magnitude) / 63;
  }


  /**
   * Request Web MIDI access and attach handlers. No-op when the browser
   * doesn't expose Web MIDI (Safari, Firefox without flag) or the user
   * declines the permission prompt — the rest of the app keeps working
   * with the MIDI features disabled.
   */
  async _init() {
    if (!navigator.requestMIDIAccess) return;
    try {
      const access  = await navigator.requestMIDIAccess();
      const handler = msg => {
        // MIDI status byte layout: high nibble = message type, low nibble =
        // channel. 0xB0..0xBF is Control Change on channels 1..16. We treat
        // every channel identically — separating by channel would force
        // users to also pick a channel in the learn flow, which they almost
        // never need.
        const [status, cc, rawVal] = msg.data;
        if ((status & 0xf0) !== 0xb0) return;
        const val01 = rawVal / 127;

        // Learn mode short-circuit. The CC that completes a learn is
        // *not* dispatched as a value change — the user is binding the
        // knob, not turning it. Releasing learn after one message keeps
        // the interaction symmetrical with the UI prompt.
        if (this._learnParam !== null) {
          this.setMapping(cc, this._learnParam);
          this.cb.onLearnDone(cc, this._learnParam);
          this._learnParam = null;
          this._learnCC    = cc;
          return;
        }

        this.cb.onCC(cc, val01);

        // Resolve mapping. Unmapped CCs reach here and quietly fall through.
        const entry = this._map[cc];
        if (!entry || entry.paramId === 'none') return;
        const def = MIDI_PARAMS.find(p => p.id === entry.paramId);
        if (!def) return;

        let val;
        if (entry.mode === 'relative') {
          // Relative encoder: decode signed delta, scale to an engine-space
          // step that adapts to the current value, add to current value.
          //
          // ── Step-size policy: log-bounded, not strictly proportional ──
          //
          // Naive "step = |cur|" causes runaway: each tick adds a fraction
          // of the current value, the current value grows, the next tick's
          // step grows in turn — exponential. A fast twist can hit 1e+20
          // in seconds. Strict proportionality is dV/dt ∝ V → V(t) = V₀eᵏᵗ.
          //
          // Fix: step grows with log₂(value), not value. The multiplier
          // stays small even at large values:
          //   cur=extendedMax    → step × 1     (normal)
          //   cur=2·extendedMax  → step × 1.58
          //   cur=10·extendedMax → step × 3.46
          //   cur=100·extendedMax→ step × 6.66
          //   cur=1000·extMax    → step × 9.97
          //
          // So a sustained one-direction twist that reaches very large
          // values requires *more* clicks per decade, not fewer. The user
          // can still reach 500 from 1 in a few revolutions, but cannot
          // accidentally overshoot to 1e+27 — escape velocity is bounded.
          //
          // In the normal range (cur ≤ def.max), the multiplier is 1 and
          // behaviour is identical to the old fixed-step approach.
          const delta01 = this._decodeRelativeDelta(rawVal);
          if (delta01 === 0) return;
          const cur       = this.cb.getParamValue(entry.paramId);
          const stepBase  = def.max - def.min;
          const absVal    = Math.abs(cur);
          // Log-bounded multiplier: 1 in normal range, log₂-growing above.
          // +1 inside log keeps the value defined and ≥1 at the boundary.
          const overshoot = absVal > def.max ? absVal / def.max : 1;
          const mult      = overshoot > 1 ? Math.log2(overshoot + 1) : 1;
          const step      = stepBase * mult;
          val = cur + delta01 * step;
          if (def.integer) val = Math.round(val);
          // Lower clamp at def.min so a knob spam at the bottom doesn't
          // drift negative. No upper clamp — extended values stay extended.
          if (val < def.min) val = def.min;
        } else {
          // Absolute: linear CC→range mapping. Standard MIDI knob.
          val = def.min + val01 * (def.max - def.min);
          if (def.integer) val = Math.round(val);
        }

        this.cb.onParamSet(entry.paramId, val);
      };

      // Re-attaching on every statechange handles hot-plug: a USB MIDI
      // controller plugged in mid-session shows up in inputs only after
      // the change event. Clearing onmidimessage to null first prevents
      // double-firing on inputs that are already wired from a previous
      // attach pass.
      //
      // The badge update lives inside attach (not via cb) because the
      // badge is owned by this controller's UX surface — it must stay
      // truthful to the actual MIDI subsystem state even if no UI has
      // wired onDevices yet. Acceptable architectural exception to the
      // "no DOM in services" rule given how localised the effect is.
      const attach = () => {
        for (const input of access.inputs.values()) {
          input.onmidimessage = null;
          input.onmidimessage = handler;
        }
        const n = access.inputs.size;
        const badge = document.getElementById('midi-badge');
        if (badge) {
          badge.classList.toggle('active', n > 0);
          badge.textContent = n > 0 ? `🎹 MIDI: ${n}` : '🎹 MIDI';
        }
        this.cb.onDevices(n);
      };
      attach();
      access.onstatechange = attach;
    } catch (err) {
      // Permission denial or unsupported environment — log and carry on.
      console.warn('[MIDI] Access denied or unavailable:', err);
    }
  }

  // localStorage helpers — best-effort. Private/incognito modes throw on
  // write; the catch keeps the controller working without persistence.
  _saveMap() {
    try { localStorage.setItem('vimathic_midi_map', JSON.stringify(this._map)); } catch (_) {}
  }
  _loadMap() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem('vimathic_midi_map') || '{}'); } catch (_) { return {}; }
    if (!raw || typeof raw !== 'object') return {};
    // Migration: legacy shape was { [cc]: paramId } (string). Upgrade
    // any string entries to { paramId, mode: 'relative' }. Already-new
    // entries pass through. Save isn't triggered here — the next
    // setMapping call writes the migrated shape; until then the
    // in-memory map is correct and persistence catches up on first edit.
    const out = {};
    for (const [cc, v] of Object.entries(raw)) {
      if (typeof v === 'string') {
        out[cc] = { paramId: v, mode: 'relative' };
      } else if (v && typeof v === 'object' && v.paramId) {
        out[cc] = { paramId: v.paramId, mode: v.mode === 'absolute' ? 'absolute' : 'relative' };
      }
      // Anything else: drop silently (corrupt entry).
    }
    return out;
  }
}

// ── ShuffleBag (non-repeating random) ─────────────────────────────────────────
//
// Draws items from a pool in random order without repetition. When the
// deck runs out it reshuffles automatically, and the reshuffle guarantees
// that the new top of deck is not equal to the last drawn item — so even
// across deck boundaries the caller never sees the same value twice in a
// row (unless the pool has size 1, where repetition is unavoidable).
//
// Motivation: plain Math.random() on small pools — 9 shapes, 36 color
// schemes — repeats unpleasantly often. With 9 items, the same value
// returns roughly every ninth call on average, and there's no guarantee
// of *any* spread before a repeat. ShuffleBag is the "Spotify-shuffle"
// pattern: each item is dealt once before any reshuffle, then the deck
// is reshuffled with a no-repeat guard at the seam.
//
// Usage:
//   const bag = new ShuffleBag(['a','b','c']);
//   bag.next();  // → some item from the deck
//   bag.next();  // → a different item
//   bag.next();  // → the remaining one; deck now empty
//   bag.next();  // → reshuffle, never the same as the previous draw
//
// For pools of objects (e.g. formula descriptors that are rebuilt on each
// list query and so lack stable reference identity), pass an equality
// predicate so the boundary-repeat guard compares by id rather than ref:
//
//   const bag = new ShuffleBag(formulas, (a,b) => a.key === b.key);
export class ShuffleBag {
  /**
   * @param {Array} items — pool to draw from. Copied internally; safe to mutate later.
   * @param {(a: any, b: any) => boolean} [eq] — equality for the no-repeat-across-decks guard.
   *                                              Defaults to `===` (correct for primitives).
   */
  constructor(items, eq) {
    if (!items || !items.length) throw new Error('ShuffleBag: items must be non-empty');
    this._items = items.slice();
    this._eq    = eq || ((a, b) => a === b);
    this._deck  = [];
    this._last  = null;
  }

  /** Draw the next item. Never throws once constructed; auto-refills. */
  next() {
    if (this._deck.length === 0) this._refill();
    this._last = this._deck.pop();
    return this._last;
  }

  /** Most recently drawn item, or null if .next() has never been called. */
  peekLast() { return this._last; }

  /** Number of items remaining before the next reshuffle. */
  get remaining() { return this._deck.length; }

  /** Total pool size. */
  get size() { return this._items.length; }

  /** Forget the last-drawn item and clear the deck. Useful for tests. */
  reset() { this._deck = []; this._last = null; }

  /**
   * Fisher-Yates shuffle, then a one-swap guard against deck-boundary
   * repetition. next() pops from the end, so if the end of the freshly
   * shuffled deck equals _last, we swap it with a random non-end slot.
   * Skip the guard for pools of size 1 — repetition is unavoidable there
   * and the swap would loop forever.
   */
  _refill() {
    const a = this._items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (this._last !== null && a.length > 1 && this._eq(a[a.length - 1], this._last)) {
      const k = Math.floor(Math.random() * (a.length - 1));
      [a[a.length - 1], a[k]] = [a[k], a[a.length - 1]];
    }
    this._deck = a;
  }
}
