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
// The class also writes the small "🎹 MIDI: N" badge in the top bar
// directly via getElementById — see _init's `attach` for the rationale.
export class MIDIController {
  constructor() {
    // CC → param id mapping, persisted across sessions in localStorage.
    // Shape: { [ccNumber]: paramId }. 'none' is not stored; a CC with no
    // entry is treated as unmapped.
    this._map        = this._loadMap();
    // Learn-mode state: when _learnParam is non-null, the next incoming CC
    // becomes the mapping target for that param, and normal dispatch is
    // skipped for that one message.
    this._learnCC    = null;
    this._learnParam= null;

    // Callbacks wired by UIController. No-op defaults mean a CC can arrive
    // before the UI has attached without a TypeError.
    this.cb = {
      onCC:        (_cc, _val01) => {},
      onParamSet:  (_id, _val)   => {},
      onLearnDone: (_cc, _id)    => {},
      onDevices:   (_n)          => {},
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
   */
  setMapping(cc, paramId) {
    for (const k of Object.keys(this._map)) {
      if (this._map[k] === paramId && paramId !== 'none') delete this._map[k];
    }
    if (paramId === 'none') {
      delete this._map[cc];
    } else {
      this._map[cc] = paramId;
    }
    this._saveMap();
  }

  /** Look up the param id bound to a CC; 'none' for unmapped. */
  getMapping(cc) { return this._map[cc] ?? 'none'; }

  /** All current bindings as [{cc, paramId}], sorted by CC number. */
  getMappings() {
    return Object.entries(this._map)
      .map(([cc, id]) => ({ cc: +cc, paramId: id }))
      .sort((a, b) => a.cc - b.cc);
  }

  /** Wipe every binding. UI calls this from the "Clear All" button. */
  clearAllMappings() {
    this._map = {};
    this._saveMap();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

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

        // Scale the 0..1 CC value into the param's declared range, round
        // for integer params, and fire onParamSet. Unmapped CCs reach here
        // and quietly fall through.
        const paramId = this._map[cc];
        if (paramId && paramId !== 'none') {
          const def = MIDI_PARAMS.find(p => p.id === paramId);
          if (def) {
            let val = def.min + val01 * (def.max - def.min);
            if (def.integer) val = Math.round(val);
            this.cb.onParamSet(paramId, val);
          }
        }
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
    try { return JSON.parse(localStorage.getItem('vimathic_midi_map') || '{}'); } catch (_) { return {}; }
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
