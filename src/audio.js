/**
 * VIMATHIC — Mathematical VJ Studio
 * Copyright (c) 2026 S. Melentyev. All rights reserved.
 * Licensed under BUSL-1.1 — see LICENSE.txt
 * https://github.com/vimathic/vimathic
 */

import { fmt } from './utils.js';

// AudioEngine
// ─────────────────────────────────────────────────────────────────────────────
// Single owner of all audio state. Web Audio graph, file playback, crossfade,
// live capture (mic / tab / system), multi-band analysis, beat & BPM tracking.
// Emits state changes to the UI via callbacks passed at construction time.
export class AudioEngine {
  constructor(callbacks = {}) {
    // Callback contract — overridden by UIController after construction.
    // Defaults are no-ops so the engine can run headless during tests.
    this.cb = {
      onLoading:         (v, pct, msg) => {},
      onPlaylistChange:  ()            => {},
      onPlayState:       (playing)     => {},
      onSeek:            (pct, cur)    => {},
      onDuration:        (dur)         => {},
      onEQ:              (fftData)     => {},
      onLiveMode:        (mode)        => {},   // null | 'mic' | 'tab' | 'display'
      onBeat:            ()            => {},
      onTrackChange:     (_name)       => {},
      ...callbacks,
    };

    // Web Audio graph
    this.audioCtx  = null;
    this.analyser  = null;
    this.fftData   = null;
    this.waveData  = null;

    // Live capture (mic / display) — orthogonal to file playback
    this._liveStream = null;
    this._liveSrc    = null;
    this.liveMode    = null;

    // File playback
    this.audioBuffer = null;
    this.audioSrc    = null;
    this.trackStart  = 0;
    this.trackOfs    = 0;
    this.isPlaying   = false;
    // Monotonic id stamped on each created source. Async callbacks (onended,
    // crossfade cleanup) compare against current id to bail out when a newer
    // source has taken over — prevents zombie tracks restarting playback.
    this.sourceId    = 0;

    // Per-frame readouts consumed by render/camera. Initial values are
    // mid-range so the visualizer doesn't snap to zero before first analysis.
    this.bass    = 0.3;
    this.mid     = 0.3;
    this.treble  = 0.3;
    this.beatInt = 0;

    // User-tunable response curves (bound to sliders)
    this.bassSens   = 1.2;
    this.trebleSens = 1.0;
    this.beatPunch  = 1.0;
    this.waveInt    = 1.0;
    this.amp        = 0.7;
    this.colorIdx   = 0;

    // Beat detector
    this.lastBeatTime    = 0;
    this.BEAT_COOLDOWN   = 190;   // ms — refractory period; sets BPM ceiling
    this.BEAT_THRESHOLD  = 0.65;

    // Multi-band detectors — energy/timestamp pairs for kick/snare/hihat.
    // Used for BPM accuracy; band UI was removed but the data path is kept.
    this.kickEnergy  = 0; this.lastKickTime  = 0;
    this.snareEnergy = 0; this.lastSnareTime = 0;
    this.hihatEnergy = 0; this.lastHihatTime = 0;

    // BPM estimator — sliding average of last 8 inter-beat intervals.
    // Read by CameraSystem for music-synced clip timing.
    this.bpmHistory   = [];
    this.lastBeatMs   = 0;
    this.estimatedBpm = 120;

    // Crossfade state
    this.CROSSFADE_DURATION = 1.5;
    this.isCrossfading = false;
    this._fadeStartTime = 0;
    this._fadeOutGain   = null;
    this._fadeInGain    = null;
    this._fadeOldSrc    = null;

    // Playlist
    this.playlist = [];
    this.trackIdx = -1;
    this.curFile  = null;

    // FFT bin geometry — bin width = nyquist / (fftSize/2). Recomputed in
    // ensureCtx() once the analyser exists; this is just a safe default
    // for callers reading _fpb before any context has been built.
    this._nyq = 22050;
    this._fpb = this._nyq / 512;
  }

  // ── Audio context ─────────────────────────────────────────────────────────
  async ensureCtx() {
    try {
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new AudioContext();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.fftData  = new Uint8Array(this.analyser.frequencyBinCount);
        this.waveData = new Uint8Array(this.analyser.fftSize);
        this.analyser.connect(this.audioCtx.destination);
        this._fpb = this._nyq / (this.analyser.frequencyBinCount);
      }
      // Chromium auto-suspends contexts created before the first user
      // gesture. Resuming here is the canonical fix.
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    } catch (e) {
      console.warn('AudioContext failed:', e);
      this.audioCtx = null; this.analyser = null;
    }
  }

  // ── Live capture sources ──────────────────────────────────────────────────

  /** Stop any live capture stream (mic / display) without touching file playback. */
  stopLiveCapture() {
    if (this._liveStream) {
      this._liveStream.getTracks().forEach(t => t.stop());
      this._liveStream = null;
    }
    if (this._liveSrc) {
      try { this._liveSrc.disconnect(); } catch (_) {}
      this._liveSrc = null;
    }
    this.liveMode = null;
    this.cb.onLiveMode(null);
  }

  /**
   * Capture microphone input. Works with virtual loopback devices too
   * (VB-Audio Cable on Windows, BlackHole on macOS).
   * @param {string} [deviceId] specific deviceId from listAudioInputs()
   */
  async captureMicrophone(deviceId) {
    try {
      await this.ensureCtx();
      // Tear down any prior capture and file source — only one of the three
      // (mic / display / file) can drive the analyser at a time.
      this.stopLiveCapture();
      this._stopSource();

      // Disable browser processing so the visualizer sees the raw signal.
      // Echo cancellation in particular eats bass below ~80 Hz.
      const constraints = {
        audio: {
          deviceId:          deviceId ? { exact: deviceId } : undefined,
          echoCancellation:  false,
          noiseSuppression:  false,
          autoGainControl:   false,
          sampleRate:        44100,
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this._liveSrc    = this.audioCtx.createMediaStreamSource(stream);
      this._liveStream = stream;
      this._liveSrc.connect(this.analyser);
      this.isPlaying = true;
      this.liveMode  = 'mic';
      this.cb.onPlayState(true);
      this.cb.onLiveMode('mic');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Capture tab audio or system audio via getDisplayMedia.
   * On Windows Chrome, the "Share system audio" checkbox appears only when
   * sharing the entire screen — there's no API surface to force it.
   * @param {'tab'|'display'} hint cosmetic only; actual behaviour depends on the picker
   */
  async captureDisplay(hint = 'tab') {
    // getDisplayMedia with audio is Chromium-only. Firefox returns no audio
    // tracks; Safari throws. Detect upfront so callers get a clean error
    // message instead of a confusing exception.
    const ua = navigator.userAgent;
    const isFirefox = ua.includes('Firefox');
    const isSafari  = ua.includes('Safari') && !ua.includes('Chrome');
    if (isFirefox || isSafari) {
      return { ok: false, error: 'This browser does not support screen audio capture. Use Chrome or a virtual audio cable.' };
    }

    try {
      await this.ensureCtx();
      // MediaStream tracks are not garbage-collected while the underlying
      // device is held — clean up any prior capture before requesting a new one.
      await this.stopLiveCapture();
      this._stopSource();

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: false,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
        },
      });

      // Firefox sometimes returns a stream with no audio tracks even after
      // the picker — surface that as a graceful error, not a silent no-op.
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach(t => t.stop());
        return { ok: false, error: 'No audio track captured. Try sharing a tab with audio enabled.' };
      }

      this._liveSrc    = this.audioCtx.createMediaStreamSource(stream);
      this._liveStream = stream;
      this._liveSrc.connect(this.analyser);
      this.isPlaying = true;
      this.liveMode  = hint;
      this.cb.onPlayState(true);
      this.cb.onLiveMode(hint);

      // Auto-stop when the user dismisses the browser's share dialog.
      stream.getAudioTracks()[0].onended = () => {
        this.stopLiveCapture();
        this.isPlaying = false;
        this.cb.onPlayState(false);
      };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Enumerate audio input devices. Permission prompt first so labels populate. */
  async listAudioInputs() {
    try {
      // enumerateDevices() returns empty `label` fields until the user has
      // granted at least one getUserMedia permission. Ask once, then release.
      await navigator.mediaDevices.getUserMedia({ audio: true })
        .then(s => s.getTracks().forEach(t => t.stop()))
        .catch(() => {});
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    } catch (_) {
      return [];
    }
  }

  // ── Playback ──────────────────────────────────────────────────────────────
  _startSource(offset) {
    this._stopSource();
    this.sourceId++;
    const id = this.sourceId;
    if (!this.audioCtx || !this.audioBuffer) return;
    this.audioSrc = this.audioCtx.createBufferSource();
    this.audioSrc.buffer = this.audioBuffer;
    this.audioSrc.connect(this.analyser);
    // The 200ms delay lets the buffer fully release before nextTrack()
    // requests a new one; without it, rapid track skipping can deadlock.
    this.audioSrc.onended = () => {
      if (id !== this.sourceId) return;
      if (this.isPlaying) setTimeout(() => { if (id !== this.sourceId) return; this.nextTrack(); }, 200);
    };
    this.audioSrc.start(0, offset);
    this.trackStart = this.audioCtx.currentTime;
    this.trackOfs   = offset;
  }

  _stopSource() {
    this._cancelCrossfade();
    if (this.audioSrc) {
      try { this.audioSrc.onended = null; this.audioSrc.stop(); this.audioSrc.disconnect(); } catch (_) {}
      this.audioSrc = null;
    }
  }

  stopAudio() {
    this.isPlaying = false;
    this._stopSource();
    this.cb.onPlayState(false);
    this.cb.onSeek(0, '0:00');
  }

  async togglePlay() {
    if (!this.curFile && !this.playlist.length) {
      document.getElementById('audio-file').click();
      return;
    }
    if (this.isPlaying) {
      this.stopAudio();
    } else {
      await this.ensureCtx();
      if (this.trackIdx < 0 && this.playlist.length) this.trackIdx = 0;
      const f = this.playlist[this.trackIdx]?.file ?? this.curFile;
      if (f) this.loadPlay(f);
    }
  }

  // ── Load & play ───────────────────────────────────────────────────────────
  // `silent` skips the loading indicator. Used for the bundled intro track,
  // which is auto-loaded on boot from browser cache and has no perceptible
  // load time — flashing the indicator for ~200ms looked like a glitch.
  async loadPlay(file, offset = 0, { silent = false } = {}) {
    this._cancelCrossfade();
    if (!silent) this.cb.onLoading(true, 0, 'LOADING TRACK…');
    this._stopSource();
    this.trackStart = 0; this.trackOfs = 0;
    this.cb.onSeek(0, '0:00');
    if (this.audioCtx?.state === 'closed') this.audioCtx = null;
    try {
      await this.ensureCtx();
      const buf = await this._readFile(file, { silent });
      if (!silent) this.cb.onLoading(true, 0.7, 'DECODING AUDIO…');
      this.audioBuffer = await this.audioCtx.decodeAudioData(buf);
      if (!silent) this.cb.onLoading(true, 1.0, 'READY');
      this._startSource(offset);
      this.cb.onDuration(fmt(this.audioBuffer.duration));
      this.isPlaying = true;
      this.cb.onPlayState(true);
      this.cb.onPlaylistChange();
    } catch (e) {
      console.error('Track load error:', e);
      this.isPlaying = false;
      if (!silent) this.cb.onLoading(false);
      return;
    }
    if (!silent) setTimeout(() => this.cb.onLoading(false), 200);
  }

  _readFile(file, { silent = false } = {}) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onprogress = e => { if (!silent && e.lengthComputable) this.cb.onLoading(true, e.loaded / e.total * 0.6, 'READING FILE…'); };
      r.onload = () => {
        if (!r.result || r.result.byteLength === 0) reject(new Error('Empty file'));
        else resolve(r.result);
      };
      r.onerror = () => reject(new Error('File read failed'));
      r.readAsArrayBuffer(file);
    });
  }

  // ── Crossfade ─────────────────────────────────────────────────────────────
  // A successful crossfade owns: fadeOutGain (old track), fadeInGain (new
  // track), and a stored cleanup target time. Cleanup runs in update() so it
  // fires on schedule even when the tab is backgrounded — see _checkCrossfadeCleanup.
  _cancelCrossfade() {
    if (this._fadeOutGain) { try { this._fadeOutGain.disconnect(); } catch (_) {} this._fadeOutGain = null; }
    if (this._fadeInGain)  { try { this._fadeInGain.disconnect();  } catch (_) {} this._fadeInGain  = null; }
    if (this._fadeOldSrc)  {
      try { this._fadeOldSrc.onended = null; this._fadeOldSrc.stop(); this._fadeOldSrc.disconnect(); } catch (_) {}
      this._fadeOldSrc = null;
    }
    this.isCrossfading = false;
  }

  _crossfadeOrLoad(file, offset = 0) {
    if (!this.audioCtx || this.audioCtx.state === 'closed' || !this.audioBuffer || !this.audioSrc) {
      this.loadPlay(file, offset);
    } else {
      this._cancelCrossfade();
      this.crossfadeToTrack(file, offset);
    }
  }

  async crossfadeToTrack(newFile, offset = 0) {
    // GainNode is in every modern browser, but be defensive — the fallback
    // is a clean hard-cut load rather than a silent failure.
    if (typeof GainNode === 'undefined') { this.loadPlay(newFile, offset); return; }
    try {
      await this.ensureCtx();
      this.cb.onLoading(true, 0, 'LOADING TRACK…');
      const buf = await this._readFile(newFile);
      this.cb.onLoading(true, 0.7, 'DECODING AUDIO…');
      const newBuffer = await this.audioCtx.decodeAudioData(buf);
      this.cb.onLoading(true, 1.0, 'READY');

      this.isCrossfading = true;
      this._fadeStartTime = this.audioCtx.currentTime;

      // Reroute the outgoing source through a fade-out gain stage.
      this._fadeOutGain = this.audioCtx.createGain();
      this._fadeOutGain.gain.setValueAtTime(1.0, this._fadeStartTime);
      this._fadeOldSrc = this.audioSrc;
      try { this.audioSrc.disconnect(); } catch (_) {}
      try { this._fadeOldSrc.connect(this._fadeOutGain); this._fadeOutGain.connect(this.analyser); } catch (_) {}
      this.audioSrc = null;

      // Build the incoming source behind a fade-in gain stage.
      this._fadeInGain = this.audioCtx.createGain();
      this._fadeInGain.gain.setValueAtTime(0.0, this._fadeStartTime);
      this.sourceId++;
      const id = this.sourceId;
      const newSrc = this.audioCtx.createBufferSource();
      newSrc.buffer = newBuffer;
      newSrc.connect(this._fadeInGain);
      this._fadeInGain.connect(this.analyser);
      newSrc.onended = () => {
        if (id !== this.sourceId) return;
        if (this.isPlaying) setTimeout(() => { if (id !== this.sourceId) return; this.nextTrack(); }, 200);
      };
      newSrc.start(0, offset);

      // Linear ramp over CROSSFADE_DURATION on both gains.
      const end = this._fadeStartTime + this.CROSSFADE_DURATION;
      this._fadeOutGain.gain.linearRampToValueAtTime(0.0, end);
      this._fadeInGain.gain.linearRampToValueAtTime(1.0, end);

      // Cleanup time is stored, not scheduled with setTimeout. Background
      // tabs throttle setTimeout to ~1 Hz; audioCtx.currentTime is unthrottled,
      // so checking it every frame inside update() guarantees on-time cleanup
      // regardless of tab visibility.
      this._xfadeEndTime = end;
      this._xfadeNewSrc  = newSrc;
      this._xfadeId      = id;

      this.audioSrc    = newSrc;
      this.audioBuffer = newBuffer;
      this.trackStart  = this.audioCtx.currentTime;
      this.trackOfs    = offset;
      this.isPlaying   = true;
      this.cb.onDuration(fmt(newBuffer.duration));
      this.cb.onPlayState(true);
      this.cb.onPlaylistChange();
      // Notify track-name consumers (overlay banner, clip player).
      const name = this.playlist[this.trackIdx]?.name ?? (this.curFile?.name?.replace(/\.[^.]+$/, '') ?? '');
      this.cb.onTrackChange(name);
      setTimeout(() => this.cb.onLoading(false), 200);
    } catch (e) {
      console.error('Crossfade error, falling back:', e);
      this._cancelCrossfade();
      this.loadPlay(newFile, offset);
    }
  }

  // ── Playlist ──────────────────────────────────────────────────────────────
  // `silent` skips the loading indicator during auto-load (intro track).
  // Caller paths from user actions (drag-drop, file picker) omit it.
  addFiles(files, { silent = false } = {}) {
    Array.from(files)
      .filter(f => f.type.startsWith('audio/'))
      .forEach(f => {
        if (!this.playlist.find(t => t.name === f.name))
          this.playlist.push({ file: f, name: f.name.replace(/\.[^.]+$/, '') });
      });
    this.cb.onPlaylistChange();
    if (this.trackIdx < 0 && this.playlist.length) {
      this.trackIdx = 0; this.curFile = this.playlist[0].file;
      this.loadPlay(this.curFile, 0, { silent });
    }
  }

  nextTrack() {
    if (!this.playlist.length) return;
    this.trackIdx = (this.trackIdx + 1) % this.playlist.length;
    this.curFile  = this.playlist[this.trackIdx].file;
    this._crossfadeOrLoad(this.curFile);
  }

  prevTrack() {
    if (!this.playlist.length) return;
    this.trackIdx = (this.trackIdx - 1 + this.playlist.length) % this.playlist.length;
    this.curFile  = this.playlist[this.trackIdx].file;
    this._crossfadeOrLoad(this.curFile);
  }

  clearPlaylist() {
    this.stopAudio();
    this.playlist = []; this.trackIdx = -1; this.curFile = null; this.audioBuffer = null;
    // Remember explicit user clear so we don't auto-reload the intro track
    // on the next page load. See _loadIntroIfNeeded().
    try { localStorage.setItem('vimathic_intro_cleared', 'true'); } catch {}
    this.cb.onPlaylistChange();
  }

  /**
   * On first load (and every load after, until user clicks Clear), fetch the
   * bundled intro track and add it to the playlist. Once the user clicks
   * Clear, we remember that and don't auto-reload the intro again — they
   * explicitly chose to start fresh.
   *
   * No-ops gracefully if:
   *  - localStorage flag is set ("vimathic_intro_cleared" === "true")
   *  - the intro MP3 fetch fails (offline, file missing, etc.)
   *  - the playlist is already non-empty (e.g. preset restored state)
   *
   * Called once from main.js after AudioEngine instantiation. Async but
   * fire-and-forget — the rest of the app boots in parallel.
   */
  /**
   * On first load (and every load after, until user clicks Clear), fetch the
   * bundled intro track and add it to the playlist. Once the user clicks
   * Clear, we remember that and don't auto-reload the intro again — they
   * explicitly chose to start fresh.
   *
   * No-ops gracefully if:
   *  - localStorage flag is set ("vimathic_intro_cleared" === "true")
   *  - the intro MP3 fetch fails (offline, file missing, etc.)
   *  - the playlist is already non-empty (e.g. preset restored state)
   *
   * Called once from main.js after AudioEngine instantiation. Async but
   * fire-and-forget — the rest of the app boots in parallel.
   */
  async _loadIntroIfNeeded() {
    // Don't reload if user explicitly cleared on a previous session.
    try {
      if (localStorage.getItem('vimathic_intro_cleared') === 'true') return;
    } catch {} // localStorage can throw in some sandboxed contexts

    // Don't override an existing playlist (e.g. from preset restore).
    if (this.playlist.length > 0) return;

    try {
      // The bundled intro track is emitted to dist/vimathic-intro.mp3 by
      // Vite (from public/). Using a relative URL means this works
      // regardless of where index.html is hosted (vimathic.com, localhost,
      // file://, etc.).
      const response = await fetch('./vimathic-intro.mp3');
      if (!response.ok) return;
      const blob = await response.blob();
      // Wrap as a File so the existing playlist code (which expects File
      // objects from drag-drop / <input>) treats it uniformly.
      const file = new File(
        [blob],
        'S.Melentyev - Vimathic.mp3',
        { type: 'audio/mpeg', lastModified: Date.now() }
      );
      this.addFiles([file], { silent: true });
    } catch (err) {
      // Silent fail — the user simply won't have the intro track in their
      // playlist on this session. They can drag-drop their own files.
      console.warn('[audio] intro track unavailable:', err?.message ?? err);
    }
  }

  playAt(idx) {
    this.trackIdx = idx;
    this.curFile  = this.playlist[idx].file;
    this._crossfadeOrLoad(this.curFile);
  }

  seek(pct) {
    if (!this.audioBuffer || !this.audioCtx || !this.analyser) return;
    const seekTo = Math.max(0, Math.min(this.audioBuffer.duration, pct * this.audioBuffer.duration));
    this._startSource(seekTo);
    this.isPlaying = true;
    this.cb.onPlayState(true);
  }

  // ── Per-frame update — called by main animate() ───────────────────────────

  /**
   * Crossfade cleanup driven by audioCtx.currentTime. Called every frame.
   * Background-tab safe — setTimeout throttling can delay cleanup by up to
   * 30 seconds, during which both old and new sources reach the analyser
   * and the visualizer goes berserk. audioCtx.currentTime is not throttled.
   */
  _checkCrossfadeCleanup() {
    if (!this.isCrossfading || !this._xfadeEndTime) return;
    if (!this.audioCtx || this.audioCtx.currentTime < this._xfadeEndTime + 0.05) return;
    // A newer track started while this crossfade was still in flight — let
    // the newer one own cleanup, just clear our handles.
    if (this._xfadeId !== this.sourceId) {
      this._xfadeEndTime = null; this._xfadeNewSrc = null; this._xfadeId = null;
      return;
    }
    const src = this._xfadeNewSrc;
    try { this._fadeOldSrc?.stop(); this._fadeOldSrc?.disconnect(); } catch (_) {}
    try { this._fadeOutGain?.disconnect(); } catch (_) {}
    try { this._fadeInGain?.disconnect(); if (src) src.connect(this.analyser); } catch (_) {}
    this._fadeOldSrc    = null;
    this._fadeOutGain   = null;
    this._fadeInGain    = null;
    this._xfadeEndTime  = null;
    this._xfadeNewSrc   = null;
    this._xfadeId       = null;
    this.isCrossfading  = false;
  }

  update(time) {
    this._checkCrossfadeCleanup();

    if (this.analyser && this.fftData && this.isPlaying) {
      this.analyser.getByteFrequencyData(this.fftData);
      // Three-band energies with multipliers tuned to roughly equalise
      // perceived response across bass/mid/treble.
      const rb = Math.min(1, this._energy(20,   140)  * 1.4);
      const rm = Math.min(1, this._energy(140,  2000) * 1.2);
      const rt = Math.min(1, this._energy(2000, 12000));
      // Low-pass smoothing: 70% new value, 30% prior frame. Removes the
      // jagged frame-to-frame jitter from raw FFT bins.
      this.bass   = this.bass   * 0.3 + rb * 0.7;
      this.mid    = this.mid    * 0.3 + rm * 0.7;
      this.treble = this.treble * 0.3 + rt * 0.7;
      this._detectBeat(this.bass);
      this._detectMultiBandBeats();
      this._updateSeek();
      this.cb.onEQ(this.fftData);
    } else if (!this.isPlaying) {
      // Idle visualization — slow LFO motion so the scene doesn't look frozen
      // when nothing is playing. Three different frequencies so bands don't
      // pulse in lock-step.
      this.bass   = 0.2  + Math.sin(time * 0.7) * 0.1;
      this.mid    = 0.2  + Math.sin(time * 0.9) * 0.09;
      this.treble = 0.15 + Math.cos(time * 1.1) * 0.08;
    }
    this.beatInt = Math.max(0, this.beatInt - 0.04);
  }

  // ── Analysis helpers ──────────────────────────────────────────────────────
  _energy(lo, hi) {
    if (!this.fftData) return 0;
    let s = 0, c = 0;
    const a = Math.floor(lo / this._fpb);
    const b = Math.min(this.fftData.length - 1, Math.ceil(hi / this._fpb));
    for (let i = a; i <= b; i++) { s += this.fftData[i]; c++; }
    return c ? s / c / 255 : 0;
  }

  _detectBeat(b) {
    if (b > this.BEAT_THRESHOLD && Date.now() - this.lastBeatTime > this.BEAT_COOLDOWN) {
      this.lastBeatTime = Date.now();
      this.beatInt = 1.0;
      this._trackBpm();
      this.cb.onBeat();
      return true;
    }
    return false;
  }

  _trackBpm() {
    // Sliding average of last 8 intervals — short enough to follow tempo
    // changes, long enough to ride out missed beats. Intervals > 2s are
    // dropped (likely a section break, not a real beat).
    const now = performance.now();
    const interval = now - this.lastBeatMs;
    if (this.lastBeatMs > 0 && interval < 2000) {
      this.bpmHistory.push(60000 / interval);
      if (this.bpmHistory.length > 8) this.bpmHistory.shift();
      this.estimatedBpm = this.bpmHistory.reduce((a, b) => a + b, 0) / this.bpmHistory.length;
    }
    this.lastBeatMs = now;
  }

  _detectMultiBandBeats() {
    const now = Date.now();
    // Tuned bands and gains chosen empirically against drum mixes.
    // Smoothing constants differ per band: hihats decay faster than kicks.
    this.kickEnergy  = this.kickEnergy  * 0.3 + this._energy(40,    100)   * 1.6 * 0.7;
    this.snareEnergy = this.snareEnergy * 0.3 + this._energy(150,   250)   * 1.4 * 0.7;
    this.hihatEnergy = this.hihatEnergy * 0.2 + this._energy(8000, 15000)  * 2.0 * 0.8;
    if (this.kickEnergy  > 0.55 && now - this.lastKickTime  > 200) this.lastKickTime  = now;
    if (this.snareEnergy > 0.45 && now - this.lastSnareTime > 180) this.lastSnareTime = now;
    if (this.hihatEnergy > 0.35 && now - this.lastHihatTime > 80)  this.lastHihatTime = now;
  }

  _updateSeek() {
    if (!this.audioCtx || !this.audioBuffer || !this.isPlaying) return;
    const elapsed = Math.min(this.audioBuffer.duration, this.audioCtx.currentTime - this.trackStart + this.trackOfs);
    const pct = elapsed / this.audioBuffer.duration * 100;
    this.cb.onSeek(pct, fmt(elapsed));
  }

  /** Fraction 0..1 of the current track. Read by the Camera Programmer. */
  getElapsedFraction() {
    if (!this.audioBuffer || !this.audioCtx) return 0;
    const elapsed = Math.min(this.audioBuffer.duration, this.audioCtx.currentTime - this.trackStart + this.trackOfs);
    return elapsed / this.audioBuffer.duration;
  }

  dispose() {
    this._cancelCrossfade();
    this.stopLiveCapture();
    if (this.audioSrc)  try { this.audioSrc.stop(); } catch (_) {}
    if (this.audioCtx)  try { this.audioCtx.close();  } catch (_) {}
  }
}
