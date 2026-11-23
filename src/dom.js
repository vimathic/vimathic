// dom.js — single source of truth for DOM lookups.
//
// All elements that JavaScript reads from index.html are resolved once,
// at module load, into the exported DOM object. Missing required elements
// raise a single descriptive error during boot instead of producing a
// cryptic `TypeError: Cannot read properties of null` later on, when a
// listener finally fires.
//
// Adding a new control:
//   1. Add the id to index.html.
//   2. Add the camelCase key + id below in REQUIRED (or OPTIONAL).
//   3. Reference DOM.myKey from the calling module — no `getElementById`
//      elsewhere in app code.
//
// Out of scope:
//   • Dynamically created elements (toasts, vcam preview, popups) —
//     they don't exist in the initial HTML and are owned by their creators.
//   • Buttons built into shadow-roots inside dynamic panes (camera editor
//     keyframe rows, preset cards) — those are wired by the code that
//     generates them.

const REQUIRED = {
  // ── Transport / playlist ────────────────────────────────────────────────
  playBtn:           'play-btn',
  prevBtn:           'prev-btn',
  nextBtn:           'next-btn',
  plClear:           'pl-clear',
  plDrop:            'pl-drop',
  plList:            'pl-list',
  plEmpty:           'pl-empty',
  plCount:           'pl-count',
  audioFile:         'audio-file',

  // ── Seek bar + loading ──────────────────────────────────────────────────
  seekTrack:         'seek-track',
  seekFill:          'seek-fill',
  seekCur:           'seek-cur',
  seekTot:           'seek-tot',
  trackLoading:      'track-loading',
  trackLoadingFill:  'track-loading-fill',
  // Added by the r5 commit that gave undecodable audio a visible channel, and
  // left outside this map. Both readers guard with `if (!el) return`, so
  // nothing throws — which is the problem: delete the element and the only
  // on-screen report of a file that will not decode goes away in silence, boot
  // still succeeds and no test says anything.
  trackError:        'track-error',
  trackOverlay:      'track-overlay',
  trackOverlayName:  'track-overlay-name',
  showTrackName:     'show-track-name',

  // ── Visual mode / shape / color ─────────────────────────────────────────
  shapeSel:          'shape-sel',
  gpuSel:            'gpu-sel',
  colorSel:          'color-sel',
  // ⟳ AUTO toggles beside the two look dropdowns. Registered here so the smoke
  // test's id contract covers them; the material *select* itself is still
  // resolved by getElementById inside controls.js, where its whole block is
  // written to tolerate a build without it.
  colorAuto:           'color-auto',
  nightBtn:            'night-btn',
  surfaceMaterialAuto: 'surface-material-auto',
  // Particle style — the PTS counterpart of the surface material row.
  particleStyleWrap:   'particle-style-wrap',
  particleStyleSel:    'particle-style-sel',
  particleStyleDesc:   'particle-style-desc',
  // Wire style — the WIRE counterpart of the particle style row.
  wireStyleWrap:       'wire-style-wrap',
  wireStyleSel:        'wire-style-sel',
  wireStyleDesc:       'wire-style-desc',
  modeSurface:       'mode-surface',
  modeWireframe:     'mode-wireframe',
  modePoints:        'mode-points',
  deformSurface:     'deform-surface',
  deformVolume:      'deform-volume',
  deformCollapse:    'deform-collapse',
  volumeFormulaWrap: 'volume-formula-wrap',
  volumeFormulaSel:  'volume-formula-sel',
  volumeFormulaDesc: 'volume-formula-desc',

  // ── Sliders + their value displays ──────────────────────────────────────
  amplitude:         'amplitude',
  ampv:              'ampv',
  waveInt:           'wave-int',
  wiv:               'wiv',
  bassSens:          'bass-sens',
  bsv:               'bsv',
  bandDepth:         'band-depth',
  bdv:               'bdv',
  bandCharacter:     'band-character',
  trebleSens:        'treble-sens',
  tsv:               'tsv',
  bloom:             'bloom',
  blmv:              'blmv',

  // ── Shader knobs — the four free scalars a custom shader can read ───────
  // (and, on a numbered SHADER MODE entry, scale · depth · phase · palette).
  // They sit in the formula slot's second bank, #shader-knobs-wrap, below.
  shaderK0:          'shader-k0',
  shaderK1:          'shader-k1',
  shaderK2:          'shader-k2',
  shaderK3:          'shader-k3',
  k0v:               'k0v',
  k1v:               'k1v',
  k2v:               'k2v',
  k3v:               'k3v',

  // ── Formula knobs — the other engine's two, see PARAMS.detail / .phase ───
  formulaDetail:     'formula-detail',
  formulaPhase:      'formula-phase',
  fdv:               'fdv',
  fpv:               'fpv',
  // The formula slot's two banks: the pair's wrapper and the Shader Knobs'
  // wrapper, which take turns by engine (_syncFormulaKnobs in controls.js
  // shows one, or both while a custom shader is applied over a formula). Both
  // are dereferenced by that sync, so both belong in this contract — an id app
  // code reads without being listed here is exactly what d2d2713 found and
  // closed. FIX(shader knobs): fkNote, the NO EFFECT line under a dimmed pair,
  // left with the dimming; the slot swaps banks instead.
  formulaKnobsWrap:  'formula-knobs-wrap',
  shaderKnobsWrap:   'shader-knobs-wrap',

  // ── Camera buttons ──────────────────────────────────────────────────────
  btnReset:          'btn-reset',
  btnResetAll:       'btn-reset-all',
  btnAr:             'btn-ar',

  // ── Viewport tools ──────────────────────────────────────────────────────
  btnFullscreen:     'btn-fullscreen',
  btnFreezeFrame:    'btn-freeze-frame',
  btnToggleStars:    'btn-toggle-stars',
  btnToggleGrid:     'btn-toggle-grid',
  btnTranspBg:       'btn-transp-bg',
  beatRing:          'beat-ring',
  hotkeyHint:        'hotkey-hint',

  // ── Stats badges ────────────────────────────────────────────────────────
  fps:               'fps',
  fpsInline:         'fps-inline',
  gpuMem:            'gpu-mem',

  // ── Presets / state import-export ───────────────────────────────────────
  // btnExport was the only id in index.html that app code dereferenced without
  // being in this map — counted across src/, 80 raw lookups over 47 ids, and
  // this was the one. Its sibling btn-import was here from the start, which is
  // how the gap survived a reading: the pair looks complete. controls.js did
  // `getElementById('btn-export').addEventListener(...)` with no `?.`, well
  // inside bindControls, so losing the id would throw there and take every
  // binding after that line with it — the panel would come up looking normal
  // and half of it would be inert, with one console error to explain it.
  // In this map, a missing id is a named error at boot instead.
  btnExport:         'btn-export',
  btnImport:         'btn-import',
  stateFile:         'state-file',
  presetName:        'preset-name',
  btnPresetSave:     'btn-preset-save',
  presetList:        'preset-list',

  // ── Clip player ─────────────────────────────────────────────────────────
  btnClipPlay:       'btn-clip-play',
  btnClipStop:       'btn-clip-stop',
  btnClipSkip:       'btn-clip-skip',
  clipHold:          'clip-hold',
  clipBars:          'clip-bars',
  clipModeSec:       'clip-mode-sec',
  clipModeBars:      'clip-mode-bars',
  clipStatus:        'clip-status',
  clipProgress:      'clip-progress',
  clipSyncMusic:     'clip-sync-music',
  clipCamMode:       'clip-cam-mode',

  // ── 3D model loader ─────────────────────────────────────────────────────
  modelDropZone:     'model-drop-zone',
  modelFile:         'model-file',
  modelInfo:         'model-info',
  btnClearModel:     'btn-clear-model',

  // ── Output / virtual camera modal ───────────────────────────────────────
  btnOpenOutput:     'btn-open-output',
  outputOverlay:     'output-overlay',
  outClose:          'out-close',
  outFeedback:       'out-feedback',
  outputStatus:      'output-status',
  outVcamBadge:      'out-vcam-badge',
  outVcamFps:        'out-vcam-fps',
  outBtnVcamStart:   'out-btn-vcam-start',
  outBtnVcamStop:    'out-btn-vcam-stop',
  outBtnVcamPreview: 'out-btn-vcam-preview',
  outBtnTransp:      'out-btn-transp',
  outTranspState:    'out-transp-state',

  // ── Second screen ───────────────────────────────────────────────────────
  btnSecondScreen:     'btn-second-screen',
  btnSecondScreenStop: 'btn-second-screen-stop',

  // ── Audio source modal ──────────────────────────────────────────────────
  btnAudioSrc:       'btn-audio-src',
  audioSrcOverlay:   'audio-src-overlay',
  asClose:           'as-close',
  asStatus:          'as-status',
  asDeviceSel:       'as-device-sel',
  asRefreshDevs:     'as-refresh-devs',
  asBtnFile:         'as-btn-file',
  asBtnMic:          'as-btn-mic',
  asBtnTab:          'as-btn-tab',
  asBtnDisplay:      'as-btn-display',
  asBtnStop:         'as-btn-stop',

  // ── Shader editor ───────────────────────────────────────────────────────
  btnOpenEditor:        'btn-open-editor',
  shaderEditorOverlay:  'shader-editor-overlay',
  seClose:              'se-close',
  seCode:               'se-code',
  seLineNums:           'se-line-nums',
  seError:              'se-error',
  seBtnApply:           'se-btn-apply',
  seBtnReset:           'se-btn-reset',
  sePresetWrap:         'se-preset-wrap',

  // ── Camera editor ───────────────────────────────────────────────────────
  btnOpenCamEditor:  'btn-open-cam-editor',
  camEditorOverlay:  'cam-editor-overlay',
  ceClose:           'ce-close',
  ceCode:            'ce-code',
  ceError:           'ce-error',
  ceBtnApply:        'ce-btn-apply',
  ceBtnReset:        'ce-btn-reset',
  cePresetWrap:      'ce-preset-wrap',
  cePaneCode:        'ce-pane-code',
  cePaneParams:      'ce-pane-params',
  cePaneTimeline:    'ce-pane-timeline',
  ceKfList:          'ce-kf-list',
  ceTlAdd:           'ce-tl-add',
  ceTlBar:           'ce-tl-bar',
  ceTlPlayhead:      'ce-tl-playhead',

  // ── MIDI panel ──────────────────────────────────────────────────────────
  midiBadge:         'midi-badge',
  midiLearnStatus:   'midi-learn-status',
  midiMappingList:   'midi-mapping-list',
  btnMidiLearn:      'btn-midi-learn',
  btnMidiClear:      'btn-midi-clear',

  // ── Panel chrome ────────────────────────────────────────────────────────
  ctrlHeader:        'ctrl-header',
  ctrlCollapse:      'ctrl-collapse',

  // ── About / documentation modal ─────────────────────────────────────────
  btnAbout:          'btn-about',
  aboutOverlay:      'about-overlay',
  aboutBox:          'about-box',
  aboutTabs:         'about-tabs',
  aboutContent:      'about-content',
  aboutClose:        'about-close',
};

// Features that some HTML variants disable. Boot tolerates these being null;
// call sites must guard against undefined access (existing code already does
// via optional chaining).
const OPTIONAL = {
  // ── Math formula picker (in-panel) ──────────────────────────────────────
  //
  // FIX(#29, r3): reserved keys. math-collections.js exports
  // buildMathCollectionUI() / bindMathCollectionUI(), but nothing calls them,
  // so these ids never reach the DOM and always resolve to null. Kept so the
  // lookup surface exists once the picker is wired in; must stay OPTIONAL
  // until then — in REQUIRED, resolveGroup() would abort boot.
  mathFormulaSelect: 'math-formula-select',
  mathFormulaInfo:   'math-formula-info',
  mathApplyBtn:      'math-apply-btn',
};

// ── ID-list exports for tests ────────────────────────────────────────────
//
// The smoke test asserts index.html carries every id JS expects. It reads
// these exports instead of keeping its own array, which keeps dom.js the
// single source of truth: a hand-copied list drifts silently on a rename and
// goes on passing against whatever subset it still holds. resolveGroup()
// already throws on a missing required id at boot — the smoke test pins that
// behaviour in a real browser, in case anyone weakens the resolver.
export const REQUIRED_IDS = Object.values(REQUIRED);
export const OPTIONAL_IDS = Object.values(OPTIONAL);

function resolveGroup(map, required) {
  const out = {};
  const missing = [];
  for (const [key, id] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (!el && required) missing.push(id);
    out[key] = el;
  }
  if (required && missing.length) {
    throw new Error(
      `[DOM] Required elements missing from HTML: ${missing.join(', ')}. ` +
      `Boot aborted — fix index.html or add to OPTIONAL in dom.js.`,
    );
  }
  return out;
}

// For elementOwnsKey, below: the keys a slider steps by, and the keys a
// readOnly picker reads, lowercased. 'Up' / 'Down' / 'Left' / 'Right' and 'Esc'
// are IE/old-Edge's spellings, accepted for the same reason as 'Spacebar' there.
const ARROW_KEYS  = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'up', 'down', 'left', 'right']);
const STEP_KEYS   = new Set([...ARROW_KEYS, 'home', 'end', 'pageup', 'pagedown']);
// FIX(review RR-C3 / RR-LIVE-1): exactly the keys the picker's own keydown
// handler reads — index.html, makeDropdown, `input.addEventListener('keydown',
// …)`: Escape and Enter close the list, ArrowDown and ArrowUp step it, in the
// open state and the closed one alike — plus the old spellings of those same
// keys. That handler is the source of truth, and
// tests/hotkey-focus-standdown.test.js reads both and fails when they part.
// This used to be every key a list COULD be driven by (the side arrows, Home,
// End, Page Up / Down and Space as well), which the widget acts on none of: a
// readOnly field with no text does nothing with them either. So after a mouse
// pick Space (play / pause) and ← / → (tracks) went to a field that dropped
// them while main.js stood down for it, and stayed dead until the canvas was
// clicked. Now they pass, like the letters.
const PICKER_KEYS = new Set(['arrowup', 'arrowdown', 'enter', 'escape', 'up', 'down', 'esc']);
// Input types that are pressed, not typed into or stepped.
const BUTTON_LIKE_INPUTS = new Set(['button', 'submit', 'reset', 'image', 'color', 'file']);

/**
 * Does the focused element already mean something by this key?
 *
 * Both global keydown listeners — main.js's hotkeys and controls.js's
 * hold-and-drag — have to stand down when the keyboard belongs to whatever has
 * focus. They each carried their own copy of the rule, spelled
 * `['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)`, and
 * that list is short by every element that is activated by a KEY rather than
 * typed into.
 *
 * A focused <button> reports BUTTON and a focused <summary> reports SUMMARY.
 * Neither was excluded, so `e.preventDefault()` in the hotkey handler cancelled
 * the browser's own activation. Measured in Chrome: tab to ☾ NIGHT, press Space
 * — the class on the button is unchanged, NIGHT did not toggle, and the
 * transport has flipped from ▶ PLAY to ⏸ STOP. The keypress was not dead, which
 * is how it was first filed; it did something else instead. index.html carries
 * 63 buttons and 7 <summary> elements, one of which is ADVANCED — the half of
 * the panel holding audio sensitivity, presets, model import, both editors,
 * video output and MIDI, unopenable from the keyboard.
 *
 * The rule is per KEY, not per element, and that is deliberate. Standing down
 * for every keystroke while a button has focus would be simpler and wrong for
 * this app: clicking any button with the mouse leaves it focused, and D, F, R
 * and T are performance hotkeys that must keep working after a click. A button
 * consumes Space and Enter and nothing else, so that is exactly what it gets.
 *
 * FIX(review K1): the same argument was never applied to <input>, which owned
 * EVERY key whatever its type. Two kinds of input in the panel take no text at
 * all and keep focus after a mouse gesture: the pickers (3D SHAPE, SHADER
 * MODE, COLOR SCHEME, VOLUME FORMULA — index.html's makeDropdown turns each
 * into a readOnly text field, and picking an option calls preventDefault, so
 * the field stays focused on purpose), and every range slider, which Chrome
 * focuses on a mouse drag. So "pick a numbered shader, then play its knobs" —
 * the main use of the Y U H J keys — did nothing until the canvas was clicked,
 * and neither did D F R T after a slider was touched; hotkeys.md documented
 * the workaround. Letters may pass now because nothing in those inputs reads a
 * letter: the pickers stopped taking text when they became readOnly (01.09),
 * and a slider never did. What each of them DOES read it keeps:
 *   • a text-entry input (text, search, number, email, date, … — any type not
 *     named below) that is writable owns every key, as before: typing is not
 *     a hotkey. That covers the preset name and a value badge being typed in;
 *   • a readOnly one — the pickers — owns the keys its list handler reads:
 *     ↑ and ↓, which step it, and Enter and Escape, which close it. FIX(review
 *     RR-C3): this said "the keys a list is driven by: the arrows, Home / End /
 *     Page Up / Page Down, Enter, Escape and Space", and the picker reads only
 *     four of them — so Space and ← / → work right after a pick now (see
 *     PICKER_KEYS above);
 *   • a range owns the arrows and Home / End / Page Up / Page Down;
 *   • a checkbox owns Space, and a radio Space and the arrows;
 *   • the button-like types (button, submit, reset, image, color, file) own
 *     Space and Enter, exactly as a <button> does;
 *   • a disabled input owns nothing, like a disabled button — it takes no key
 *     and no focus.
 * SELECT and TEXTAREA still own every key: native type-ahead and text. A
 * closed native <select> jumps to the option a typed letter starts, so letting
 * letters through would change the option AND fire the hotkey. That leaves the
 * panel's plain drop-downs — the ones makeDropdown does not wrap: Surface
 * Material, Particle Style, Wire Style, the clip player's Bars and Camera, and
 * the "+ Add parameter…" list in MIDI mapping — standing every key down after a
 * mouse pick, as before, and documents/hotkeys.md says so (FIX(review RR-C1)).
 * FIX(review RR3-C2): this said "the MIDI mapping lists". A CC row's own
 * parameter list gives focus up as soon as a pick changes its value: the
 * change handler re-renders the mapping list (modals.js _renderMappings
 * empties it), the focused <select> leaves the page and focus falls back to
 * the body, so the keys work right after that pick. (FIX(review RR4-2): a pick
 * that changes nothing — the same option again, or Esc — fires no change, and
 * that list then keeps focus like any plain drop-down.) The add row's list,
 * which has no change handler, keeps focus and every key after every pick.
 * Wrapping them, or blurring one after a pointer pick, is a behaviour change
 * left to the owner.
 *
 * @param {Element|null} el  usually document.activeElement
 * @param {string} key       KeyboardEvent.key
 * @returns {boolean} true when the listener must not act on this key
 */
export function elementOwnsKey(el, key) {
  if (!el) return false;
  // A contenteditable host reports its own tag — DIV, SPAN, anything — so the
  // tag check below cannot see it. Nothing in index.html is contenteditable
  // today; a rendered document or a future inline editor would be.
  if (el.isContentEditable) return true;

  const tag = el.tagName;
  if (tag === 'SELECT' || tag === 'TEXTAREA') return true;

  // 'Spacebar' is IE/old-Edge's spelling and costs one comparison to accept.
  const k = String(key ?? '').toLowerCase();
  const isSpace = k === ' ' || k === 'spacebar';
  const isActivation = isSpace || k === 'enter';

  if (tag === 'INPUT') {
    if (el.disabled) return false;
    // A browser reports `type` lowercased and 'text' when the attribute is
    // missing or unknown; a stand-in object may carry none at all.
    const type = String(el.type || 'text').toLowerCase();
    if (type === 'range')    return STEP_KEYS.has(k);
    if (type === 'checkbox') return isSpace;
    if (type === 'radio')    return isSpace || ARROW_KEYS.has(k);
    if (BUTTON_LIKE_INPUTS.has(type)) return isActivation;
    return el.readOnly ? PICKER_KEYS.has(k) : true;
  }

  // <summary> is activated by both, like a button. A disabled button is
  // activated by neither, and is not focusable in the first place.
  if (tag === 'BUTTON' || tag === 'SUMMARY') return isActivation && !el.disabled;

  // A link follows on Enter only — Space scrolls the page there, which no
  // listener here is trying to preserve. Without href it is not a link at all.
  if (tag === 'A') return k === 'enter' && !!el.hasAttribute?.('href');

  return false;
}

// Node guard: tests may import REQUIRED_IDS / OPTIONAL_IDS to drive smoke
// assertions, and Playwright's test files run in Node where `document`
// doesn't exist. Without this guard, that import would crash inside
// resolveGroup() before the test could even start. In any real browser
// boot path `document` is present and the resolver runs as before.
const HAS_DOCUMENT = typeof document !== 'undefined';

/**
 * Resolved DOM elements. Read-only at runtime: keys map to either an
 * HTMLElement (required, always defined) or HTMLElement|null (optional).
 *
 * Two helpers cover the small set of ids that are built from a string
 * concatenation in app code:
 *   modeBtn('surface')     → <button id="mode-surface">
 *   deformBtn('volume')    → <button id="deform-volume">
 *
 * When imported outside a browser (e.g. from a Node-side test runner that
 * only wants REQUIRED_IDS), DOM is an empty object with the same helper
 * surface but stub functions — call sites still get a defined export.
 */
export const DOM = HAS_DOCUMENT ? {
  ...resolveGroup(REQUIRED, true),
  ...resolveGroup(OPTIONAL, false),

  modeBtn:   m => document.getElementById('mode-'   + m),
  deformBtn: m => document.getElementById('deform-' + m),
} : {
  modeBtn:   () => null,
  deformBtn: () => null,
};
