---
title: Output
order: 8
group: production
description: Send VIMATHIC to a projector, second monitor, OBS, or professional VJ software via virtual camera, second screen, NDI, or Spout.
---

# Output

VIMATHIC can send its video to other apps and displays. Four output paths are built in, ranging from zero-setup (second screen popup) to bridge-required (NDI, Spout).

## Second Screen — projector / second monitor

The simplest case: a separate window showing only the canvas, intended for a projector or external display.

1. Click **SECOND SCREEN** in the Output modal (or in the panel directly).
2. A popup window opens at full-screen size on the available screen.
3. Drag it to your projector / external monitor, double-click for full-screen.
4. Use `F` inside the popup to toggle full-screen; `Esc` to exit; `F5` to reconnect if the stream drops.

How it works under the hood:

- Main window captures its canvas as a `MediaStream` at 60 fps.
- Stores the stream on `window._vjStream`.
- Popup opens `second-screen.html` which reads `window.opener._vjStream` and pipes it into a `<video>` element.

Latency is one frame (~16ms at 60 fps) — imperceptible in practice. Resolution matches your main window's canvas resolution.

### Requirements

- Chrome or Edge (Firefox supports `captureStream` but has popup-permission quirks).
- Popup blocker must allow `vimathic.com` (or local dev origin).

If the popup says "No stream — reload main window," refresh the main page first, then re-open the popup.

## Virtual Camera — feed into OBS, Zoom, anything

VIMATHIC exposes its canvas as a virtual webcam-style video source. OBS sees it as a "Tab video" source; Zoom can use it as a camera.

### Easiest route: OBS Browser Source

1. In OBS: **+ Add → Browser Source**
2. URL: your VIMATHIC URL (local file path, dev server, or vimathic.com)
3. Width / Height: match your stream resolution (1920×1080)
4. Check **Control audio via OBS** to route audio too

This is zero-config and works on Windows / macOS / Linux. The Browser Source method is the recommended way to use VIMATHIC with OBS for streaming or recording.

### Alternative: in-app Virtual Camera

The Output modal has a **Virtual Camera** section. Click **START** — the canvas is exposed as a `MediaStream` at a configurable FPS (default 60). A small preview window shows the active stream.

To use it elsewhere:

- **OBS via NDI plugin** — see NDI section below
- **PeerConnection** — for advanced use, the live `MediaStream` is held on the in-app `OutputManager` and can be retrieved via the public API (`outputManager.vcam.getStream()`). The application doesn't expose it on `window` by default — if you need it from devtools, attach it yourself or hook the `outputs.js` source.

For most users, OBS Browser Source is simpler. The in-app Virtual Camera mode is useful when you need explicit FPS control or you're piping into a custom WebRTC setup.

## NDI — professional video network

NDI (Network Device Interface) by NewTek/Vizrt is the de facto standard for routing video between VJ apps, OBS, vMix, Resolume, and TouchDesigner over a network.

VIMATHIC **does not implement NDI natively** — that requires the NDI SDK runtime, which can't run inside a browser sandbox. Two options:

### Recommended: Vingester (free, zero-config)

[Vingester](https://github.com/rse/vingester) turns any browser tab into an NDI source. Install Vingester, open VIMATHIC inside it, and your visualizer appears as `VIMATHIC` on the NDI network. OBS with obs-ndi plugin, Resolume, TouchDesigner — all see it instantly.

### For developers: postMessage bridge

VIMATHIC fires `window.postMessage({ type: 'VIMATHIC_NDI_FRAME', ... })` events at frame rate when NDI output is enabled. A companion Electron app or native bridge can intercept these and forward to the NDI SDK. The architecture is in `outputs.js` — see `NDIOutput` class for the message format.

This stub exists so the integration surface is documented. It's not a finished solution; you need to write the bridge.

## Spout — Windows-only DirectX texture sharing

Spout is the Windows equivalent of NDI, but uses shared DirectX textures instead of network packets. Lower latency, Windows-only. Used by Resolume, MadMapper, TouchDesigner, OBS (with obs-spout2 plugin).

VIMATHIC **does not implement Spout natively** because the browser sandbox can't call DirectX APIs. Two paths:

### Recommended: SpoutToNDI + obs-ndi

Use [SpoutToNDI](https://github.com/leadedge/SpoutToNDI) to bridge from Spout to NDI, then route NDI as above. Adds one extra hop but is set-once-and-forget.

### For developers: Electron with spout-node

If you're packaging VIMATHIC as a desktop app via Electron, install `spout-node` in the main process and implement `window.electronAPI.spoutSendFrame(dataUrl)`. The renderer process in `outputs.js` calls this every frame when Spout output is enabled.

In a pure browser build, the Spout button shows an explanatory error: "Spout requires Electron wrapper — cannot access DirectX from a browser sandbox."

## Comparison

| Output | Setup | Latency | Platform | Use case |
|---|---|---|---|---|
| Second Screen | Click button | 1 frame | Any modern browser | Projector / 2nd monitor |
| OBS Browser Source | OBS config | 2–3 frames | Any | Streaming, recording |
| In-app Virtual Camera | Click START | 1 frame | Chrome / Edge | Custom WebRTC, advanced |
| NDI (Vingester) | Install Vingester | 2–5 frames | Win / Mac / Linux | Pro VJ / broadcast |
| Spout (with bridge) | Several tools | 1–2 frames | Windows only | Pro VJ on Windows |

## Transparent background

Want VIMATHIC composited *over* something else (a webcam feed, a different layer in OBS)? The Output modal has a **TRANSPARENT BG** toggle. The renderer sets its clear color to transparent and the canvas alpha channel is preserved through to the output stream.

- **OBS Browser Source** — works automatically
- **NDI / Spout** — depends on the receiver's alpha support
- **Second Screen** — the popup has a black background; transparent bg shows through to it as black

For green-screen workflows, use a solid-color background instead and key it out downstream.

## Tips

- **For VJ sets:** Second Screen on a projector + Virtual Camera into OBS for stream is a clean combo.
- **For streaming:** OBS Browser Source is the path of least resistance. The Virtual Camera mode is overkill unless you specifically need it.
- **For multi-monitor home setups:** Open VIMATHIC on monitor 1 with the control panel, open Second Screen on monitor 2 in full-screen. Best of both worlds.
- **Lock the audio source before opening Second Screen.** Audio is captured from the main tab; the popup is video-only.
