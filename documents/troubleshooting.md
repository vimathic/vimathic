---
title: Troubleshooting
order: 9
group: about
description: Common issues and how to fix them. If something's broken, start here.
---

# Troubleshooting

VIMATHIC is developed and tested primarily in Chrome and Edge. Features like MIDI, tab audio capture, and the in-app Virtual Camera require Chromium-based browsers. The core visualizer works in Firefox and Safari with reduced functionality.

If something isn't working, this list covers ~90% of issues. Symptoms in **bold**, fixes underneath. If your problem isn't here, check the browser console (F12 → Console) for an error message — most failures log something explicit.

## Audio

### **No sound when I press play**

- Browser may have blocked autoplay. Click anywhere on the page first to "unlock" audio context, then press play again.
- Audio file format unsupported. Try MP3 or WAV — FLAC and OGG work in most browsers but not all.
- System volume / browser volume / page mute. Check the tab's audio indicator.

### **Visualization doesn't react even though audio plays**

- **Amplitude** slider is at 0 — raise it.
- **Bass Sensitivity** at 0 — raise to 1.0+.
- Audio source is very quiet — VIMATHIC's beat detection has a threshold; below it, nothing fires.
- You're listening to a different audio source than VIMATHIC is reading. If you used the **Audio Source** modal to switch to mic or tab capture, the file player is silent. Switch back to **FILE** to use the playlist.

### **Microphone or tab audio not working**

- Permission denied. Look for a permission-denied icon in the address bar; click it and re-grant.
- Wrong device selected. Open **Audio Source** modal → check the device dropdown is your actual mic.
- Tab audio only works in Chrome. Firefox and Safari don't support it.
- System audio requires Windows + Chrome with `getDisplayMedia({ audio: true })` — won't work on macOS.

### **Crossfade glitch between tracks**

- Audio decoding takes longer than the crossfade window. Increase crossfade duration in the Audio Source modal, or pre-load tracks by clicking through the playlist once before starting.

## Visual / Performance

### **Frame rate is low (15–30 fps)**

- Window too large. Resize the browser to ~1280×720; performance scales quadratically with pixel count.
- Heavy formula on heavy mesh. Switch to a simpler formula (try **Surface → Trigonometry** category) or a smaller shape (Plane, Cylinder).
- Post-processing stack is heavy. Disable **God Rays** and **Motion Blur** in the panel (they auto-disable on mobile).
- Browser tab is in the background. Some browsers throttle backgrounded tabs to 1 fps. Bring the tab to foreground.

### **Web Worker not active (math runs slow)**

- After deployment, the math Web Worker is a separate file (`math-worker-XXX.js`). It must be deployed alongside `index.html` at the same path.
- The console will log `[MathVisualizer] Worker unavailable — math will run synchronously on main thread` once if it fails to load.
- Fix: re-upload `math-worker-XXX.js` to the same directory as `index.html` on your server.

### **Screen tearing or stuttering**

- VSync disabled in browser/OS. Enable it.
- Hardware acceleration off. Chrome: `chrome://settings/system` → enable **Use hardware acceleration when available**, restart browser.
- Old GPU driver. Update GPU drivers (especially on Windows + integrated Intel/AMD graphics).

### **Black screen / nothing renders**

- WebGL not available. Check at https://webglreport.com — if it says WebGL is disabled, enable it in your browser. Chrome flag: `chrome://flags/#ignore-gpu-blocklist`.
- Custom shader has a compile error. Open **Shader Editor** modal — if there's a red error message, click **RESET**.
- Browser tab ran out of memory (rare). Restart the tab.

### **Colors look wrong**

- Imported preset references a color scheme index that doesn't exist in your current build. The shader falls back to a default palette. Re-save the preset on your current version to capture a valid index.

### **Shader Editor says "Compiled & applied" but nothing changes**

- You're in CPU mode. The Shader Editor only affects rendering when a **numbered** GPU shader is active (entries like *1. Bass Reactive Waves*, *2. Spectrogram Mode*, … *38. Spectral Centroid* in the SHADER MODE dropdown). CPU formulas (entries without numbers, like *Mandelbrot Escape*, *Lorenz Attractor Slice*) bypass the Shader Editor.
- Fix: pick a numbered entry from the SHADER MODE dropdown, then APPLY your shader again. See the [Shader Editor](./shader-editor.md) doc for the full prerequisite explanation.

## MIDI

### **MIDI badge stays grey**

- Web MIDI permission denied. Click the lock icon in the address bar → site settings → re-grant.
- Browser doesn't support Web MIDI. Use Chrome or Edge. Firefox and Safari do not implement it.
- Bluetooth MIDI: pair the controller in the OS first, then VIMATHIC sees it.

### **Knob moves but parameter doesn't**

- Controller sending NRPN or Note events instead of CC. Check your controller's mode — should be "Control Change" or "CC".
- The CC isn't mapped. Open the **MIDI** section, use **LEARN** mode, move the knob, pick a parameter.
- Mapping was lost. Mappings are in `localStorage`. If you cleared site data, you lost them — remap.

### **Wrong parameter responds to my knob**

- Two knobs sending the same CC number. Disconnect one, re-learn the other.
- Mapping is leftover from a previous session. Click **CLEAR** in MIDI section to wipe all mappings, start fresh.

## Recording

### **GIF recording fails immediately**

- Insufficient memory. Reduce resolution or duration. 720p × 30fps × 60s needs ~1.5 GB.
- Browser tab limited. Close other tabs, retry.

### **GIF capture hangs at "ENCODING"**

- gif.js encoder is busy. Wait — encoding takes ~30s for a 4-second 480p capture, longer for bigger. Check task manager: one CPU core should be at 100% during encoding.
- If it never completes after 5 minutes, refresh the page. Partial work is lost.

### **WebM has no audio**

- By design. VIMATHIC recordings don't embed audio. Combine separately in a video editor.

### **WebM doesn't open in QuickTime**

- VP9 codec isn't supported by older QuickTime versions. Use VLC instead, or convert: `ffmpeg -i input.webm -c:v libx264 output.mp4`

### **Watermark is in the way**

- The "VIMATHIC" watermark is a deliberate attribution marker. It can't be disabled in the UI. See `LICENSE.txt` for the legal context.

## Output

### **Second Screen popup blocked**

- Browser popup blocker. Allow popups for `vimathic.com` (or your origin) in browser settings.

### **Second Screen shows "No stream — reload main window"**

- The main window was closed or refreshed after the popup opened. Reload both, then re-open the second screen.

### **OBS Browser Source is black / blank**

- OBS Browser Source has its own permission model. Right-click the source → **Properties** → check **Control audio via OBS** (or uncheck — sometimes it fixes the freeze).
- Refresh the source: right-click → **Refresh cache of current page**.
- Wrong URL. For local builds, use `file:///full/path/to/dist/index.html`. For dev mode, use `http://localhost:3000`. For production, use your deployed URL.

### **Virtual Camera works in Chrome but not in Zoom**

- Zoom doesn't see `MediaStream` directly. You need the **OBS Virtual Camera** approach: OBS receives via Browser Source, then OBS's "Start Virtual Camera" exposes it system-wide.

## Presets

### **Preset deleted by accident**

- No undo. Restore from your most recent JSON export (export weekly!).

### **Preset doesn't load completely**

- Imported from a much older version. Some fields may have been removed. Check the console for migration warnings.
- Imported from a much newer version. Some fields may be ignored. The preset still loads but may behave differently.

### **Imported preset asks about JavaScript code**

- Working as designed. Imported presets may contain Camera Programmer JavaScript. VIMATHIC always asks before keeping that code. **Only click KEEP if you trust the source** — see `SECURITY.md`.

## Browser / Environment

### **Works in dev mode but not in deployed build**

- The math worker file (`math-worker-XXX.js`) wasn't uploaded alongside `index.html`. Both files must be at the same path on the server, or the worker falls back to slower main-thread computation.
- CDN cached an old build. Hard reload: `Ctrl+Shift+R` (Cmd+Shift+R on Mac), or clear browser cache for the site.

### **MIDI worked yesterday, not today**

- Browser update may have reset MIDI permission. Re-grant in address bar.
- Bluetooth MIDI device powered off — wake it up and reload.

### **Page hangs on a specific formula**

- Some Tier-C formulas use heavy CPU computations (Gray-Scott, FitzHugh-Nagumo, 3D Conway). On lower-end mobile, they can lock the main thread for seconds before the worker fallback kicks in. If page is unresponsive: close the tab, reopen, pick a lighter formula on first load.

## Performance expectations

With the math worker enabled (default):

- **Desktop, modern Chrome/Edge:** 60 fps stable on all formulas.
- **Mid-range laptop (integrated GPU):** 60 fps on formulas with grid ≤ 64², 50–60 fps on heavier ones.
- **Mid-range mobile:** 60 fps on simple formulas, 30–40 fps on heavy ones (Gray-Scott, 3D Conway). Render rate is capped at ~30 fps on mobile to manage thermal load.
- **Old mobile / low-end devices:** graceful degradation; post-processing effects auto-disabled.

Without the worker (sync fallback):

- **Desktop:** 60 fps on most formulas, drops to 30–40 fps on the heaviest.
- **Mid-range mobile:** 30 fps on simple formulas, 15–20 fps on heavy.
- **Mobile is essentially unusable** for the new C-tier formulas (FitzHugh-Nagumo, Gray-Scott).

If you're seeing lower performance than the above, check that `_vimathic_worker_active` is `true` in the console.

## Browser compatibility

| Feature | Chrome | Edge | Firefox | Safari |
|---------|:------:|:----:|:-------:|:------:|
| WebGL rendering | ✓ | ✓ | ✓ | ✓ |
| Web Audio API | ✓ | ✓ | ✓ | ✓ |
| Web MIDI API | ✓ | ✓ | ✗ | ✗ |
| `captureStream()` (Virtual Camera) | ✓ | ✓ | ✓* | ✗ |
| `MediaRecorder` (WebM export) | ✓ | ✓ | ✓ | ✓ |
| Tab audio capture | ✓ | ✓ | ✗ | ✗ |
| System audio capture | ✓ (Win) | ✓ (Win) | ✗ | ✗ |
| Second-screen popup | ✓ | ✓ | ✓ | ✓ |
| GIF recorder (gif.js worker) | ✓ | ✓ | ✓ | ✓ |
| About modal (in-app docs) | ✓ | ✓ | ✓ | ✓ |
| Docs site (`/docs/*.html`) | ✓ | ✓ | ✓ | ✓ |

*Firefox supports `captureStream()` but not for audio capture via `getDisplayMedia`.

The About modal and the static docs site are pure HTML/CSS/JS and work everywhere the main app works.

## Still stuck?

- **Check the browser console** (F12 → Console). Most failures log a clear message.
- **Try in Chrome incognito mode** — rules out extensions interfering.
- **Update Chrome / Edge / Firefox** to the latest version.
- **Verify the math worker is loaded.** Open the browser console and type `_vimathic_worker_active` — should be `true`. If `false`, the `math-worker-*.js` file is missing or at the wrong path.

If you've checked all of the above and have a reproducible issue, file it at the project's GitHub repository with: browser + OS, what you did, what you expected, what happened, console output.