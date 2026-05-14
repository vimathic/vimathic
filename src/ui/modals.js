// modals.js — DOM event wiring for every overlay and panel section.
//
// Five surfaces share this file because each is a small bag of DOM
// listeners that doesn't justify its own module; together they form the
// "every modal opens, closes, and reacts" layer that sits between the
// services (audio, render, camera…) and the HTML.
//
//   bindOutputModal      — vcam start/stop/preview, second screen,
//                          transparent-bg toggle, recording (GIF/WebM).
//   bindAudioSourceModal — mic / tab / display capture flow + device list.
//   bindCameraEditor     — script status, code/timeline/params tabs,
//                          draggable keyframe markers, Ctrl+Enter apply.
//   bindShaderEditor     — compile-feedback panel, error-line highlight,
//                          line-number gutter sync, Tab-inserts-2-spaces.
//   bindCameraParams     — sliders that mutate cam.cpParams live.
//   bindMIDI             — learn mode, mapping table, clear-all.
//
// Called once from UIController.bindAll(). Everything here assumes the
// DOM is already in place — boot order guarantees that (see dom.js).
//
// ── Design notes ──────────────────────────────────────────────────────────
// • Modals use the .open class on the overlay element. Click-outside-to-
//   close is wired uniformly on the overlay element itself.
// • Service callbacks (cam.cb.*, audio.cb.*, etc.) are set INSIDE these
//   bind* functions, not at construction time. Two reasons: the DOM might
//   not be ready when services are created in main.js, and we want all
//   "DOM updates from service events" in one searchable file.

import { MIDI_PARAMS } from '../utils.js';
import { downloadBlob } from '../recorder.js';

export function bindModals(ui) {
  bindOutputModal(ui);
  bindAudioSourceModal(ui);
  bindCameraEditor(ui);
  bindShaderEditor(ui);
  bindCameraParams(ui);
  bindMIDI(ui);
}

// ══════════════════════════════════════════════════════════════════════════════
// OUTPUT MODAL — Virtual Camera, Second Screen, Transparent BG, Recording
// ══════════════════════════════════════════════════════════════════════════════

function bindOutputModal(ui) {
  const out = ui.output;
  const r   = ui.render;
  const ss  = ui.secondScreen;

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Status messages have two display surfaces: the feedback line inside
  // the modal (visible while it's open) and the status line on the panel
  // (visible after the modal closes). We always write to both so the user
  // sees the last action regardless of where they're looking.
  const setOutFeedback = (msg, color = '#778') => {
    const el = document.getElementById('out-feedback');
    if (el) { el.textContent = msg; el.style.color = color; }
    const st = document.getElementById('output-status');
    if (st) { st.textContent = msg; st.style.color = color; }
  };

  const openOutputModal = () => {
    // Refresh the vcam capability badge on every open. The capability is
    // computed at module-load time and shouldn't change, but writing the
    // badge here keeps the user-visible state aligned with whatever
    // OUTPUT_CAPABILITIES actually says — and survives any future runtime
    // capability re-detection.
    const vcamBadge = document.getElementById('out-vcam-badge');
    if (vcamBadge) vcamBadge.textContent = out.capabilities.virtualCamera ? 'Chrome ✓' : 'Not supported';

    document.getElementById('output-overlay').classList.add('open');
  };

  // ── Second Screen ─────────────────────────────────────────────────────────
  // Two buttons (open / stop) toggle visibility based on popup state.
  // SecondScreen owns the popup lifecycle; we just reflect it in the UI.
  const ssOpenBtn = document.getElementById('btn-second-screen');
  const ssStopBtn = document.getElementById('btn-second-screen-stop');

  if (ss && ssOpenBtn) {
    ssOpenBtn.addEventListener('click', () => ss.open(60));

    ss.cb.onOpen = () => {
      ssOpenBtn.style.display = 'none';
      ssStopBtn.style.display = '';
      setOutFeedback('🖥️ Second screen open — double-click popup for fullscreen', 'var(--cyan)');
    };
    ss.cb.onClose = () => {
      ssOpenBtn.style.display = '';
      ssStopBtn.style.display = 'none';
      setOutFeedback('Second screen closed', '#556');
    };
    ss.cb.onError = msg => {
      setOutFeedback('⚠ ' + msg, '#f66');
    };
  }
  if (ssStopBtn) ssStopBtn.addEventListener('click', () => ss?.close());

  document.getElementById('btn-open-output').addEventListener('click', openOutputModal);
  document.getElementById('out-close').addEventListener('click',       () => document.getElementById('output-overlay').classList.remove('open'));
  document.getElementById('output-overlay').addEventListener('click',  e  => { if (e.target.id === 'output-overlay') document.getElementById('output-overlay').classList.remove('open'); });

  // ── Transparent BG ────────────────────────────────────────────────────────
  // Two buttons drive the same toggle: a quick one on the side panel and a
  // labelled one inside the modal. Wired to a single handler so the panel
  // button and the modal button can't get out of sync.
  const _toggleTransp = () => {
    const enabled = !r.transparentBg;
    r.setTransparentBackground(enabled);
    const state = document.getElementById('out-transp-state');
    const panelBtn = document.getElementById('btn-transp-bg');
    const modalBtn = document.getElementById('out-btn-transp');
    if (state)    state.textContent  = enabled ? 'ON'  : 'OFF';
    if (state)    state.style.color  = enabled ? 'var(--green)' : '#445';
    if (panelBtn) { panelBtn.style.color = enabled ? 'var(--green)' : '#778'; panelBtn.style.borderColor = enabled ? 'rgba(0,255,170,.4)' : '#445'; }
    if (modalBtn) modalBtn.classList.toggle('active-out', enabled);
    setOutFeedback(enabled ? '🪟 Transparent BG ON — stars/fog hidden' : '🖥 Opaque background restored', enabled ? 'var(--green)' : '#778');
  };
  document.getElementById('btn-transp-bg')  .addEventListener('click', _toggleTransp);
  document.getElementById('out-btn-transp') .addEventListener('click', _toggleTransp);

  // ── Virtual Camera ────────────────────────────────────────────────────────
  // Start/stop/preview buttons. Preview button appears only after start
  // because there's nothing to preview before then.
  const vcamStartBtn   = document.getElementById('out-btn-vcam-start');
  const vcamStopBtn    = document.getElementById('out-btn-vcam-stop');
  const vcamPreviewBtn = document.getElementById('out-btn-vcam-preview');

  if (vcamStartBtn) vcamStartBtn.addEventListener('click', () => {
    if (!out.capabilities.virtualCamera) {
      setOutFeedback('⚠ captureStream not supported — use Chrome', '#f77'); return;
    }
    const fps = parseInt(document.getElementById('out-vcam-fps')?.value ?? '60', 10);
    const res = out.vcam.start(fps);
    if (res.ok) {
      vcamStartBtn.style.display   = 'none';
      vcamStopBtn.style.display    = '';
      vcamPreviewBtn.style.display = '';
      vcamStartBtn.classList.add('active-out');
      setOutFeedback(`📷 Virtual Camera active @ ${fps}fps — add as Browser Source in OBS`, 'var(--green)');
    } else {
      setOutFeedback('⚠ ' + res.error, '#f77');
    }
  });

  if (vcamStopBtn) vcamStopBtn.addEventListener('click', () => {
    out.vcam.stop();
    out.vcam.hidePreview();
    vcamStopBtn.style.display    = 'none';
    vcamPreviewBtn.style.display = 'none';
    vcamStartBtn.style.display   = '';
    setOutFeedback('Virtual Camera stopped', '#778');
  });

  if (vcamPreviewBtn) vcamPreviewBtn.addEventListener('click', () => out.vcam.showPreview());

  bindRecordingSection(ui, setOutFeedback);
}

// ── Recording (GIF / WebM) ──────────────────────────────────────────────────
//
// One UI section drives both recorders, picking the active one by a
// format toggle. Settings panes swap based on the toggle — GIF exposes
// size/fps/quality, WebM hides them and relies on MediaRecorder defaults
// (canvas-native size + 60 fps + VP9).
//
// Beat-sync mode is GIF-only: MediaRecorder can't be stopped exactly on
// a beat without trailing data, and the resulting WebM would be off by
// fractions of a beat — defeating the point of a beat-synced loop. The
// beat-mode toggle visibly disables itself when WebM is selected.
//
// Recorder callbacks are wired INSIDE the click handler (not at function
// init) so each run captures fresh `opts` in closure. The values are
// short-lived; over-writing callbacks per-run is cheaper than threading
// opts through to a module-level handler.
function bindRecordingSection(ui, setOutFeedback) {
  const gif  = ui.gifRec;
  const webm = ui.webmRec;
  if (!gif && !webm) return;

  const $ = id => document.getElementById(id);
  const fmtGifBtn    = $('rec-fmt-gif');
  const fmtWebmBtn   = $('rec-fmt-webm');
  const gifSettings  = $('rec-gif-settings');
  const sizeSel      = $('rec-gif-size');
  const fpsSel       = $('rec-gif-fps');
  const qualSel      = $('rec-gif-quality');
  const durModeSec   = $('rec-dur-mode-sec');
  const durModeBeat  = $('rec-dur-mode-beat');
  const durSecWrap   = $('rec-dur-sec-wrap');
  const durBeatWrap  = $('rec-dur-beat-wrap');
  const durSecSel    = $('rec-dur-sec');
  const durBeatSel   = $('rec-dur-beat');
  const startBtn     = $('rec-btn-start');
  const stopBtn      = $('rec-btn-stop');
  const progressWrap = $('rec-progress-wrap');
  const progressBar  = $('rec-progress-bar');
  const progressLbl  = $('rec-progress-label');

  if (!startBtn) return; // section not in DOM, nothing to wire

  // Local UI state. Format mirrors the toggle (gif|webm); durMode mirrors
  // the duration toggle (sec|beat). Both default to the safest choice.
  let currentFmt    = 'gif';
  let currentDurMode = 'sec';

  // ── Format toggle ────────────────────────────────────────────────────────
  const setFormat = fmt => {
    currentFmt = fmt;
    fmtGifBtn.style.background  = fmt === 'gif'  ? 'rgba(0,255,180,.18)' : '';
    fmtWebmBtn.style.background = fmt === 'webm' ? 'rgba(0,255,180,.18)' : '';
    // GIF-specific settings hidden for WebM (WebM uses native canvas size
    // and a fixed 60 fps + VP9 — see WebmRecorder.start for the rationale).
    gifSettings.style.display = fmt === 'gif' ? '' : 'none';
    // WebM + beat-sync is unsupported (see header note). Force back to
    // seconds mode and grey out the beat button so the user can see why.
    if (fmt === 'webm' && currentDurMode === 'beat') setDurMode('sec');
    durModeBeat.style.opacity      = fmt === 'webm' ? '.4' : '1';
    durModeBeat.style.pointerEvents = fmt === 'webm' ? 'none' : '';
  };
  fmtGifBtn.addEventListener('click',  () => setFormat('gif'));
  fmtWebmBtn.addEventListener('click', () => setFormat('webm'));

  // ── Duration mode toggle (seconds vs beats) ──────────────────────────────
  const setDurMode = mode => {
    currentDurMode = mode;
    durModeSec.style.background  = mode === 'sec'  ? 'rgba(0,255,180,.18)' : '';
    durModeBeat.style.background = mode === 'beat' ? 'rgba(0,255,180,.18)' : '';
    durSecWrap.style.display     = mode === 'sec'  ? '' : 'none';
    durBeatWrap.style.display    = mode === 'beat' ? '' : 'none';
  };
  durModeSec.addEventListener('click',  () => setDurMode('sec'));
  durModeBeat.addEventListener('click', () => setDurMode('beat'));

  // ── Progress display helpers ─────────────────────────────────────────────
  const showProgress = (pct, label) => {
    progressWrap.style.display = '';
    progressBar.style.width    = Math.round(pct * 100) + '%';
    if (label) progressLbl.textContent = label;
  };
  const hideProgress = () => {
    progressWrap.style.display = 'none';
    progressBar.style.width    = '0%';
  };

  // Lock all settings controls while recording so a mid-record change
  // can't corrupt the in-flight capture (e.g. switching format).
  const setRecording = isRec => {
    startBtn.style.display = isRec ? 'none' : '';
    stopBtn.style.display  = isRec ? ''     : 'none';
    [fmtGifBtn, fmtWebmBtn, durModeSec, durModeBeat,
     sizeSel, fpsSel, qualSel, durSecSel, durBeatSel
    ].forEach(el => { if (el) el.disabled = isRec; });
  };

  // ── Start action ─────────────────────────────────────────────────────────
  startBtn.addEventListener('click', () => {
    if (currentFmt === 'gif') {
      // 16:9 from the chosen height. The size select holds heights
      // (480/640/720) because that maps cleanly to "p"-labelled presets.
      const sz   = parseInt(sizeSel.value, 10);
      const fps  = parseInt(fpsSel.value, 10);
      const qual = parseInt(qualSel.value, 10);
      const height = sz;
      const width  = Math.round(sz * 16 / 9);

      const opts = {
        width, height, fps, quality: qual,
        // Floyd-Steinberg dithering for the highest-quality preset only.
        // It looks better on gradients but doubles encode time, so we
        // gate it on quality≤5 (the "best" end of the scale).
        dither: qual <= 5,
      };

      if (currentDurMode === 'beat') {
        if (!ui.audio?.isPlaying) {
          setOutFeedback('⚠ Beat mode needs audio playing first', '#f77');
          return;
        }
        opts.stopOnBeats = parseInt(durBeatSel.value, 10);
        opts.audioEngine = ui.audio;
      } else {
        opts.duration = parseInt(durSecSel.value, 10) * 1000;
      }

      // Capture and encoding are TWO distinct phases for GIF. We map
      // capture progress to the first 50% of the UI bar and encoding to
      // the second 50%, so the user sees continuous motion across the
      // capture→encode handoff instead of the bar jumping back to 0%.
      gif.cb.onStart    = () => {
        setRecording(true);
        showProgress(0, currentDurMode === 'beat'
          ? `Capturing… stop after ${opts.stopOnBeats} beats`
          : `Capturing… ${opts.duration/1000}s`);
        setOutFeedback('🎞️ Recording GIF…', 'var(--cyan)');
      };
      gif.cb.onProgress = pct => showProgress(pct * 0.5,
        `Capturing… ${Math.round(pct * 100)}%`);
      gif.cb.onEncoding = pct => showProgress(0.5 + pct * 0.5,
        `Encoding GIF… ${Math.round(pct * 100)}%`);
      gif.cb.onDone     = (blob, meta) => {
        setRecording(false);
        hideProgress();
        downloadBlob(blob, `vimathic-${Date.now()}.gif`);
        setOutFeedback(
          `✓ GIF saved: ${meta.frames} frames, ${meta.sizeMb.toFixed(1)} MB`,
          'var(--green)');
      };
      gif.cb.onError    = msg => {
        setRecording(false);
        hideProgress();
        setOutFeedback('⚠ ' + msg, '#f77');
      };
      gif.cb.onAbort    = () => {
        setRecording(false);
        hideProgress();
        setOutFeedback('Recording cancelled', '#778');
      };

      gif.start(opts);
    } else {
      // WebM is single-phase: MediaRecorder streams chunks while recording
      // and emits the final blob on stop, so the progress bar tracks
      // elapsed time directly.
      const opts = {
        duration:    parseInt(durSecSel.value, 10) * 1000,
        fps:         60,
        bitrateMbps: 8,
      };
      webm.cb.onStart    = () => {
        setRecording(true);
        showProgress(0, `Recording WebM… ${opts.duration/1000}s`);
        setOutFeedback('🎥 Recording WebM…', 'var(--cyan)');
      };
      webm.cb.onProgress = pct => showProgress(pct, `Recording… ${Math.round(pct*100)}%`);
      webm.cb.onDone     = (blob, meta) => {
        setRecording(false);
        hideProgress();
        // WebmRecorder only ever produces WebM today (vp9/vp8/webm
        // candidate list). The mp4 branch here is defensive in case a
        // future codec list adds an mp4 fallback.
        const ext = meta.mimeType.includes('webm') ? 'webm' : 'mp4';
        downloadBlob(blob, `vimathic-${Date.now()}.${ext}`);
        setOutFeedback(`✓ WebM saved: ${meta.sizeMb.toFixed(1)} MB`, 'var(--green)');
      };
      webm.cb.onError    = msg => {
        setRecording(false);
        hideProgress();
        setOutFeedback('⚠ ' + msg, '#f77');
      };
      webm.cb.onAbort    = () => {
        setRecording(false);
        hideProgress();
        setOutFeedback('Recording cancelled', '#778');
      };

      webm.start(opts);
    }
  });

  // ── Stop action ──────────────────────────────────────────────────────────
  stopBtn.addEventListener('click', () => {
    if (currentFmt === 'gif')  gif.stop();
    if (currentFmt === 'webm') webm.stop();
  });

  // Initialise defaults
  setFormat('gif');
  setDurMode('sec');
}

// ══════════════════════════════════════════════════════════════════════════════
// AUDIO SOURCE MODAL — Mic / Tab Audio / System Audio / File
// ══════════════════════════════════════════════════════════════════════════════

function bindAudioSourceModal(ui) {
  const a = ui.audio;

  const setAsStatus = (cls, msg) => {
    const el = document.getElementById('as-status');
    el.className = cls;
    el.textContent = msg;
  };

  // Top-bar button label reflects which capture mode is active. Falsy
  // mode = "no live capture, playing a file" — the default state.
  const updateAudioSrcBtn = (mode) => {
    const btn  = document.getElementById('btn-audio-src');
    const stop = document.getElementById('as-btn-stop');
    if (!btn) return;
    if (!mode) {
      btn.textContent = '🎙 AUDIO SOURCE: FILE';
      btn.style.color = 'var(--accent2)';
      btn.classList.remove('active-src');
      if (stop) stop.style.display = 'none';
      setAsStatus('info', 'No live capture active — using file playback');
    } else {
      const labels = { mic:'MICROPHONE', tab:'TAB AUDIO', display:'SYSTEM AUDIO' };
      btn.textContent = `🎙 AUDIO SOURCE: ${labels[mode] ?? mode.toUpperCase()}`;
      btn.style.color = 'var(--green)';
      btn.classList.add('active-src');
      if (stop) stop.style.display = '';
    }
  };

  // Populate the input-device dropdown. Labels are blanked out by the
  // browser until the user grants any media permission, so we fall back
  // to a truncated deviceId — better than an empty option.
  const populateDevices = async () => {
    const sel = document.getElementById('as-device-sel');
    const devices = await a.listAudioInputs();
    sel.innerHTML = '<option value="">— select input device —</option>';
    devices.forEach(d => {
      const opt = document.createElement('option');
      opt.value       = d.deviceId;
      opt.textContent = d.label || `Input ${d.deviceId.substring(0,8)}…`;
      sel.appendChild(opt);
    });
    if (!devices.length) {
      sel.innerHTML = '<option value="">No devices found — click ↺</option>';
    }
  };

  const openAudioSrcModal = () => {
    document.getElementById('audio-src-overlay').classList.add('open');
    populateDevices();
  };

  const connectMic = async () => {
    const deviceId = document.getElementById('as-device-sel').value || undefined;
    setAsStatus('info', '⏳ Connecting…');
    const res = await a.captureMicrophone(deviceId);
    if (res.ok) {
      setAsStatus('ok', `✔ Microphone active${deviceId ? ' ('+document.getElementById('as-device-sel').selectedOptions[0]?.text+')' : ''}`);
    } else {
      setAsStatus('err', '⚠ ' + res.error);
    }
  };

  // 'tab' and 'display' both go through getDisplayMedia; the hint selects
  // which share-target the browser pre-selects in its picker dialog.
  const connectDisplay = async (hint) => {
    setAsStatus('info', '⏳ Waiting for browser share dialog…');
    const res = await a.captureDisplay(hint);
    if (res.ok) {
      setAsStatus('ok', hint === 'tab' ? '✔ Tab audio active' : '✔ System audio active');
    } else {
      setAsStatus('err', '⚠ ' + res.error);
    }
  };

  // ── Wire DOM events ──────────────────────────────────────────────────────
  a.cb.onLiveMode = mode => updateAudioSrcBtn(mode);
  document.getElementById('btn-audio-src').addEventListener('click', openAudioSrcModal);
  document.getElementById('as-close').addEventListener('click',      () => document.getElementById('audio-src-overlay').classList.remove('open'));
  document.getElementById('audio-src-overlay').addEventListener('click', e => { if (e.target.id === 'audio-src-overlay') document.getElementById('audio-src-overlay').classList.remove('open'); });
  document.getElementById('as-btn-file').addEventListener('click',    () => { document.getElementById('audio-file').click(); document.getElementById('audio-src-overlay').classList.remove('open'); });
  document.getElementById('as-refresh-devs').addEventListener('click', populateDevices);
  document.getElementById('as-btn-mic').addEventListener('click',     connectMic);
  document.getElementById('as-btn-tab').addEventListener('click',     () => connectDisplay('tab'));
  document.getElementById('as-btn-display').addEventListener('click', () => connectDisplay('display'));
  // Stopping live capture flips us back to file mode. Also force isPlaying
  // false so the seek bar and play button reflect the silent state.
  document.getElementById('as-btn-stop').addEventListener('click',    () => { a.stopLiveCapture(); a.isPlaying = false; a.cb.onPlayState(false); });
}

// ══════════════════════════════════════════════════════════════════════════════
// CAMERA EDITOR — Script status, timeline, keyframes
// ══════════════════════════════════════════════════════════════════════════════

function bindCameraEditor(ui) {
  const cam = ui.camera;

  // ── Script status callbacks ──────────────────────────────────────────────
  // CameraSystem reports compile + runtime errors through these callbacks;
  // we render them into the small status line under the code pane.
  const _ceError = document.getElementById('ce-error');
  cam.cb.onScriptStatus = (type, msg) => {
    if (!_ceError) return;
    _ceError.textContent = type === 'clear' ? '' : msg;
    _ceError.style.color = type === 'ok' ? 'var(--green)' : '#f66';
  };

  cam.cb.onSetCode = code => {
    const el = document.getElementById('ce-code');
    if (el) el.value = code;
  };

  // Switch to the code pane and activate its tab. Called when a keyframe
  // is selected (so the user sees the keyframe's code immediately).
  const _switchToCodeTab = () => {
    document.getElementById('ce-pane-code').style.display     = '';
    document.getElementById('ce-pane-timeline').style.display = 'none';
    document.getElementById('ce-pane-params').style.display   = 'none';
    document.querySelectorAll('#cam-editor-box .ce-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.cetab === 'code'));
  };
  cam.cb.onSwitchToCode = _switchToCodeTab;

  // Auto-rotate is purely a camera concern. Volume-formula time pausing
  // lives on the freeze-frame button (#btn-freeze-frame in main.js) —
  // keeping the two controls separate avoids the surprise of "pause
  // rotation also freezes the deformation".
  cam.cb.onAutoRotChanged = enabled => {
    document.getElementById('btn-ar').textContent =
      enabled ? '↺ AUTO-ROTATE: ON' : '⏹ AUTO-ROTATE: OFF';
  };

  cam.cb.onPlayheadUpdate = fraction => {
    const ph = document.getElementById('ce-tl-playhead');
    if (ph) ph.style.left = (fraction * 100) + '%';
  };

  cam.cb.onOpenEditor = (defaultCode, presets) => {
    document.getElementById('cam-editor-overlay').classList.add('open');
    const codeEl = document.getElementById('ce-code');
    // Only seed defaultCode on first open. After that the user's edits
    // (or a loaded preset/keyframe) persist across modal toggles.
    if (codeEl && !codeEl.value) codeEl.value = defaultCode;
    const wrap = document.getElementById('ce-preset-wrap');
    wrap.innerHTML = '';
    presets.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'ce-preset'; btn.textContent = p.name;
      btn.onclick = () => { document.getElementById('ce-code').value = p.code; };
      wrap.appendChild(btn);
    });
  };

  // ── Timeline builder ─────────────────────────────────────────────────────
  // Rebuilt from scratch on every render — the keyframe list is small
  // (typically <20) so wholesale rebuild is simpler than a diff-based
  // update and there's no observable cost.
  cam.cb.onTimelineRender = (keyframes, selectedKf) => {
    const bar  = document.getElementById('ce-tl-bar');
    const list = document.getElementById('ce-kf-list');
    if (!bar || !list) return;

    // Timeline bar — draggable KF markers laid out by t-fraction.
    bar.querySelectorAll('.ce-kf').forEach(el => el.remove());
    keyframes.forEach(kf => {
      const el = document.createElement('div');
      el.className = 'ce-kf' + (kf === selectedKf ? ' selected' : '');
      el.style.left = (kf.t * 100) + '%';
      el.addEventListener('click', e => {
        // stopPropagation so the click doesn't bubble to the bar and
        // create a phantom seek-to-position.
        e.stopPropagation();
        cam.cpSelectedKf = kf;
        cam.cb.onTimelineRender(cam.cpKeyframes, kf);
      });
      // Drag to retime. We listen on document for mousemove/mouseup so
      // the drag continues even if the cursor leaves the marker — the
      // standard pattern for slider-like draggables.
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        const rect = bar.getBoundingClientRect();
        const move = ev => {
          kf.t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          el.style.left = (kf.t * 100) + '%';
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          cam.cb.onTimelineRender(cam.cpKeyframes, cam.cpSelectedKf);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
      bar.appendChild(el);
    });

    // KF list — text rows next to the timeline bar.
    if (!keyframes.length) {
      list.innerHTML = '<span style="color:#333">No keyframes</span>';
      return;
    }
    list.innerHTML = '';
    [...keyframes].sort((a, b) => a.t - b.t).forEach((kf, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:3px 0;border-bottom:1px solid #0d0d20;cursor:pointer';
      row.style.color = kf === selectedKf ? 'var(--green)' : '#445';
      row.innerHTML = `<span style="min-width:40px">${(kf.t * 100).toFixed(1)}%</span>
        <span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${kf.code.split('\n')[0].substring(0, 40)}</span>
        <span style="cursor:pointer;color:#f55" data-del="${i}">✕</span>`;
      row.addEventListener('click', e => {
        // Click on the ✕ deletes; click anywhere else selects.
        // data-del is the sorted-list index, NOT the original cpKeyframes
        // index — sorted ordering is the only stable view of the list.
        if (e.target.dataset.del !== undefined) {
          cam.deleteKeyframe(+e.target.dataset.del);
        } else {
          cam.selectKeyframe(kf);
        }
      });
      list.appendChild(row);
    });
  };

  // ── Open / close / tabs / apply / reset / keyframe wiring ────────────────
  // All editor-overlay event listeners. Each button uses optional chaining
  // on getElementById so a stripped-down HTML build that omits one of
  // these elements still boots without throwing.

  document.getElementById('btn-open-cam-editor')?.addEventListener('click', () => {
    cam.openEditor();
  });

  document.getElementById('ce-close')?.addEventListener('click', () => {
    document.getElementById('cam-editor-overlay').classList.remove('open');
  });
  document.getElementById('cam-editor-overlay')?.addEventListener('click', e => {
    if (e.target.id === 'cam-editor-overlay') {
      document.getElementById('cam-editor-overlay').classList.remove('open');
    }
  });

  // Tab switching (CODE / TIMELINE / PARAMS).
  document.querySelectorAll('#cam-editor-box .ce-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.cetab;
      document.querySelectorAll('#cam-editor-box .ce-tab').forEach(t =>
        t.classList.toggle('active', t === tab));
      const panes = { code:'ce-pane-code', timeline:'ce-pane-timeline', params:'ce-pane-params' };
      Object.entries(panes).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = key === target ? '' : 'none';
      });
    });
  });

  document.getElementById('ce-btn-apply')?.addEventListener('click', () => {
    const code = document.getElementById('ce-code').value;
    cam.loadScript(code);
  });
  document.getElementById('ce-btn-reset')?.addEventListener('click', () => {
    cam.resetScript();
  });

  // Ctrl/Cmd+Enter inside the code editor compiles, matching what most
  // code editors do for "run".
  document.getElementById('ce-code')?.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      cam.loadScript(document.getElementById('ce-code').value);
    }
  });

  // Capture the current code at the audio playhead's t-fraction.
  document.getElementById('ce-tl-add')?.addEventListener('click', () => {
    const code = document.getElementById('ce-code').value;
    const fraction = ui.audio.getElapsedFraction?.() ?? 0;
    cam.addKeyframeAtPlayhead(code, fraction);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SHADER EDITOR — Compile feedback, line numbers, error highlighting
// ══════════════════════════════════════════════════════════════════════════════

function bindShaderEditor(ui) {
  const se = ui.shaderEditor;

  const seCode    = document.getElementById('se-code');
  const seLineNums = document.getElementById('se-line-nums');
  const seError   = document.getElementById('se-error');

  // ── Line-number gutter ────────────────────────────────────────────────
  // Rebuilds the gutter on every input. Error line (if any) gets a span
  // with .ln-err so CSS can paint it. scrollTop is mirrored from the
  // textarea so the gutter scrolls in lock-step with the code.
  let _seErrLine = null;
  const _syncLineNums = () => {
    const lines = seCode.value.split('\n');
    seLineNums.innerHTML = lines.map((_, i) => {
      const n = i + 1;
      return _seErrLine === n
        ? `<span class="ln-err">${n}</span>`
        : String(n);
    }).join('\n');
    seLineNums.scrollTop = seCode.scrollTop;
  };
  const _clearErrLine = () => { _seErrLine = null; seCode.classList.remove('has-error-line'); };

  seCode.addEventListener('input',  () => { _clearErrLine(); _syncLineNums(); });
  seCode.addEventListener('scroll', () => { seLineNums.scrollTop = seCode.scrollTop; });

  // ── Compile-result callback ──────────────────────────────────────────
  // Fired by shaders.js after each compile attempt. On error we highlight
  // the failing line and scroll it into view; on success we clear any
  // existing highlight. The −4 offset on scroll keeps a few lines of
  // context visible above the error.
  se.cb.onCompileResult = ({ ok, message, line }) => {
    if (ok) {
      seError.style.color = 'var(--green)';
      _clearErrLine();
    } else {
      seError.style.color = '#f66';
      if (line !== null) {
        _seErrLine = line;
        seCode.classList.add('has-error-line');
        const lineH = parseFloat(getComputedStyle(seCode).lineHeight) || 17.6;
        seCode.scrollTop = Math.max(0, (line - 4) * lineH);
      }
    }
    seError.textContent = message;
    _syncLineNums();
  };

  // Editor open/tab callbacks. Both ignore their (tab, code, presets)
  // arguments — they only need to refresh the gutter, which the textarea
  // contents already drive. Kept on the cb interface so shaders.js can
  // grow callers without changing this file.
  se.cb.onOpen = (_tab, _code, _presets) => {
    _clearErrLine();
    _syncLineNums();
  };

  se.cb.onTabSwitch = (_tab, _code) => {
    _clearErrLine();
    _syncLineNums();
  };

  // ── Open / close / apply / reset / tabs ──────────────────────────────
  document.getElementById('btn-open-editor').addEventListener('click', () => se.open());
  document.getElementById('se-close').addEventListener('click', () => document.getElementById('shader-editor-overlay').classList.remove('open'));
  document.getElementById('shader-editor-overlay').addEventListener('click', e => {
    if (e.target.id === 'shader-editor-overlay') document.getElementById('shader-editor-overlay').classList.remove('open');
  });
  document.getElementById('se-btn-apply').addEventListener('click', () => se.compileAndApply());
  document.getElementById('se-btn-reset').addEventListener('click', () => se.reset());
  document.querySelectorAll('#shader-editor-box .se-tab').forEach(tab =>
    tab.addEventListener('click', () => se.switchTab(tab.dataset.tab)));

  // Code editor keybinds. Ctrl/Cmd+S OR Ctrl/Cmd+Enter compiles; Tab
  // inserts two spaces (instead of moving focus). The two-space indent
  // matches the GLSL style used in the shaders.js source.
  seCode.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) {
      e.preventDefault();
      se.compileAndApply();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = seCode, p = s.selectionStart, v = s.value;
      s.value = v.slice(0, p) + '  ' + v.slice(s.selectionEnd);
      s.selectionStart = s.selectionEnd = p + 2;
      _syncLineNums();
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// CAMERA PARAMS — Sliders for cpParams
// ══════════════════════════════════════════════════════════════════════════════
//
// Each row binds one slider to one cpParams key and to a value display.
// The display formatter is per-row because the meaningful precision
// differs by param (rotation speed wants 5 decimals, FOV wants integer
// degrees, etc.).
function bindCameraParams(ui) {
  const cam = ui.camera;

  [
    ['cp-rot',       'rotSpeed',  v => (+v).toFixed(5)],
    ['cp-radius',    'radius',    v => (+v).toFixed(1)],
    ['cp-height',    'height',    v => (+v).toFixed(1)],
    ['cp-grav',      'gravity',   v => (+v).toFixed(4)],
    ['cp-bass-react','bassReact', v => (+v).toFixed(2)],
    ['cp-damp',      'damping',   v => (+v).toFixed(3)],
    ['cp-fov',       'fov',       v => v + '°'],
    ['cp-roll',      'roll',      v => (+v).toFixed(2)],
  ].forEach(([id, key, fmtFn]) => {
    const el  = document.getElementById(id);
    const vEl = document.getElementById(id+'-v');
    if (!el) return;
    el.addEventListener('input', () => {
      cam.cpParams[key] = +el.value;
      if (vEl) vEl.textContent = fmtFn(el.value);
    });
  });

  // Seed the code textarea with the default script so the editor doesn't
  // open empty on first launch.
  document.getElementById('ce-code').value = cam.getDefaultCode();
}

// ══════════════════════════════════════════════════════════════════════════════
// MIDI — Mapping UI (Learn mode, manual assignments, clear all)
// ══════════════════════════════════════════════════════════════════════════════
//
// Mapping table layout:
//   ┌─────────┬─────────────────────────────┬─────────┬───┐
//   │ CC 21   │ [Bass Sensitivity ▼]        │   ⊙     │ ✕ │   ← existing row
//   └─────────┴─────────────────────────────┴─────────┴───┘
//   ┌─────────────────────────────┬───────────────────────┐
//   │ [+ Add parameter…        ▼] │ ⊙ LEARN               │   ← always-present add-row
//   └─────────────────────────────┴───────────────────────┘
//
// Two paths to add a mapping:
//   • Click ⊙ on an existing row to re-learn the CC for that param.
//   • Pick a param in the add-row dropdown and click ⊙ LEARN to bind a
//     new CC. The dropdown lists every param EXCEPT 'none' (which is the
//     "unbound" sentinel, not a real target).
//
// MIDIController.cb.onLearnDone fires when the user wiggles a controller
// knob, which is when we update the mapping table and emit a toast.

function bindMIDI(ui) {
  const midi = ui.midi;
  if (!midi) return;

  const learnBtn = document.getElementById('btn-midi-learn');
  const clearBtn = document.getElementById('btn-midi-clear');
  const statusEl = document.getElementById('midi-learn-status');
  const listEl   = document.getElementById('midi-mapping-list');

  let _learning    = false;

  const _renderMappings = () => {
    if (!listEl) return;
    listEl.innerHTML = '';
    const mappings = midi.getMappings();
    if (!mappings.length) {
      listEl.innerHTML = '<span style="color:#334;font-size:10px">No mappings — use Learn or add below</span>';
    }
    mappings.forEach(({ cc, paramId }) => {
      // Filter out mappings whose param has been removed from PARAMS —
      // shouldn't happen in normal use, but defends against stale
      // localStorage data from an older app version.
      const param = MIDI_PARAMS.find(p => p.id === paramId);
      if (!param) return;
      listEl.appendChild(_makeRow(cc, paramId));
    });
    listEl.appendChild(_makeAddRow());
  };

  const _makeRow = (cc, paramId) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:5px;align-items:center;padding:3px 0;border-bottom:1px solid #0d0d20;box-sizing:border-box';
    const ccLabel = document.createElement('span');
    ccLabel.style.cssText = 'color:#f3a;font-size:10px;font-family:var(--mono);min-width:42px';
    ccLabel.textContent = `CC ${cc}`;
    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1;min-width:0;background:#050510;border:1px solid rgba(255,58,122,.25);' +
      'border-radius:4px;color:#b8e0ff;font-family:var(--mono);font-size:10px;padding:4px 6px;outline:none;box-sizing:border-box';
    MIDI_PARAMS.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.label;
      if (p.id === paramId) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => { midi.setMapping(cc, sel.value); _renderMappings(); });
    const reLearnBtn = document.createElement('button');
    reLearnBtn.textContent = '⊙'; reLearnBtn.title = 'Re-learn CC for this param';
    reLearnBtn.style.cssText = 'background:none;border:1px solid rgba(255,58,122,.2);color:#f3a;' +
      'border-radius:4px;padding:3px 6px;cursor:pointer;font-size:11px;flex-shrink:0;box-sizing:border-box';
    reLearnBtn.addEventListener('click', () => _startLearn(paramId));
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.style.cssText = 'background:none;border:none;color:#f44;cursor:pointer;font-size:12px;padding:2px 5px;flex-shrink:0;box-sizing:border-box';
    delBtn.addEventListener('click', () => { midi.setMapping(cc, 'none'); _renderMappings(); });
    row.append(ccLabel, sel, reLearnBtn, delBtn);
    return row;
  };

  const _makeAddRow = () => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:5px;align-items:center;padding:4px 0;box-sizing:border-box';
    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1 1 0;min-width:0;background:#050510;border:1px solid rgba(0,255,200,.15);' +
      'border-radius:4px;color:#667;font-family:var(--mono);font-size:10px;padding:4px 6px;outline:none;box-sizing:border-box';
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = '+ Add parameter…'; sel.appendChild(ph);
    MIDI_PARAMS.filter(p => p.id !== 'none').forEach(p => {
      const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.label; sel.appendChild(opt);
    });
    const learnNewBtn = document.createElement('button');
    learnNewBtn.textContent = '⊙ LEARN';
    learnNewBtn.style.cssText = 'background:rgba(255,58,122,.06);border:1px solid rgba(255,58,122,.2);' +
      'color:#f3a;border-radius:4px;padding:4px 6px;cursor:pointer;font-size:9px;font-family:var(--mono);' +
      'white-space:nowrap;flex:0 0 70px;width:70px;box-sizing:border-box;text-align:center';
    learnNewBtn.addEventListener('click', () => {
      const paramId = sel.value;
      if (!paramId) { ui._showToast('⚠ Select a parameter first', true); return; }
      _startLearn(paramId);
    });
    row.append(sel, learnNewBtn);
    return row;
  };

  // Enter learn mode for one specific param. The MIDIController consumes
  // the next CC it sees and fires onLearnDone, which we react to below.
  const _startLearn = (paramId) => {
    const param = MIDI_PARAMS.find(p => p.id === paramId);
    if (!param) return;
    _learning = true;
    midi.startLearn(paramId);
    if (statusEl) { statusEl.textContent = `⊙ Move knob/slider for: ${param.label}`; statusEl.style.color = 'var(--pink)'; }
    if (learnBtn) { learnBtn.textContent = '⊙ LISTENING…'; learnBtn.style.color = 'var(--pink)'; learnBtn.style.borderColor = 'var(--pink)'; }
  };

  const _stopLearn = () => {
    _learning = false; midi.cancelLearn();
    if (statusEl) statusEl.textContent = '';
    if (learnBtn) { learnBtn.textContent = '🎛 LEARN MODE'; learnBtn.style.color = ''; learnBtn.style.borderColor = ''; }
  };

  // The big "LEARN MODE" button is intentionally a guide, not a learner.
  // It has no specific param to learn, so the only useful action is to
  // explain how to learn (click ⊙ on a row, or pick a param + ⊙ LEARN in
  // the add-row). When already learning, it cancels.
  learnBtn?.addEventListener('click', () => {
    if (_learning) { _stopLearn(); return; }
    ui._showToast('Click ⊙ next to any param, then move controller knob');
  });
  clearBtn?.addEventListener('click', () => { midi.clearAllMappings(); _renderMappings(); ui._showToast('MIDI mappings cleared'); });

  midi.cb.onLearnDone = (cc, paramId) => {
    const param = MIDI_PARAMS.find(p => p.id === paramId);
    ui._showToast(`✔ CC ${cc} → ${param?.label ?? paramId}`);
    _stopLearn(); _renderMappings();
  };

  _renderMappings();
}
