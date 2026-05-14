import * as THREE from 'three';

/**
 * src/output.js — Professional Video Output Module
 *
 * Three output modes:
 *
 * 1. VIRTUAL CAMERA  — canvas.captureStream() exposed as a MediaStream.
 *    Chrome 94+ supports "Screen Capture API": the stream can be fed into
 *    an <video> element, or pushed to a PeerConnection for NDI/WebRTC bridges.
 *    OBS picks it up via "Video Capture Device" after the user installs the
 *    Chrome Virtual Camera extension OR via OBS Browser Source (zero setup).
 *
 * 2. NDI STUB  — architecture placeholder. Real NDI requires the NDI SDK
 *    runtime + a WebRTC→NDI bridge (e.g. obs-ndi, ndi-webrtc-peer-worker).
 *    The stub documents the integration surface and fires a postMessage that
 *    an Electron main process or a companion native app can intercept.
 *
 * 3. SPOUT STUB  — Spout is DirectX texture sharing (Windows only). It cannot
 *    run inside a sandboxed browser process. This stub fires a postMessage so
 *    an Electron wrapper with `spout-node` (npm) can forward the frame.
 *    In pure-browser mode it logs a clear explanation instead of silently failing.
 */

// ── Capability detection ──────────────────────────────────────────────────────
const IS_WINDOWS = navigator.platform?.toLowerCase().includes('win') ||
                   navigator.userAgent.toLowerCase().includes('windows');
const IS_CHROME  = /Chrome\/(\d+)/.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
const IN_ELECTRON = typeof window !== 'undefined' && !!window.electronAPI;
const SUPPORTS_CAPTURE_STREAM = typeof HTMLCanvasElement !== 'undefined' &&
                                 'captureStream' in HTMLCanvasElement.prototype;

export const OUTPUT_CAPABILITIES = {
  virtualCamera: SUPPORTS_CAPTURE_STREAM && IS_CHROME,
  ndi:           false,         // always requires external bridge
  spout:         IN_ELECTRON && IS_WINDOWS,
  spoutBrowser:  false,         // never works in browser
  obsSource:     true,          // always available — just open as Browser Source
};

// ── VirtualCameraOutput ───────────────────────────────────────────────────────
/**
 * Exposes the renderer canvas as a MediaStream at a chosen FPS.
 *
 * In Chrome: the stream auto-appears as a "Tab video" source in any
 * MediaStream consumer. To get it into OBS as a camera:
 *   Option A — OBS Browser Source (no extra steps, most reliable)
 *   Option B — Chrome "Virtual Camera" via WebRTC + OBS NDI plugin
 */
export class VirtualCameraOutput {
  constructor(renderer) {
    this._renderer = renderer;
    this._stream   = null;
    this._fps      = 60;
    this.active    = false;
  }

  /** @returns {{ ok:boolean, stream?:MediaStream, error?:string }} */
  start(fps = 60) {
    if (!SUPPORTS_CAPTURE_STREAM) {
      return { ok: false, error: 'captureStream() not supported in this browser. Use Chrome.' };
    }
    try {
      this._fps    = fps;
      this._stream = this._renderer.domElement.captureStream(fps);
      this.active  = true;
      return { ok: true, stream: this._stream };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  stop() {
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    this.active = false;
  }

  /** Returns the live MediaStream so callers can wire it to <video> or PeerConnection */
  getStream() { return this._stream; }

  /**
   * Shows the stream in a floating preview <video> element.
   * This is the simplest way to verify the output is working.
   */
  showPreview() {
    let v = document.getElementById('_vimathic_vcam_preview');
    if (!v) {
      v = document.createElement('video');
      v.id = '_vimathic_vcam_preview';
      v.style.cssText = 'position:fixed;bottom:80px;left:14px;width:200px;height:113px;' +
        'border:1px solid rgba(0,255,255,.4);border-radius:6px;z-index:9000;' +
        'background:#000;opacity:.9;cursor:pointer';
      v.title = 'Virtual Camera Preview — click to hide';
      v.onclick = () => this.hidePreview();
      v.muted = true;
      v.autoplay = true;
      document.body.appendChild(v);
    }
    v.srcObject = this._stream;
    v.style.display = '';
  }

  hidePreview() {
    const v = document.getElementById('_vimathic_vcam_preview');
    if (v) v.style.display = 'none';
  }
}

// ── NDIOutput (stub) ──────────────────────────────────────────────────────────
/**
 * NDI (Network Device Interface) by NewTek/Vizrt.
 * Real integration requires:
 *   1. NDI Runtime installed on target machine (free download from ndi.tv)
 *   2. A WebRTC→NDI bridge, e.g.:
 *      - obs-ndi plugin (OBS side)
 *      - ndi-webrtc-peer-worker (Node.js bridge)
 *      - Vingester (turns browser tabs into NDI sources natively)
 *
 * This stub fires a postMessage that an Electron main process or
 * companion script can intercept and forward to the NDI SDK.
 *
 * Recommended zero-config approach for NDI without this code:
 *   Install Vingester (free) → it turns any browser URL into an NDI source.
 */
export class NDIOutput {
  constructor(renderer) {
    this._renderer  = renderer;
    this._canvas    = renderer.domElement;
    this._rafId     = null;
    this.active     = false;
    this.senderName = 'VIMATHIC';
  }

  start(senderName = 'VIMATHIC') {
    this.senderName = senderName;
    if (IN_ELECTRON) {
      // Electron main process should implement window.electronAPI.ndiStart(name)
      window.electronAPI?.ndiStart?.(senderName);
      this.active = true;
      this._sendLoop();
      return { ok: true };
    }
    // Browser-only: fire postMessage for companion proxy
    window.postMessage({ type: 'VIMATHIC_NDI_START', sender: senderName }, '*');
    this.active = true;
    this._sendLoop();
    return {
      ok: true,
      note: 'NDI postMessage mode. Requires a companion bridge (Vingester recommended for zero-config).',
    };
  }

  _sendLoop() {
    if (!this.active) return;

    if (IN_ELECTRON) {
      // Electron IPC needs string — toDataURL unavoidable but IPC is async so
      // it doesn't block the render thread the same way a sync encode does.
      const imageData = this._canvas.toDataURL('image/jpeg', 0.85);
      window.electronAPI?.ndiSendFrame?.(imageData);
      this._rafId = requestAnimationFrame(() => this._sendLoop());
    } else {
      // Browser postMessage: use async convertToBlob — stays fully off the main thread.
      // 1-frame latency is imperceptible for a network stream.
      this._canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
        .then(blob => {
          if (!this.active) return;
          const reader = new FileReader();
          reader.onloadend = () => {
            if (!this.active) return;
            window.postMessage({ type: 'VIMATHIC_NDI_FRAME', data: reader.result }, '*');
          };
          reader.readAsDataURL(blob);
        })
        .catch(() => {})
        .finally(() => {
          if (this.active) this._rafId = requestAnimationFrame(() => this._sendLoop());
        });
    }
  }

  stop() {
    this.active = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (IN_ELECTRON) { window.electronAPI?.ndiStop?.(); }
    else { window.postMessage({ type: 'VIMATHIC_NDI_STOP' }, '*'); }
  }
}

// ── SpoutOutput (stub) ────────────────────────────────────────────────────────
/**
 * Spout — DirectX texture sharing for Windows.
 * Supported receivers: OBS (with obs-spout2 plugin), Resolume, VDMX, MadMapper, TouchDesigner.
 *
 * IN ELECTRON:
 *   Install `spout-node` (npm) in the Electron main process.
 *   Implement window.electronAPI.spoutStart(name) / spoutSendFrame(dataUrl) / spoutStop().
 *   This class sends frames via IPC. Latency ~1 frame at 60fps.
 *
 * IN BROWSER (not Electron):
 *   Impossible. Spout is a DirectX API — no browser sandbox can call it.
 *   This class explains the limitation clearly rather than silently failing.
 *
 * RECOMMENDED ZERO-CONFIG ALTERNATIVE:
 *   Use SpoutToNDI (free) + obs-ndi, or use the Virtual Camera mode + OBS.
 */
export class SpoutOutput {
  constructor(renderer) {
    this._renderer  = renderer;
    this._canvas    = renderer.domElement;
    this._rafId     = null;
    this._lastSend  = 0;
    this.active     = false;
    this.senderName = 'VIMATHIC';
  }

  start(senderName = 'VIMATHIC') {
    this.senderName = senderName;

    if (!IS_WINDOWS) {
      return { ok: false, error: 'Spout is Windows-only. On Mac/Linux use Syphon or NDI.' };
    }
    if (!IN_ELECTRON) {
      return {
        ok: false,
        error: 'Spout requires Electron wrapper — cannot access DirectX from a browser sandbox.',
        suggestion: 'Use Virtual Camera + OBS, or install Vingester for NDI output.',
      };
    }

    // Electron path
    const result = window.electronAPI?.spoutStart?.(senderName);
    if (result === false) {
      return { ok: false, error: 'spout-node not available. Run: npm install spout-node in Electron main.' };
    }
    this.active = true;
    this._sendLoop();
    return { ok: true };
  }

  _sendLoop() {
    if (!this.active) return;
    // PNG encode is expensive. Throttle to ~30fps to halve main-thread cost.
    // Spout receivers interpolate anyway; 30fps source is imperceptible.
    if (!this._lastSend || performance.now() - this._lastSend >= 33) {
      this._lastSend = performance.now();
      const data = this._canvas.toDataURL('image/png');
      window.electronAPI?.spoutSendFrame?.(data);
    }
    this._rafId = requestAnimationFrame(() => this._sendLoop());
  }

  stop() {
    this.active = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    window.electronAPI?.spoutStop?.();
  }
}

// ── OutputManager ─────────────────────────────────────────────────────────────
/**
 * Aggregates all output modes. One instance per app.
 * Wired by UIController; called from RenderEngine after each compose.
 */
export class OutputManager {
  constructor(renderer) {
    this.renderer      = renderer;
    this.vcam          = new VirtualCameraOutput(renderer);
    this.ndi           = new NDIOutput(renderer);
    this.spout         = new SpoutOutput(renderer);
    this.capabilities  = OUTPUT_CAPABILITIES;

    // Transparent background state
    this.transparentBg = false;
  }

  // ── Per-frame tick (called after composer.render()) ───────────────────────
  tick() {
    // Spout and NDI send in their own rAF loops to decouple from main loop.
    // VirtualCamera is passive (captureStream auto-copies from canvas).
    // Nothing needed here currently — hook available for future GPU texture share.
  }

  // ── Stop all outputs ──────────────────────────────────────────────────────
  stopAll() {
    if (this.vcam.active)  this.vcam.stop();
    if (this.ndi.active)   this.ndi.stop();
    if (this.spout.active) this.spout.stop();
  }
}

// ── SecondScreen ──────────────────────────────────────────────────────────────
/**
 * Opens a borderless popup showing only the visualizer canvas — perfect for
 * a projector or second monitor. Uses canvas.captureStream() → <video> in popup.
 *
 * Strategy:
 *   1. captureStream(60) on the main renderer canvas
 *   2. Store stream on window._vjStream so the popup page can read it via opener
 *   3. Open /second-screen.html as a popup sized to the current screen
 *   4. Popup polls window.opener._vjStream until it gets a live stream
 *
 * The popup page is in /second-screen.html (Vite copies it to dist/).
 * In dev mode (vite serve) it's served at /second-screen.html automatically.
 *
 * Fallback for browsers without captureStream (Firefox < 113, Safari):
 *   Shows a clear error message — don't try to polyfill, just explain.
 */
export class SecondScreen {
  constructor(renderer) {
    this._renderer = renderer;
    this._popup    = null;
    this._stream   = null;
    this.active    = false;

    this.cb = {
      onOpen:  () => {},
      onClose: () => {},
      onError: (_msg) => {},
    };
  }

  open(fps = 60) {
    // Guard: already open
    if (this._popup && !this._popup.closed) {
      this._popup.focus();
      return;
    }

    const canvas = this._renderer.domElement;
    if (!canvas.captureStream) {
      this.cb.onError('captureStream() not supported. Use Chrome or Edge.');
      return;
    }

    try {
      this._stream        = canvas.captureStream(fps);
      window._vjStream    = this._stream;   // accessible to popup via window.opener

      // Size popup to fill the available screen (works well for a second monitor)
      const w = window.screen.availWidth;
      const h = window.screen.availHeight;
      const features = `width=${w},height=${h},left=0,top=0,toolbar=no,menubar=no,` +
                       `scrollbars=no,resizable=yes,status=no`;

      this._popup = window.open('/second-screen.html', '_vjscreen', features);

      if (!this._popup) {
        this.cb.onError('Popup blocked — allow popups for this site and try again.');
        return;
      }

      this.active = true;

      // Watch for popup being closed externally
      this._pollTimer = setInterval(() => {
        if (this._popup?.closed) this._handleClose();
      }, 800);

      this.cb.onOpen();
    } catch (e) {
      this.cb.onError(e.message);
    }
  }

  close() {
    if (this._popup && !this._popup.closed) this._popup.close();
    this._handleClose();
  }

  _handleClose() {
    clearInterval(this._pollTimer);
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    window._vjStream = null;
    this._popup = null;
    this.active = false;
    this.cb.onClose();
  }
}

