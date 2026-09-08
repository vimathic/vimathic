// overlay-focus.js — keyboard containment for the five modal overlays.
//
// ── What was already solved, and what was not ───────────────────────────────
// The CLOSED half is done and is not this file's business: index.html gives a
// shut overlay `visibility:hidden`, which takes its subtree out of the focus
// order, out of hit testing and out of the accessibility tree in one
// declaration. Before that, 30 of the first 80 tab stops landed inside dialogs
// nobody could see, 9 of them in INPUT/SELECT/TEXTAREA — the exact tags both
// global keydown handlers stand down for — so hotkeys went dead with nothing on
// screen to explain it.
//
// The OPEN half was never addressed. An overlay that opens does not take focus,
// does not give it back when it closes, and does not hold it: Tab walks straight
// out of the dialog and into the controls panel behind it, which is still fully
// focusable under a backdrop that only blocks the POINTER. So a keyboard user
// reading the docs tabs into sliders they cannot see, and a screen reader is
// told a modal dialog is open while the focus ring is somewhere else entirely.
//
// ── Why a MutationObserver rather than calls at each site ───────────────────
// These overlays are opened and closed from a lot of places: five open sites
// across modals.js and shaders.js, five × buttons, five backdrop-click handlers,
// one Escape loop that closes all of them at once (controls.js), and closeAbout,
// which exists precisely because one of those paths had already been missed. A
// pair of calls per site is eleven pairs to keep in step, and the eleventh is
// the one that gets forgotten — that is the shape of half the defects in this
// repository. The class IS the state, so watching the class covers every path
// including ones added later, and there is nothing to remember.
//
// Cost: five observers on one attribute of five elements. They fire when a
// dialog opens or closes and at no other time.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Every overlay that behaves as a modal dialog.
 *
 * The same five ids the Escape handler in controls.js closes, plus About, which
 * that handler routes through closeAbout() instead. Kept here as the one list
 * so a sixth dialog joins both behaviours by being added once.
 */
export const OVERLAY_IDS = [
  'about-overlay',
  'shader-editor-overlay',
  'cam-editor-overlay',
  'audio-src-overlay',
  'output-overlay',
];

const isRendered = el =>
  !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

function focusablesIn(overlay) {
  return Array.from(overlay.querySelectorAll(FOCUSABLE)).filter(isRendered);
}

/**
 * Start containing focus for every overlay that exists.
 *
 * Safe to call once at boot. Overlays absent from a trimmed HTML variant —
 * second-screen.html has none of them — are skipped.
 *
 * All the mutable state lives in here rather than at module scope. Two dialogs
 * are not reachable at once today (the buttons that open them are in the panel,
 * and the panel is inert while one is up), but the background bookkeeping has
 * to be right about it anyway: the first version held a single "who inerted the
 * page" flag, and with a second dialog open that flag left the SECOND dialog
 * inert — modal, on screen, and unusable — because it had been marked as
 * background before it opened.
 */
export function bindOverlayFocus(ids = OVERLAY_IDS) {
  // Every browser that can run this app — WebGL2, ES modules, three r169 — has
  // had MutationObserver for over a decade, so this guard is not about
  // browsers. It is about the Node-side wiring tests, which call bindControls
  // against a DOM stub of their own: without it, adding this one line to
  // bindControls threw ReferenceError and took a dozen unrelated tests with it.
  // Named rather than swallowed, because a real browser reaching here would
  // mean dialogs silently stopped holding the keyboard.
  if (typeof MutationObserver === 'undefined') {
    console.warn('[overlay-focus] no MutationObserver — dialogs will not trap focus');
    return;
  }
  /** Overlays open right now. */
  const openNow = new Set();
  /** Elements this binding put `inert` on, and must take it off again. */
  let inerted = [];

  /**
   * Re-derive what is background from what is open.
   *
   * Released and re-taken rather than incrementally adjusted, so the answer
   * never depends on the order dialogs happened to open and close in. It runs
   * on open and on close, over five or six top-level elements.
   */
  const refreshBackground = () => {
    for (const el of inerted) el.inert = false;
    inerted = [];
    if (!openNow.size) return;
    for (const el of document.body.children) {
      if (openNow.has(el)) continue;   // an open dialog is not background
      if (el.inert) continue;          // somebody else's claim; leave it alone
      el.inert = true;
      inerted.push(el);
    }
  };

  const watch = (overlay) => {
    let returnTo  = null;
    let onKeydown = null;

    const enter = () => {
      if (onKeydown) return;
      // Where the focus ring was, so it can go back there. Restoring focus is
      // not a nicety: when a dialog closes, `visibility:hidden` makes whatever
      // is focused inside it unfocusable and the browser drops focus to <body>
      // — so a keyboard user who closes the shader editor is returned to the
      // top of the document rather than to the button they opened it with.
      returnTo = document.activeElement;
      openNow.add(overlay);
      refreshBackground();

      onKeydown = (e) => {
        if (e.key !== 'Tab') return;
        const items = focusablesIn(overlay);
        if (!items.length) { e.preventDefault(); return; }
        const first  = items[0];
        const last   = items[items.length - 1];
        const active = document.activeElement;
        const inside = overlay.contains(active);
        if (e.shiftKey ? (active === first || !inside) : (active === last || !inside)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus({ preventScroll: true });
        }
      };
      // Capture phase: the editors' own key handling (Ctrl+S to apply, the code
      // textarea) runs on the way up, and the trap has to decide before it.
      document.addEventListener('keydown', onKeydown, true);

      // Focus the DIALOG, not its first control. index.html records that the
      // buttons inside carry `transition:all .15s` and inherit the visibility
      // change through it, so for ~70 ms after the overlay opens they are still
      // hidden — and .focus() on a hidden element silently does nothing, which
      // would leave focus on the panel behind with the trap armed around it.
      // The container is visible immediately (`visibility 0s 0s` in the open
      // state), and focusing it is also what makes a screen reader announce the
      // dialog it has just been told is modal.
      overlay.tabIndex = -1;
      const preferred = overlay.querySelector('[data-autofocus]');
      if (preferred && isRendered(preferred)) preferred.focus({ preventScroll: true });
      if (!overlay.contains(document.activeElement)) overlay.focus({ preventScroll: true });
    };

    const leave = () => {
      if (!onKeydown) return;
      document.removeEventListener('keydown', onKeydown, true);
      onKeydown = null;
      openNow.delete(overlay);
      refreshBackground();
      const back = returnTo;
      returnTo = null;
      // Only if it is still in the document and still focusable — the preset
      // list and the docs tabs are rebuilt while a dialog is up, so the element
      // that opened one may not be the same node by the time it closes.
      if (back && back.isConnected && typeof back.focus === 'function' && isRendered(back)) {
        back.focus({ preventScroll: true });
      }
    };

    new MutationObserver(() => {
      if (overlay.classList.contains('open')) enter();
      else leave();
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });

    // The About modal opens itself on a first run, which can happen before or
    // after this binds depending on load order.
    if (overlay.classList.contains('open')) enter();
  };

  for (const id of ids) {
    const overlay = document.getElementById(id);
    if (overlay) watch(overlay);
  }
}
