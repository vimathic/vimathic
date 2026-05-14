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
  trackOverlay:      'track-overlay',
  trackOverlayName:  'track-overlay-name',
  showTrackName:     'show-track-name',

  // ── Visual mode / shape / color ─────────────────────────────────────────
  shapeSel:          'shape-sel',
  gpuSel:            'gpu-sel',
  colorSel:          'color-sel',
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
  trebleSens:        'treble-sens',
  tsv:               'tsv',
  bloom:             'bloom',
  blmv:              'blmv',

  // ── Camera buttons ──────────────────────────────────────────────────────
  btnReset:          'btn-reset',
  btnResetAll:       'btn-reset-all',
  btnAr:             'btn-ar',

  // ── Viewport tools ──────────────────────────────────────────────────────
  btnFullscreen:     'btn-fullscreen',
  btnFreezeFrame:    'btn-freeze-frame',
  btnToggleGrid:     'btn-toggle-grid',
  btnTranspBg:       'btn-transp-bg',
  beatRing:          'beat-ring',
  hotkeyHint:        'hotkey-hint',

  // ── Stats badges ────────────────────────────────────────────────────────
  fps:               'fps',
  fpsInline:         'fps-inline',
  gpuMem:            'gpu-mem',

  // ── Presets / state import-export ───────────────────────────────────────
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
  // Generated dynamically by buildMathCollectionUI() — not always present.
  mathFormulaSelect: 'math-formula-select',
  mathFormulaInfo:   'math-formula-info',
  mathApplyBtn:      'math-apply-btn',
};

// ── ID-list exports for tests ────────────────────────────────────────────
//
// Smoke tests (tests/e2e/smoke.spec.js) need to verify the HTML actually
// contains every id JS expects. Previously the test maintained its own
// hand-curated `requiredIds` array — a subset of REQUIRED, kept in sync
// manually. That's the classic two-sources-of-truth trap: rename an id
// in dom.js + index.html, forget the smoke array, and the test happily
// continues to pass on whatever subset it was checking.
//
// Exporting the lists from here makes dom.js the single source of truth.
// A new id added to REQUIRED is automatically smoke-tested; an id removed
// from REQUIRED stops being checked. No second list to forget.
//
// Note: the runtime boot in resolveGroup() ALREADY throws when a required
// id is missing. The smoke test confirms that behaviour holds in a real
// browser — useful regression coverage if anyone ever weakens resolveGroup.
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
