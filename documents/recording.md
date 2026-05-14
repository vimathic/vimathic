---
title: Recording
order: 6
group: production
description: Capture VIMATHIC as animated GIF or WebM video — beat-synced loops, configurable resolution, automatic watermark.
---

# Recording & Export

VIMATHIC has two built-in recorders: **GIF** for sharable loops and **WebM** for higher-quality video. Both capture the canvas directly — what you see is what gets recorded. Both add a small "VIMATHIC" watermark to the corner.

## Opening the recorder

Click **OUTPUT** in the control panel. The output modal includes a **RECORDING** section near the bottom. From there:

- Choose format — **GIF** or **WebM**
- Set resolution, FPS, quality
- Choose duration mode — **seconds** or **beats**
- Click **● REC** to start, **■ STOP** to finish early

A progress bar shows the capture state. When recording completes, the file downloads automatically.

## GIF — animated loop

Animated GIFs are great for messaging apps, Twitter/X, Discord, Slack. Limitations:

| Setting | Range | Notes |
|---|---|---|
| Width | up to 1280 px | Internal cap |
| FPS | 5–30 | GIFs above 30 look bad and weigh too much; below 5 stutters |
| Duration | up to 60 seconds | Cap to prevent runaway memory use |
| Quality | 1–30, default 10 (lower = better, slower) | Tradeoff against file size and encode time |

Encoding happens in a Web Worker (`gif.js`) so your live visualization isn't blocked. Peak memory at maximum settings (720p × 30fps × 60s) can reach **~1.5 GB** — the UI warns if estimated usage exceeds that and suggests reducing parameters.

### Beat-sync mode

A GIF that loops cleanly is much more satisfying than one that snaps. Beat-sync mode auto-starts the recording on the next detected beat and stops after **N beats**, producing a perfect musical loop:

1. Switch duration mode to **beats**
2. Pick how many beats (4, 8, 16 are common)
3. Press **● REC** — capture starts on the next downbeat
4. Capture auto-stops after the requested beat count

Works best with steady-tempo music. If beat detection drifts mid-capture, the loop boundary may be off by a frame or two.

### Typical GIF settings

| Use case | Width | FPS | Duration | Quality |
|---|---|---|---|---|
| Twitter / X embed | 512 | 15 | 4–8 beats | 10 |
| Discord preview | 480 | 15 | 8 beats | 10 |
| Portfolio thumbnail | 720 | 20 | 4 beats | 5 |
| Big banner | 1280 | 30 | 16 beats | 3 |

## WebM — high-quality video

WebM is much smaller per second than GIF and supports higher resolution. Best for:

- YouTube uploads
- Editing software import (DaVinci, Premiere, etc.)
- Higher visual fidelity than GIF allows
- Multi-minute takes up to the 5-minute per-file cap

The recorder uses the browser's native `MediaRecorder` with VP9 if supported (Chrome, Edge, Firefox 113+), falling back to VP8.

### Settings

| Setting | Default | Limit |
|---|---|---|
| Resolution | matches canvas | no enforced cap — render the canvas at the size you want |
| FPS | 60 | no enforced cap; 60 is the practical sweet spot |
| Duration | 10 s default; you usually stop manually | hard cap at **5 minutes per file** to keep editor imports reasonable |
| Codec | VP9 if supported, else VP8 | depends on browser |

Memory usage is much lower than GIF — ~50–100 MB for a 60-second 1080p capture. The composite pipeline (WebGL → 2D overlay with watermark → MediaStream) adds negligible CPU overhead.

If you need a take longer than 5 minutes, record back-to-back files and concatenate them in any video editor (`ffmpeg -f concat -i list.txt -c copy out.webm` is the one-liner).

### Browser support

| Browser | WebM/VP9 | WebM/VP8 |
|---|---|---|
| Chrome / Edge | ✓ | ✓ |
| Firefox 113+ | ✓ | ✓ |
| Firefox older | ✗ | ✓ |
| Safari | ✗ | partial |

Safari users: WebM is unreliable. Stick to GIF, or use OBS with the Virtual Camera output instead.

## Watermark

Both recorders draw a "VIMATHIC" text watermark in the bottom-left corner of the output. It's an attribution marker, not a copyright claim — your creative output belongs to you (with the usual caveats around the audio you record over). The watermark cannot be disabled in the UI; see `LICENSE.txt` for the legal context.

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

- **GIF at high settings is heavy.** Start at 512×15fps and increase only if needed. Doubling resolution quadruples encode time.
- **Beat-sync is the killer feature.** A 4-beat or 8-beat loop at the right tempo creates content that just keeps playing without seams.
- **WebM with 60fps gives buttery smooth motion** but doubles file size. 30fps is fine for most uses.
- **Don't record with developer tools open.** DevTools adds noticeable overhead, especially with the Performance tab active.
- **Don't multi-task during long captures.** The browser tab needs to stay in the foreground for `MediaRecorder` to behave reliably.

## What's NOT recorded

The audio is **not embedded** in the recording. GIFs can't have audio at all; WebM technically can, but adding it would imply licensing claims about the source. Combine your VIMATHIC capture with audio in any video editor (DaVinci Resolve, free; Premiere; Final Cut; even `ffmpeg`).

The recorder captures the **canvas only** — not the panel UI, not the modals, not the FPS overlay. Hide what you don't want by clicking the **FULLSCREEN** button before starting recording.

## Stopping early

The **■ STOP** button cancels a recording mid-flight. For GIF, this aborts the worker and discards partial frames — no file is saved. For WebM, the partial recording downloads with whatever frames were captured up to that point.
