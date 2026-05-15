---
title: Safety & Privacy
order: 10
group: about
description: How VIMATHIC handles your data and a few health notes worth knowing before you start.
---

# Safety & Privacy

VIMATHIC runs entirely in your browser. We don't store your data, we don't track you across sites, we don't serve ads, and there are no accounts to make.

## Privacy

### Hosting & analytics

The site at vimathic.com is hosted on **Cloudflare Pages**. Cloudflare collects anonymised visit counts — page views, popular pages, country-level breakdown. We look at those numbers to know how many people use the project and which pages they read.

Cloudflare **does not give us your IP address**, and we **don't link any of that data to your actions in the app**. The visualizer itself makes no network requests at runtime — once the page has loaded, nothing leaves your browser.

To avoid even that anonymous level of analytics, download the offline build from [GitHub](https://github.com/vimathic/vimathic) and open `index.html` locally. It works without an internet connection and makes zero external requests.

### What VIMATHIC stores on your device

The app uses your browser's `localStorage` to remember:

- Saved presets you've named
- MIDI controller mappings
- Whether you've cleared the bundled intro track
- Which tab of this documentation you read last
- A flag that the first-launch tour has been seen

Nothing here is sent anywhere — it's all local. To wipe it, open your browser's DevTools (F12), go to **Application → Local Storage**, find the keys starting with `vimathic_`, and delete them.

## Health & Safety

VIMATHIC produces rapid visual changes synchronised to music: bright flashes, strobing patterns, fast-moving fractal geometry, and intense post-processing effects.

**Do not use VIMATHIC if you have:**

- Epilepsy or photosensitive epilepsy
- Migraines triggered by light or motion
- A tendency to vertigo, dizziness, or motion sickness from screens

If you experience blurred vision, eye twitching, disorientation, or a sudden severe headache while using VIMATHIC — stop immediately and consult a doctor.

**VIMATHIC is not a medical device and makes no therapeutic claims.** The research referenced in [Science](./science.md) describes related — not identical — visual stimuli in laboratory settings.

### Hardware load

VIMATHIC uses your GPU heavily. Extended use may cause your device to run warm. Ensure adequate ventilation, especially on laptops with passive cooling.

**Mobile devices.** VIMATHIC is not optimised for phones. It will run on modern Android and iOS browsers, but sustained sessions will heat the device noticeably — even on high-end hardware. If your phone gets uncomfortably warm, switch to a desktop or laptop. Treat the mobile build as a preview.

There are no hidden processes, no cryptominers, no analytics beacons, and no network requests during use — just mathematics rendering to your music.

## Importing Presets

Presets can contain custom JavaScript for the Camera Programmer. **Only import presets from trusted sources.** VIMATHIC will show you the code and ask before running anything imported. Even after you accept, the code is loaded into the editor — you still have to click APPLY explicitly to run it.

## Your Recordings

The GIFs and WebM files you export are yours. The small VIMATHIC watermark in the corner is an attribution marker, not a copyright claim on your creative output.

You are responsible for having the rights to any audio in your recordings. The visualizer is your tool; what you play through it and what you publish is your call.

## AI Assistance

VIMATHIC was created by a human (S. Melentyev) in collaboration with **Claude** (Anthropic). Code, documentation, and mathematical claims were produced with AI assistance and have not been independently verified by domain experts.

We mention this up-front because honesty matters more than the optics of it. For the full technical details on how accuracy was verified, see [Mathematical Accuracy](https://github.com/vimathic/vimathic/blob/main/MATHEMATICAL_ACCURACY.md) on GitHub.

## Dependencies

VIMATHIC stands on the shoulders of these open-source projects — with gratitude to their authors:

- [Three.js](https://threejs.org) — MIT License, © mrdoob and contributors
- [gif.js](https://github.com/jnordberg/gif.js) — MIT License, © Johan Nordberg
- [micromark](https://github.com/micromark/micromark) — MIT License, © Titus Wormer
- [Vite](https://vitejs.dev) — MIT License, © Evan You and Vite contributors
- [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) — MIT License, © Richard Tallent

All third-party code is used under its respective open-source license. The author makes no claim to these libraries.

## Found a Vulnerability?

Email **vimathic.reports@proton.me**. Full security policy is on [GitHub → SECURITY.md](https://github.com/vimathic/vimathic/blob/main/SECURITY.md).

---

*Verify what matters. Use at your own risk.*
