// recorder.js — video capture for the WebGL canvas.
//
// Two recorder classes share a callback-shaped interface:
//
//   GifRecorder   — animated GIF via gif.js (worker-based LZW encoder).
//                   Higher peak memory; ubiquitous compatibility; loops
//                   natively on Twitter, Discord, Slack previews.
//   WebmRecorder  — WebM via MediaRecorder + canvas.captureStream. Lower
//                   memory, much better quality, larger output. Right
//                   choice for archives, YouTube uploads, post-edit work.
//
// ── Source canvas requirement ─────────────────────────────────────────────
// Both classes read pixels from render.renderer.domElement. That canvas is
// created with preserveDrawingBuffer:true in render.js — without it the
// browser destroys the GPU back-buffer at composite time and drawImage()
// from a WebGL canvas returns a black frame. Do not flip that flag without
// reading this comment.
//
// ── Public surface ────────────────────────────────────────────────────────
// Both classes expose:
//   start(opts)   — begin capture; cb.onStart fires once accepted.
//   stop()        — finish gracefully; cb.onDone receives the Blob.
//   abort()       — bail out without producing a file; cb.onAbort fires.
//   recording     — true while frames are being captured.
//   .cb           — bag of callbacks for progress / completion / errors.
//
// GIF also supports beat-sync: pass { stopOnBeats: N, audioEngine } to
// auto-stop after N detected beats — useful for music-aligned loops.
//
// ── Memory awareness ──────────────────────────────────────────────────────
// GIF rasterises every captured frame into a 2D canvas before queueing it
// to the encoder worker. At 720p × 15fps × 30s ≈ 450 frames × ~3.5MB
// intermediate ≈ 1.5 GB peak — well into "tab crash" territory on a 4 GB
// MacBook Air. The LIMITS table below and the per-call memMb check
// surface a clean error instead of letting the user faceplant.

import GIF from 'gif.js';
import gifWorkerSource from 'gif.js/dist/gif.worker.js?raw';

// ── Inline gif.js worker as a Blob URL ───────────────────────────────────
// gif.js takes `workerScript: <URL>` and does `new Worker(URL)` internally.
// In production we ship a single-file bundle (vite-plugin-singlefile), so a
// real .js URL would force a second asset out of the bundle. Loading the
// worker source as `?raw`, then minting a Blob URL on first use, keeps the
// single-file invariant intact. The URL is cached so repeat starts don't
// leak fresh Blobs into the URL store.
let _workerBlobUrl = null;
function getWorkerUrl() {
  if (!_workerBlobUrl) {
    const blob = new Blob([gifWorkerSource], { type: 'application/javascript' });
    _workerBlobUrl = URL.createObjectURL(blob);
  }
  return _workerBlobUrl;
}

// Allocate a sized 2D canvas for downscaling WebGL frames into. Kept as a
// helper because both recorders need the same shape, just at different
// dimensions and refresh patterns.
function makeScratchCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ── Aspect-aware cover crop ────────────────────────────────────────────────
/**
 * Compute the source rectangle to sample from a (srcW × srcH) canvas so it
 * fills a (dstW × dstH) destination with "cover" semantics: scaled to cover
 * the whole destination, overflow cropped, centered, aspect preserved.
 *
 * The renderer canvas is usually landscape (window-shaped). Exporting
 * portrait 9:16 by drawing the whole landscape canvas into a tall scratch
 * canvas stretches it vertically — everything looks squashed. Cover-crop
 * instead samples the central vertical slice, so a portrait clip shows an
 * undistorted, zoomed-in view.
 *
 * @returns {{sx,sy,sw,sh}} source rect for drawImage's 9-arg form.
 */
function coverRect(srcW, srcH, dstW, dstH) {
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  let sw, sh;
  if (srcAspect > dstAspect) {
    sh = srcH;                 // source wider — crop sides, full height
    sw = srcH * dstAspect;
  } else {
    sw = srcW;                 // source taller — crop top/bottom, full width
    sh = srcW / dstAspect;
  }
  const sx = (srcW - sw) * 0.5;
  const sy = (srcH - sh) * 0.5;
  return { sx, sy, sw, sh };
}

// ── Watermark ────────────────────────────────────────────────────────────
/**
 * Paint a "VIMATHIC" watermark in the bottom-RIGHT corner, styled to match
 * the brand name in the control-panel header: accent pink (#ff3a7a), the
 * Eurostile/Bahnschrift display family, 2px letter-spacing, and a slight
 * vertical squash (scaleY 0.85). Half the previous footprint so it reads as
 * a discreet signature rather than a banner. A faint dark outline keeps it
 * legible on bright scenes without the old heavy glow.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} canvasWidth   — drives horizontal (right-edge) position
 * @param {number} canvasHeight  — drives font size + vertical position
 */
function drawWatermark(ctx, canvasWidth, canvasHeight) {
  // Half the old footprint: ~2.25% of height (was 4.5%). Clamped at 9px so
  // it doesn't vanish on small/extreme aspect ratios.
  const fontSize = Math.max(9, Math.round(canvasHeight * 0.0225));
  const margin   = Math.round(canvasHeight * 0.025);

  ctx.save();

  // Reset composite state that could leak from prior drawImage calls.
  ctx.globalAlpha              = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Match the panel header: --display family, semi-bold, 2px tracking.
  ctx.font = `600 ${fontSize}px "Eurostile", "Bahnschrift", "Helvetica Neue", Arial, sans-serif`;
  // letterSpacing is supported in Chrome/Edge/Firefox; harmless if ignored.
  try { ctx.letterSpacing = '2px'; } catch (_) {}
  ctx.textBaseline = 'bottom';
  ctx.textAlign    = 'right';

  // Bottom-right anchor. scaleY(0.85) mirrors the header's transform; we
  // scale the context around the baseline so the squash doesn't drift the
  // text off the corner.
  const x = canvasWidth - margin;
  const y = canvasHeight - margin;
  ctx.translate(0, y);
  ctx.scale(1, 0.85);
  ctx.translate(0, -y);

  // Subtle dark outline for legibility on bright scenes (no big glow — the
  // panel brand has none; this is a quiet signature).
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.40)';
  ctx.lineWidth   = Math.max(1, fontSize * 0.10);
  ctx.lineJoin    = 'round';
  ctx.strokeText('VIMATHIC', x, y);

  // Main fill: accent pink (#ff3a7a), matching the control-panel name.
  ctx.fillStyle = 'rgba(255, 58, 122, 0.92)';
  ctx.fillText('VIMATHIC', x, y);

  ctx.restore();
}

// ── Hard limits ──────────────────────────────────────────────────────────
// These are not preferences; they're the boundary between "the recording
// works" and "the tab crashes". 1280×720 / 30 fps / 60 s sits inside the
// crash budget on a 4 GB machine, which is what most live VJ rigs run.
// Bumping any of these requires a fresh look at the memMb check below.
const LIMITS = {
  maxDurationMs: 60_000,
  // Both dimensions share a 1920 ceiling so every orientation fits:
  //   landscape 16:9  → 1920×1080
  //   portrait  9:16  → 1080×1920  (TikTok / Reels / Shorts)
  //   square    1:1   → 1080×1080  (Instagram feed)
  // Previously these were 1280×720, which silently clamped any portrait
  // request's height back to 720 — making vertical output impossible.
  // 1920 is the practical ceiling for browser-side GIF/WebM encoding on
  // mid-range laptops; beyond it the memory pre-flight (memMb) trips.
  maxWidth:      1920,
  maxHeight:     1920,
  maxFps:        30,    // GIFs above 30 fps look bad and weigh too much
  minFps:        5,
};

function clampOptions(opts) {
  const out = { ...opts };
  if (out.duration > LIMITS.maxDurationMs) out.duration = LIMITS.maxDurationMs;
  if (out.width  > LIMITS.maxWidth)  out.width  = LIMITS.maxWidth;
  if (out.height > LIMITS.maxHeight) out.height = LIMITS.maxHeight;
  if (out.fps    > LIMITS.maxFps)    out.fps    = LIMITS.maxFps;
  if (out.fps    < LIMITS.minFps)    out.fps    = LIMITS.minFps;
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// GifRecorder
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Animated-GIF recorder for the WebGL canvas.
 *
 * Two run modes, picked by the options passed to start():
 *
 *   Time-based  — capture for `duration` ms, then encode.
 *   Beat-sync   — pass { stopOnBeats: N, audioEngine }; capture begins
 *                 immediately and stops after exactly N detected beats.
 *                 Gives a music-aligned loop suitable for "perfect" GIFs
 *                 that line up with the bar.
 *
 * Lifecycle example:
 *   const rec = new GifRecorder(renderer);
 *   rec.cb.onProgress = pct => updateUiBar(pct);   // capture 0–1
 *   rec.cb.onEncoding = pct => updateUiBar(pct);   // post-capture 0–1
 *   rec.cb.onDone     = (blob, meta) => downloadBlob(blob, 'clip.gif');
 *   rec.cb.onError    = msg => showToast(msg, true);
 *
 *   rec.start({
 *     duration: 10_000, fps: 15, width: 720, height: 405,
 *     quality: 10, stopOnBeats: null, audioEngine: null,
 *   });
 */
export class GifRecorder {
  constructor(renderer) {
    this._renderer = renderer;
    this._canvas   = renderer.domElement;

    // Per-run state. All initialised here so the abort path can safely
    // reference any of them even before start() has run.
    this._scratch  = null;
    this._gif      = null;
    this._captureTimer = null;
    this._stopTimer    = null;
    this._beatHandlerOriginal = null;
    this._beatsSeen    = 0;
    this._waitingForFirstBeat = false;
    this._frameDelay   = 0;
    this._lastFrameTime = 0;
    this._totalFrames   = 0;
    this._frameBudget   = 0;
    this.recording = false;
    this.encoding  = false;

    this.cb = {
      onStart:    ()           => {},
      onProgress: (_capturePct)=> {},
      onEncoding: (_encodePct) => {},
      onDone:     (_blob, _meta)=> {},
      onError:    (_msg)       => {},
      onAbort:    ()           => {},
    };
  }

  /**
   * Begin capturing. Returns synchronously; results arrive via callbacks.
   *
   * @param {object} opts
   * @param {number} opts.duration     — ms to record (ignored if stopOnBeats set)
   * @param {number} opts.fps          — capture frames per second
   * @param {number} opts.width        — output width in pixels
   * @param {number} opts.height       — output height in pixels
   * @param {number} [opts.quality=10] — gif.js quality (1=best/slow, 30=fast/blocky)
   * @param {boolean}[opts.dither=false] — Floyd-Steinberg dithering for smoother gradients
   * @param {number} [opts.workers=2]  — parallel encoder workers
   * @param {number} [opts.stopOnBeats] — when set, ignore duration and stop after N beats
   * @param {object} [opts.audioEngine] — required when stopOnBeats is set
   */
  start(opts = {}) {
    if (this.recording || this.encoding) {
      this.cb.onError('Already recording');
      return;
    }

    const o = clampOptions({
      duration: 10_000,
      fps:      15,
      width:    Math.min(this._canvas.width,  1280),
      height:   Math.min(this._canvas.height, 720),
      quality:  10,
      dither:   false,
      workers:  2,
      stopOnBeats: null,
      audioEngine: null,
      ...opts,
    });

    if (o.stopOnBeats != null && !o.audioEngine) {
      this.cb.onError('Beat-sync requires audioEngine reference');
      return;
    }

    // Memory pre-flight. 4 bytes/pixel is the worst-case intermediate
    // before gif.js compresses to indexed colour. The 1500 MB threshold
    // is the empirical edge below which Chrome stays alive on 4 GB
    // machines; above it we bail with a useful error instead of letting
    // the tab OOM mid-capture.
    const frames = Math.ceil((o.duration / 1000) * o.fps);
    const memMb = (o.width * o.height * 4 * frames) / (1024 * 1024);
    if (memMb > 1500) {
      this.cb.onError(`Estimated ${Math.round(memMb)}MB — reduce duration/size/fps`);
      return;
    }

    this._scratch    = makeScratchCanvas(o.width, o.height);
    this._frameDelay = 1000 / o.fps;
    this._totalFrames = frames;
    this._frameBudget = frames;
    this._lastFrameTime = 0;
    this._beatsSeen = 0;
    this.recording = true;
    this.encoding  = false;

    this._gif = new GIF({
      workerScript: getWorkerUrl(),
      workers:      o.workers,
      quality:      o.quality,
      width:        o.width,
      height:       o.height,
      dither:       o.dither,
      repeat:       0,        // 0 = loop forever (the whole point of a GIF)
      transparent:  null,
      background:   '#000',
    });

    this._gif.on('progress', p => this.cb.onEncoding(p));
    this._gif.on('finished', blob => {
      this.encoding = false;
      const meta = {
        width:  o.width,
        height: o.height,
        fps:    o.fps,
        frames: this._totalFrames - this._frameBudget,
        sizeMb: blob.size / (1024 * 1024),
      };
      this.cb.onDone(blob, meta);
    });
    this._gif.on('abort', () => {
      this.encoding = false;
      this.cb.onAbort();
    });

    // ── Beat-sync mode ────────────────────────────────────────────────────
    // The audio engine's onBeat callback already drives the visual beat
    // ring and bloom flash. We monkey-patch it to also count beats here,
    // taking care to call the original handler so the rest of the app
    // keeps working. The original is restored in stop() and abort().
    //
    // _totalFrames and _frameBudget are unknown up front in this mode —
    // capture runs open-ended and the beat counter decides when to stop.
    if (o.stopOnBeats != null) {
      this._waitingForFirstBeat = true;
      this._totalFrames = 0;
      this._frameBudget = Infinity;
      this._beatsTarget = o.stopOnBeats;
      this._audioEngine = o.audioEngine;

      this._beatHandlerOriginal = o.audioEngine.cb.onBeat;
      o.audioEngine.cb.onBeat = () => {
        try { this._beatHandlerOriginal?.(); } catch (_) {}
        this._onBeatTick();
      };
      this.cb.onStart();
      // Capture loop is started by the FIRST onBeat (in _onBeatTick),
      // not here — so the first frame lands on a downbeat.
      return;
    }

    // ── Time-based mode ───────────────────────────────────────────────────
    this.cb.onStart();
    this._startCaptureLoop();
    this._stopTimer = setTimeout(() => this.stop(), o.duration);
  }

  /** Stop capturing and kick off encoding. Idempotent; safe to call twice. */
  stop() {
    if (!this.recording) return;
    this.recording = false;
    clearTimeout(this._stopTimer);
    clearInterval(this._captureTimer);
    this._stopTimer = null;
    this._captureTimer = null;

    // Un-hijack the audio engine's beat handler if we patched it.
    if (this._audioEngine && this._beatHandlerOriginal !== null) {
      this._audioEngine.cb.onBeat = this._beatHandlerOriginal;
      this._beatHandlerOriginal = null;
      this._audioEngine = null;
    }

    // Beat-sync can stop before any frame was queued (e.g. user hit cancel
    // before the first beat). Skip the encode step in that case so the
    // user sees a clear error instead of an empty-file download.
    if (!this._gif || this._gif.frames.length === 0) {
      this.encoding = false;
      this.cb.onError('No frames captured');
      return;
    }

    this.encoding = true;
    this._gif.render();
  }

  /** Cancel mid-record or mid-encode without producing a file. */
  abort() {
    this.recording = false;
    clearTimeout(this._stopTimer);
    clearInterval(this._captureTimer);
    this._stopTimer = null;
    this._captureTimer = null;

    if (this._audioEngine && this._beatHandlerOriginal !== null) {
      this._audioEngine.cb.onBeat = this._beatHandlerOriginal;
      this._beatHandlerOriginal = null;
      this._audioEngine = null;
    }

    if (this._gif) {
      try { this._gif.abort(); } catch (_) {}
    }
    this.encoding = false;
    this.cb.onAbort();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Beat counter for stopOnBeats mode. Stops capture when target hit. */
  _onBeatTick() {
    if (!this.recording) return;
    // First beat opens the capture window — earlier beats (during click-
    // to-first-beat latency) shouldn't count toward _beatsTarget, or a
    // user clicking mid-bar would lose half a bar of their N-beat clip.
    if (this._waitingForFirstBeat) {
      this._waitingForFirstBeat = false;
      this._startCaptureLoop();
      return;
    }
    this._beatsSeen++;
    if (this._beatsSeen >= this._beatsTarget) {
      this.stop();
    }
  }

  /**
   * Frame-capture loop. Each tick:
   *   1. drawImage the WebGL canvas into the smaller scratch 2D canvas
   *      (downscales in one step using high-quality bilinear).
   *   2. Paint the watermark on top of the scaled frame.
   *   3. Hand the 2D canvas to gif.js, which copies pixels and queues
   *      them to a worker — non-blocking from our side.
   *
   * Why setInterval, not requestAnimationFrame:
   *   We want a STEADY capture rate independent of the render loop.
   *   The render loop runs at 60 fps but we capture at 15 fps; rAF
   *   would require manual frame-skipping arithmetic and drift over
   *   long captures. setInterval gives uniform spacing the encoder
   *   can rely on for per-frame delay values.
   */
  _startCaptureLoop() {
    const sctx = this._scratch.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    const w = this._scratch.width;
    const h = this._scratch.height;
    // Cover-crop source rect: sample the central region of the (usually
    // landscape) WebGL canvas matching the output aspect, so portrait /
    // square exports aren't stretched. Computed once — canvas size is
    // stable for the duration of a capture (resize during record is rare
    // and the next frame's drawImage tolerates a stale rect harmlessly).
    const src = coverRect(this._canvas.width, this._canvas.height, w, h);

    this._captureTimer = setInterval(() => {
      if (!this.recording) return;
      try {
        // drawImage from a WebGL canvas only works because the canvas was
        // created with preserveDrawingBuffer:true in render.js. Without
        // that flag the GPU back-buffer is destroyed at composite time
        // and we'd get a black frame here.
        sctx.drawImage(this._canvas, src.sx, src.sy, src.sw, src.sh, 0, 0, w, h);
        // Watermark goes AFTER the frame copy so it overlays the scene,
        // not the other way round.
        drawWatermark(sctx, w, h);
        this._gif.addFrame(this._scratch, { delay: this._frameDelay, copy: true });

        this._frameBudget--;
        const captured = this._totalFrames - this._frameBudget;
        if (this._totalFrames > 0) {
          this.cb.onProgress(captured / this._totalFrames);
        }

        if (this._frameBudget <= 0) {
          this.stop();
        }
      } catch (e) {
        this.cb.onError('Capture error: ' + e.message);
        this.abort();
      }
    }, this._frameDelay);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// WebmRecorder
// ═════════════════════════════════════════════════════════════════════════════
/**
 * WebM-via-MediaRecorder alternative for archival-quality output.
 *
 * Trade-offs vs GIF:
 *   + Far lower peak memory (the encoder is native, streams chunks out
 *     every 250 ms instead of holding every frame in JS memory).
 *   + Much better quality at any given file size.
 *   + Supports 60 fps and large resolutions without crashing tabs.
 *   − Doesn't auto-loop in chat previews — Twitter/Discord still want GIFs.
 *   − File is .webm, not universally playable in older video editors.
 *
 * Codec selection picks the best available WebM variant. VP9 first for
 * efficiency (smaller files at the same visual quality), VP8 as the
 * universal fallback, then plain "video/webm" for browsers that won't
 * tell us their codec list.
 */
export class WebmRecorder {
  constructor(renderer) {
    this._renderer = renderer;
    this._canvas   = renderer.domElement;
    this._stream   = null;
    this._mr       = null;
    this._chunks   = [];
    this._stopTimer = null;
    this.recording = false;

    this.cb = {
      onStart:    ()       => {},
      onProgress: (_pct)   => {},
      onDone:     (_blob, _meta) => {},
      onError:    (_msg)   => {},
      onAbort:    ()       => {},
    };
  }

  /** @param {{duration:number, fps:number, bitrateMbps:number, width:number, height:number}} opts */
  start(opts = {}) {
    if (this.recording) { this.cb.onError('Already recording'); return; }
    const o = {
      duration:    10_000,
      fps:         60,
      bitrateMbps: 8,
      // Output dimensions. Default to the live canvas size (Native preset);
      // an explicit width/height drives a fixed aspect (portrait/square/etc)
      // with cover-crop. Clamped to LIMITS so portrait 1080×1920 passes but
      // nothing exceeds the encoder's practical ceiling.
      width:       this._canvas.width,
      height:      this._canvas.height,
      ...opts,
    };
    o.width  = Math.min(o.width,  LIMITS.maxWidth);
    o.height = Math.min(o.height, LIMITS.maxHeight);
    // 5-minute ceiling. The encoder itself can run longer, but a single
    // WebM file past this point is more than most archive workflows want.
    if (o.duration > 5 * 60_000) o.duration = 5 * 60_000;

    if (typeof MediaRecorder === 'undefined') {
      this.cb.onError('MediaRecorder not supported in this browser');
      return;
    }
    if (!this._canvas.captureStream) {
      this.cb.onError('captureStream not supported — use Chrome/Edge/Firefox');
      return;
    }

    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = candidates.find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) { this.cb.onError('No supported WebM codec'); return; }

    try {
      // ── Composite canvas ────────────────────────────────────────────
      // We can't captureStream() directly from the WebGL canvas because
      // we need the watermark overlay AND aspect control. Instead: create a
      // 2D canvas at the OUTPUT size (o.width × o.height, not the native
      // canvas size), redraw it every rAF tick (WebGL → cover-crop → 2D +
      // watermark), and captureStream THAT. The browser snapshots the
      // composite at its own pace; we just keep it fresh.
      this._compCanvas = makeScratchCanvas(o.width, o.height);
      this._compCtx    = this._compCanvas.getContext('2d');
      this._compCtx.imageSmoothingEnabled = true;
      this._compCtx.imageSmoothingQuality = 'high';

      this._stream = this._compCanvas.captureStream(o.fps);
      this._mr = new MediaRecorder(this._stream, {
        mimeType,
        videoBitsPerSecond: o.bitrateMbps * 1_000_000,
      });
      this._chunks = [];

      this._mr.ondataavailable = e => {
        if (e.data && e.data.size) this._chunks.push(e.data);
      };
      this._mr.onstop = () => {
        this.recording = false;
        const blob = new Blob(this._chunks, { type: mimeType });
        this._chunks = [];
        if (this._stream) {
          this._stream.getTracks().forEach(t => t.stop());
          this._stream = null;
        }
        this._compCanvas = null;
        this._compCtx    = null;
        const meta = {
          mimeType, fps: o.fps, sizeMb: blob.size / (1024 * 1024),
        };
        this.cb.onDone(blob, meta);
      };
      this._mr.onerror = e => {
        this.cb.onError(`MediaRecorder error: ${e.error?.name || 'unknown'}`);
        this.abort();
      };

      this.recording = true;
      // start(250) asks the encoder to emit a chunk every 250 ms. That
      // drives ondataavailable steadily so chunks aren't all held until
      // stop() — both keeps memory flat and lets us recover partial
      // output if the tab is forcibly closed mid-record.
      this._mr.start(250);
      this.cb.onStart();

      // ── Composite refresh loop ──────────────────────────────────────
      // rAF (not setInterval) because captureStream emits a new video
      // frame WHEN THE 2D CANVAS IS DRAWN, not on a fixed clock. Driving
      // the redraw from rAF matches the browser's render cadence, gives
      // smooth motion, and lets the captureStream fps act as a ceiling
      // rather than a target.
      const w = this._compCanvas.width;
      const h = this._compCanvas.height;
      const renderLoop = () => {
        if (!this.recording) return;
        try {
          // Cover-crop the (usually landscape) WebGL canvas into the output
          // aspect. Recomputed each frame: unlike the GIF path, a WebM
          // record can run minutes and the window may resize mid-capture,
          // changing this._canvas dimensions. A per-frame rect stays correct.
          const src = coverRect(this._canvas.width, this._canvas.height, w, h);
          this._compCtx.drawImage(this._canvas, src.sx, src.sy, src.sw, src.sh, 0, 0, w, h);
          drawWatermark(this._compCtx, w, h);
        } catch (_) {
          // WebGL canvas can be resized between draws (window resize, DPI
          // change). drawImage throws; we swallow it and try again next
          // frame, by which time the canvas has stabilised.
        }
        requestAnimationFrame(renderLoop);
      };
      requestAnimationFrame(renderLoop);

      // Progress tracker — purely time-based, decoupled from the encoder
      // because the encoder reports chunks, not progress.
      const startMs = performance.now();
      const tick = () => {
        if (!this.recording) return;
        const pct = Math.min(1, (performance.now() - startMs) / o.duration);
        this.cb.onProgress(pct);
        if (pct < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      this._stopTimer = setTimeout(() => this.stop(), o.duration);
    } catch (e) {
      this.cb.onError('Failed to start: ' + e.message);
      this.recording = false;
    }
  }

  /** Stop the encoder. ondataavailable + onstop fire the Blob into onDone. */
  stop() {
    if (!this.recording) return;
    clearTimeout(this._stopTimer); this._stopTimer = null;
    try { this._mr?.stop(); } catch (_) {}
  }

  /** Abandon the recording without producing a file. */
  abort() {
    this.recording = false;
    clearTimeout(this._stopTimer); this._stopTimer = null;
    try { this._mr?.stop(); } catch (_) {}
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    this._compCanvas = null;
    this._compCtx    = null;
    this._chunks = [];
    this.cb.onAbort();
  }
}

// ── Helper: trigger a browser download for any Blob ──────────────────────
/**
 * Build a temporary <a download> for `blob`, click it, then revoke the
 * object URL. The 1-second delay before revoke is intentional: in some
 * Chromium builds, revoking the URL synchronously after the click aborts
 * the download (the browser hasn't fully read the URL yet). A delayed
 * revoke gives it the time it needs and still releases the URL promptly.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
