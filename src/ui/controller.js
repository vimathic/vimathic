import { ClipPlayer } from './clip-player.js';
import { PresetMixin } from './presets.js';
import { bindModals }  from './modals.js';
import { bindControls } from './controls.js';

// UIController
// ─────────────────────────────────────────────────────────────────────────────
// Wires DOM events to service methods. Owns zero application logic — purely
// glue between the AudioEngine / RenderEngine / CameraSystem / etc. and the
// HTML controls.
//
// Responsibilities:
//   • Inject audio callbacks (loading bar, playlist, play state, seek).
//   • Provide DOM-shaped helpers (setLoading, renderPL, _showToast).
//   • Delegate panel and modal binding to controls.js / modals.js.
//   • Mix in capture/apply/save/load via PresetMixin.
//   • bindClip(clip) — wires ClipPlayer to its DOM controls.
//
// Module split:
//   modals.js      — output, audio source, camera editor, shader editor, MIDI
//   controls.js    — panel sliders, fullscreen, transport, model loader
//   presets.js     — captureState / applyState / save / load (mixin)
//   clip-player.js — ClipPlayer class

export class UIController {
  /**
   * @param {{ audio, render, camera, shaderEditor, modelLoader, midi, output,
   *           secondScreen, mathViz, gifRec, webmRec }} deps
   */
  constructor(deps) {
    this.audio        = deps.audio;
    this.render       = deps.render;
    this.camera       = deps.camera;
    this.shaderEditor = deps.shaderEditor;
    this.modelLoader  = deps.modelLoader;
    this.midi         = deps.midi;
    this.output       = deps.output;
    this.secondScreen = deps.secondScreen ?? null;
    this.mathViz      = deps.mathViz;
    this.gifRec       = deps.gifRec  ?? null;
    this.webmRec      = deps.webmRec ?? null;

    // Inject audio callbacks.
    //
    // Important: merge into the existing cb object, do NOT replace it.
    // AudioEngine's constructor seeds the cb map with no-op defaults for
    // onLiveMode / onBeat / onTrackChange — those are overwritten later by
    // bindControls() and bindModals(). A wholesale replacement here would
    // drop those defaults and leave a TypeError window for any audio event
    // that fires before bindAll() completes.
    Object.assign(this.audio.cb, {
      onLoading:        (v,pct,msg) => this.setLoading(v,pct,msg),
      onPlaylistChange: ()          => this.renderPL(),
      onPlayState:      (p)         => this._updatePlayBtn(p),
      onSeek:           (pct,cur)   => this._updateSeekFill(pct,cur),
      onDuration:       (dur)       => { document.getElementById('seek-tot').textContent = dur; },
      // EQ visualization isn't part of the current panel layout; audio FFT
      // is still computed because the beat detector needs it.
      onEQ:             ()          => {},
    });
  }

  // ── Bind all DOM events ─────────────────────────────────────────────────
  bindAll() {
    bindModals(this);    // output / audio-src / shader / camera / MIDI
    bindControls(this);  // panel sliders, fullscreen, transport, model, etc.
  }

  // ── Loading indicator ─────────────────────────────────────────────────────
  // A thin 2px bar under the play button. Two display modes:
  //   pct > 0  → determinate width fill (known decode fraction)
  //   pct = 0  → indeterminate slide animation (we don't know progress yet)
  // The msg parameter is kept in the signature for compatibility with
  // audio.cb.onLoading callers; it is not surfaced anywhere in the UI.
  setLoading(v, pct = 0, _msg = '') {
    const el = document.getElementById('track-loading');
    if (!el) return;
    const fill = document.getElementById('track-loading-fill');
    if (!v) {
      el.classList.remove('active', 'indeterminate');
      if (fill) fill.style.width = '0%';
      return;
    }
    el.classList.add('active');
    if (pct > 0) {
      el.classList.remove('indeterminate');
      if (fill) fill.style.width = Math.round(pct * 100) + '%';
    } else {
      el.classList.add('indeterminate');
      if (fill) fill.style.width = '30%';  // slide animation moves this 30% strip
    }
  }

  // ── Playlist ──────────────────────────────────────────────────────────────
  renderPL() {
    const { playlist, trackIdx, isPlaying } = this.audio;
    const list  = document.getElementById('pl-list');
    const empty = document.getElementById('pl-empty');
    document.getElementById('pl-count').textContent = playlist.length + ' track' + (playlist.length !== 1 ? 's' : '');
    list.querySelectorAll('.pl-item').forEach(e => e.remove());
    empty.style.display = playlist.length ? 'none' : '';
    playlist.forEach((tr, i) => {
      const d = document.createElement('div');
      d.className = 'pl-item' + (i === trackIdx ? ' active' : '');
      d.innerHTML = `<span class="pl-num">${i+1}</span><span class="pl-name">${tr.name}</span><span class="pl-play">${i===trackIdx&&isPlaying?'▶':''}</span>`;
      d.onclick = () => this.audio.playAt(i);
      list.appendChild(d);
    });
  }

  // ── Play button ───────────────────────────────────────────────────────────
  _updatePlayBtn(playing) {
    const pb = document.getElementById('play-btn');
    pb.textContent = playing ? '⏸ STOP' : '▶ PLAY';
    pb.classList.toggle('playing', playing);
    if (!playing) {
      document.getElementById('seek-fill').style.width = '0%';
      document.getElementById('seek-cur').textContent  = '0:00';
    }
    this.renderPL();
  }

  _updateSeekFill(pct, cur) {
    document.getElementById('seek-fill').style.width = pct + '%';
    document.getElementById('seek-cur').textContent  = cur;
  }

  // ── Toast notification ───────────────────────────────────────────────────
  // Lazy-creates a fixed-position element on first call; subsequent calls
  // reuse it. Auto-fades after 2.8s. isError swaps the styling to red.
  _showToast(msg, isError = false) {
    let t = document.getElementById('_vimathic_toast');
    if (!t) {
      t = document.createElement('div');
      t.id = '_vimathic_toast';
      t.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:9999;font-family:var(--mono);' +
        'font-size:11px;padding:8px 14px;border-radius:7px;pointer-events:none;' +
        'transition:opacity .35s;opacity:0;max-width:280px';
      document.body.appendChild(t);
    }
    t.style.background = isError ? 'rgba(255,40,60,.88)' : 'rgba(0,255,180,.12)';
    t.style.border      = isError ? '1px solid #f44' : '1px solid rgba(0,255,180,.4)';
    t.style.color       = isError ? '#fff' : '#0fc';
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => { t.style.opacity = '0'; }, 2800);
  }

  // ── ClipPlayer wiring ───────────────────────────────────────────────────
  bindClip(clip) {
    this._clip = clip;

    const playBtn    = document.getElementById('btn-clip-play');
    const stopBtn    = document.getElementById('btn-clip-stop');
    const skipBtn    = document.getElementById('btn-clip-skip');
    const holdInput  = document.getElementById('clip-hold');
    const barsInput  = document.getElementById('clip-bars');
    const modeSecBtn = document.getElementById('clip-mode-sec');
    const modeBarsBtn= document.getElementById('clip-mode-bars');
    const statusEl   = document.getElementById('clip-status');
    const progressEl = document.getElementById('clip-progress');
    const syncChk    = document.getElementById('clip-sync-music');
    const camModeSel = document.getElementById('clip-cam-mode');

    // ── Camera transition mode ────────────────────────────────────────────
    //   'auto'  → null      (clip-player derives ms from holdMs)
    //   numeric → explicit ms (0 = instant snap; >0 = tween duration)
    if (camModeSel) {
      const _applyCamMode = () => {
        const v = camModeSel.value;
        clip.setCameraTransitionMs(v === 'auto' ? null : +v);
      };
      camModeSel.addEventListener('change', _applyCamMode);
      _applyCamMode(); // pick up the default selection
    }

    // ── SEC / BARS toggle ─────────────────────────────────────────────────
    // Bars mode keys hold time off detected BPM, so the visual rhythm stays
    // locked to the music even when tempo drifts.
    const _setMode = bars => {
      clip.barsMode = bars;
      modeSecBtn.classList.toggle('active', !bars);
      modeBarsBtn.classList.toggle('active', bars);
      holdInput.closest('.clip-time-sec').style.display  = bars ? 'none' : '';
      barsInput.closest('.clip-time-bars').style.display = bars ? '' : 'none';
    };
    modeSecBtn?.addEventListener('click',  () => _setMode(false));
    modeBarsBtn?.addEventListener('click', () => _setMode(true));
    _setMode(false);

    if (barsInput) {
      barsInput.addEventListener('change', () => { clip.barsCount = +barsInput.value || 8; });
    }

    // Button enabled state is managed in JS; visual disabled styling comes
    // from the CSS :disabled selector on .clip-tbtn (keeps the equal-width
    // layout intact, which inline opacity overrides would defeat).
    const _setPlaying = playing => {
      playBtn.disabled = playing;
      stopBtn.disabled = !playing;
    };

    const _startClip = () => {
      const presets = this._loadPresetList();
      if (!presets.length) { this._showToast('⚠ No presets saved yet', true); return; }
      if (clip.barsMode) {
        clip.barsCount = +barsInput?.value || 8;
        clip.buildFromPresets(0); // holdMs unused in bars mode
      } else {
        const holdMs = Math.max(500, (+holdInput.value || 5) * 1000);
        clip.buildFromPresets(holdMs);
      }
      clip.play();
      // If "sync with music" is on and audio isn't playing yet, kick it off
      // so the visual sequence and the music start together.
      if (syncChk?.checked && !this.audio.isPlaying) {
        this.audio.togglePlay();
      }
    };

    playBtn.addEventListener('click', _startClip);
    stopBtn.addEventListener('click', () => clip.stop());
    skipBtn.addEventListener('click', () => clip.skip());

    // ── Sync with music ───────────────────────────────────────────────────
    // Decorate the play-state callback rather than overwrite it — preserves
    // the seek/UI updates that other code paths rely on.
    const _origOnPlayState = this.audio.cb.onPlayState;
    this.audio.cb.onPlayState = playing => {
      _origOnPlayState(playing);
      if (!syncChk?.checked) return;
      if (playing  && !clip.playing) _startClip();
      if (!playing &&  clip.playing) clip.stop();
    };

    // ── Clip callbacks ────────────────────────────────────────────────────
    clip.cb.onPlay = () => { _setPlaying(true); statusEl.textContent = 'Playing…'; };

    clip.cb.onStop = () => {
      _setPlaying(false);
      statusEl.textContent = '';
      if (progressEl) { progressEl.style.width = '0%'; progressEl.style.opacity = '0'; }
      document.querySelectorAll('#preset-list .preset-load-btn').forEach(b => b.style.boxShadow = '');
    };

    clip.cb.onStep = (idx, step, holdMs) => {
      const total   = clip._steps.length;
      const bpm     = this.audio.estimatedBpm || 120;
      const label   = clip.barsMode
        ? `[${idx+1}/${total}] ${step.name}  — ${step.bars ?? clip.barsCount} bars @ ${Math.round(bpm)} BPM`
        : `[${idx+1}/${total}] ${step.name}  — ${(holdMs/1000).toFixed(1)}s`;
      statusEl.textContent = label;
      if (progressEl) { progressEl.style.width = '100%'; progressEl.style.opacity = '1'; }
      document.querySelectorAll('#preset-list .preset-load-btn').forEach((btn, i) =>
        btn.style.boxShadow = i === idx ? '0 0 0 1px var(--pink)' : '');
    };

    // Last 25% of each step flashes pink — visual countdown cue.
    clip.cb.onTick = (remainMs, totalMs) => {
      if (!progressEl) return;
      const pct = totalMs > 0 ? (remainMs / totalMs) * 100 : 0;
      progressEl.style.width = pct + '%';
      progressEl.style.background = pct < 25
        ? 'rgba(255,58,122,.9)'
        : 'rgba(0,255,180,.7)';
    };

    holdInput?.addEventListener('input', () => this._renderPresets());
  }
}

// Apply preset/state methods to the prototype.
// External code (ClipPlayer, import button, drag-and-drop) can call
// ui.applyState(), ui.savePreset(), etc.
Object.assign(UIController.prototype, PresetMixin);

// Re-export ClipPlayer so main.js can keep a single import path:
//   import { UIController, ClipPlayer } from './ui/controller.js';
export { ClipPlayer };
