---
title: Recording
order: 6
group: production
description: Capture VIMATHIC as animated GIF or WebM video — beat-synced loops, configurable resolution, automatic watermark.
---

# Recording & Export

VIMATHIC has two built-in recorders: **GIF** for sharable loops and **WebM** for higher-quality video. Both capture the canvas directly — what you see is what gets recorded. Both add a small "VIMATHIC" watermark to the corner.

## Opening the recorder

Open **ADVANCED** in the control panel, expand **VIDEO OUTPUT & AUDIO IN**, and click **OUTPUT SETTINGS** — both sections ship collapsed. The output modal includes a **🎞️ RECORD CLIP** section near the bottom. From there:

- Choose format — **GIF** or **WebM**
- Choose aspect — 16:9 landscape, 9:16 portrait (TikTok/Reels), 1:1 square, or Native; the recorder centre-crops the canvas so nothing is stretched
- Set resolution, FPS, quality
- Choose duration mode — **seconds** or **beats**
- Click **⏺ START RECORDING** to start, **⏹ STOP** to end early — WebM keeps the partial take, GIF discards it (see *Stopping early*)

A progress bar shows the capture state. When recording completes, the file downloads automatically.

## GIF — animated loop

Animated GIFs are great for messaging apps, Twitter/X, Discord, Slack. Limitations:

| Setting | Range | Notes |
|---|---|---|
| Width | up to 1920 px | Internal cap (ASPECT: Native falls back to a 1280 × 720 box) |
| FPS | 5–30 | GIFs above 30 look bad and weigh too much; below 5 stutters |
| Duration | up to 60 seconds | Cap to prevent runaway memory use |
| Quality | 1–30, default 10 (lower = better, slower) | Tradeoff against file size and encode time |

Encoding happens in a Web Worker (`gif.js`) so your live visualization isn't blocked. GIF holds every captured frame as uncompressed RGBA until the encoder reaches it, so the recorder prices the whole clip *before* it starts and **refuses to record** when the estimate exceeds **1500 MB**. That is a refusal, not a dismissible warning: you get `⚠ Estimated …MB of frames (limit 1500MB) — reduce duration/size/fps`, no capture and no file.

| Settings | Frame size | Estimated frame memory | Result |
|---|---|---|---|
| 480p × 15 fps × 60 s | 853 × 480 | 1340 MB | records |
| 720p × 15 fps × 30 s | 1280 × 720 | 1508 MB | refused |
| 720p × 30 fps × 60 s | 1280 × 720 | 5273 MB | refused |

So 1500 MB is a ceiling, not a peak the top settings reach. At 60 seconds only 480p fits, and only at 15 fps or below; at 30 fps every size the SIZE selector offers is refused. The ceiling buys short clips instead: 720p × 30 fps × 10 s is 879 MB and records fine. WebM has no such limit — it encodes as it goes.

### Beat-sync mode

A GIF that loops cleanly is much more satisfying than one that snaps. Beat-sync mode auto-starts the recording on the next detected beat and stops after **N beats**, producing a perfect musical loop:

1. Switch duration mode to **beats**
2. Pick how many beats (4, 8, 16 are common)
3. Press **⏺ START RECORDING** — capture starts on the next downbeat
4. Capture auto-stops after the requested beat count

Works best with steady-tempo music. If beat detection drifts mid-capture, the loop boundary may be off by a frame or two.

### Typical GIF settings

| Use case | Size | FPS | Duration | Quality |
|---|---|---|---|---|
| Twitter / X embed | 480p | 15 | 4–8 beats | Balanced (10) |
| Discord preview | 480p | 15 | 8 beats | Balanced (10) |
| Portfolio thumbnail | 720p | 20 | 4 beats | Best (5) |
| Big banner | 1080p | 24 | 8 beats | Best (5) |

## WebM — high-quality video

WebM is much smaller per second than GIF and supports higher resolution. Best for:

- YouTube uploads
- Editing software import (DaVinci, Premiere, etc.)
- Higher visual fidelity than GIF allows
- Takes up to the 60-second ceiling — the longest option the SECONDS selector offers

The recorder uses the browser's native `MediaRecorder` with VP9 if supported (Chrome, Edge, Firefox 113+), falling back to VP8.

### Settings

| Setting | Default | Limit |
|---|---|---|
| Resolution | from the ASPECT + SIZE selectors (Native = the canvas) | capped at 1920 px per axis — a larger canvas is scaled down, aspect preserved |
| FPS | 60 | fixed — the panel always records WebM at 60 fps |
| Duration | 10 s default | picked from the SECONDS selector — tops out at **60 seconds per file** |
| Codec | VP9 if supported, else VP8 | depends on browser |

Memory usage is much lower than GIF — ~50–100 MB for a 60-second 1080p capture. The composite pipeline (WebGL → 2D overlay with watermark → MediaStream) adds negligible CPU overhead.

If you need a longer take, record back-to-back 60-second files and concatenate them in any video editor (`ffmpeg -f concat -i list.txt -c copy out.webm` is the one-liner).

### Browser support

| Browser | WebM/VP9 | WebM/VP8 |
|---|---|---|
| Chrome / Edge | ✓ | ✓ |
| Firefox 113+ | ✓ | ✓ |
| Firefox older | ✗ | ✓ |
| Safari | ✗ | partial |

Safari users: WebM is unreliable. Stick to GIF, or use OBS with the Virtual Camera output instead.

## Watermark

Both recorders draw a "VIMATHIC" text watermark in the bottom-right corner of the output. It's an attribution marker, not a copyright claim — your creative output belongs to you (with the usual caveats around the audio you record over). The watermark cannot be disabled in the UI; see `LICENSE.txt` for the legal context.

## Choosing GIF vs WebM

| Question | Answer |
|---|---|
| Going to social media? | GIF (auto-plays everywhere) |
| Going to YouTube? | WebM |
| Need a perfect loop? | GIF with beat-sync |
| Need 1080p quality? | WebM |
| Need to edit afterward? | WebM (convert to MP4 in any editor) |
| Have a Mac and only Safari? | GIF |
| Background tab worried? | WebM (lighter on memory) |

## Tips

- **GIF at high settings is heavy.** Start at 480p × 15 fps — the SIZE and FPS defaults — and increase only if needed. Doubling resolution quadruples encode time.
- **Beat-sync is the killer feature.** A 4-beat or 8-beat loop at the right tempo creates content that just keeps playing without seams.
- **WebM always records at 60fps** — buttery smooth motion out of the box. The FPS selector applies to GIF only.
- **Don't record with developer tools open.** DevTools adds noticeable overhead, especially with the Performance tab active.
- **Don't multi-task during long captures.** The browser tab needs to stay in the foreground for `MediaRecorder` to behave reliably.

## What's NOT recorded

The audio is **not embedded** in the recording. GIFs can't have audio at all; WebM technically can, but adding it would imply licensing claims about the source. Combine your VIMATHIC capture with audio in any video editor (DaVinci Resolve, free; Premiere; Final Cut; even `ffmpeg`).

The recorder captures the **canvas only** — not the panel UI, not the modals, not the FPS overlay. Hide what you don't want by clicking the **FULLSCREEN** button before starting recording.

## Stopping early

The **⏹ STOP** button cancels a recording mid-flight. For GIF, this aborts the worker and discards partial frames — no file is saved. For WebM, the partial recording downloads with whatever frames were captured up to that point.

## Performance impact

The GIF and WebM recorders add load during capture:

- **GIF recorder:** uses a separate Web Worker (`gif.js`) for LZW encoding. At 720p × 15fps, capture runs at full speed while encoding happens in the background. Queued frames are the cost: the recorder refuses to start any clip it prices above 1500 MB of uncompressed RGBA (see the table above), and a capture that outlasts its estimate — beat-sync at a slower tempo than predicted — is stopped early at the same ceiling, with a shorter file and a reason.
- **WebM recorder:** uses the browser's native `MediaRecorder` API. Much lower memory (~50–100 MB for a 60-second 1080p capture) but requires Chrome/Edge for VP9 codec support. The composite pipeline (WebGL → 2D overlay with watermark → MediaStream) adds negligible CPU overhead.

Both recorders are designed not to affect the live visual output — capture runs on its own frame schedule independent of the render loop.
