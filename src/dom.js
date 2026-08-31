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
