---
title: Roadmap
order: 4
description: What VIMATHIC is today and where it's going — the plan for VIMATHIC PRO, the custom AI engine, and mobile apps. Funded by the community.
---

# Roadmap

<picture>
  <source srcset="/support-hero.webp" type="image/webp">
  <img src="/support-hero.png" alt="Two hackers at night — one coding on a rooftop laptop, another at a desk with a Mandelbrot fractal on screen — dropping a coin into a shared hat between them" style="max-width:100%;height:auto;display:block;margin:1.5em auto;border-radius:6px;">
</picture>

VIMATHIC 1.0 is here — free, open-source, and complete on its own.

This page is about what comes after. VIMATHIC PRO, the custom AI engine,
and mobile apps are real goals — but they're bigger than what one person
can build alone. The pace of what's next depends on how much the
community wants it to happen.

<pre style="line-height:1.4;font-size:0.85em;overflow-x:auto;">
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   NOW            VIMATHIC 1.0                                   │
│                  ════════════════════                           │
│                  Web · WebGL · Open-source · Free forever       │
│                                                                 │
│                  The community edition. 192 mathematical        │
│                  formulas, 38 GPU shaders, 36 colour schemes,   │
│                  20 base shapes, full documentation, MIDI,      │
│                  recording, second-screen output.               │
│                                                                 │
│                  Single-file deployment. Works offline.         │
│                  This is the foundation — and it stays open.    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   NEXT           VIMATHIC PRO                                   │
│                  ════════════════════                           │
│                  Web + Desktop · Commercial                     │
│                                                                 │
│                  · Multi-scene engine with A/B crossfader       │
│                  · Real NDI output for Resolume / OBS / vMix    │
│                  · Real Spout output (Windows)                  │
│                  · Project files (.vmth) — scenes, MIDI maps,   │
│                    custom shaders, all in one file              │
│                  · Native desktop apps:                         │
│                    Windows · macOS · Linux                      │
│                                                                 │
│                  The professional VJ tool.                      │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   THE AI PATH    VIMATHIC PRO AI                                │
│                  ════════════════════                           │
│                  PRO + custom AI engine · Commercial            │
│                                                                 │
│                  Custom AI engine trained on VIMATHIC's own     │
│                  mathematical library — runs locally, no API    │
│                  fees, no internet required.                    │
│                                                                 │
│                  · Scene Recommender                            │
│                    "Suggest something for this track"           │
│                    → instant formula + palette + setup          │
│                                                                 │
│                  · Shader Generator                             │
│                    "Red waves with beat reaction"               │
│                    → valid GLSL, ready to apply                 │
│                                                                 │
│                  · Track Analyzer                               │
│                    Upload a mix → auto-built clip player        │
│                    with scenes mapped to each section           │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   LATER          VIMATHIC PRO Mobile                            │
│                  ════════════════════                           │
│                  iOS + Android · Commercial                     │
│                                                                 │
│                  Native mobile build. Simplified for touch.     │
│                  Connect to desktop sessions over local         │
│                  network. Discovery and casual use on the go.   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
</pre>

## What's already been built

VIMATHIC 1.0 is not a teaser — it's a complete piece of software,
given freely.

<pre style="line-height:1.4;font-size:0.85em;overflow-x:auto;">
192   mathematical formulas across 12 domains
 38   GPU shaders
 36   colour schemes
 20   base shapes × 3 deformation modes
126   validation tests against scipy, mpmath, NIST DLMF
 14   documentation pages
  ~   six months of development
  ∞   yours to use, study, fork, share
</pre>

All open-source under [BUSL-1.1](./license.md), converting to GPL v3
on **2031-05-09**. Educational and non-profit use is permitted under
Apache 2.0 terms immediately.

## What community support makes possible

Everything past 1.0 — PRO, PRO AI, mobile — costs real time and money
to build. The custom AI engine in particular requires:

- GPU training time for the recommender and shader models
- A curated dataset of audio → visual mappings (built from scratch)
- ML engineering work that goes beyond what one person can give freely
- Code signing, Apple Developer + Google Play accounts
- Ongoing maintenance of the free 1.0 edition

If you've found value in VIMATHIC and want to see the next chapter
happen, your support is what makes it real.

## How to support

VIMATHIC has no ads, no telemetry, no premium tier in the free edition,
and no accounts to upsell. The free 1.0 stays that way. The next chapter
runs on community support.

### ☕ Ko-fi

[**ko-fi.com/smelentyev**](https://ko-fi.com/smelentyev) — one-off
contributions or small monthly amounts. No account required.

### Cryptocurrency

Direct addresses. Sending funds to any of them goes straight to the
project author.

**Bitcoin (BTC)**

```
3EqX9aPn7S6CVfX1CVJ9Gj2aoGVwWMRhAz
```

**Dogecoin (DOGE)**

```
D983mnnVX1QrsHZNmfhNKP9gRkuQba5C5a
```

**The Open Network (TON)**

```
UQBqeB9KzBpat4dNbkvnihuTLmX_GgUi7QzlmqE8_I23g0OG
```

### Other ways that aren't money

- **Star the repository** — [github.com/vimathic/vimathic](https://github.com/vimathic/vimathic). Visibility helps the project find its audience.
- **Share with someone** — a VJ friend, a teacher, a fractal-curious music producer, a maths student. Word-of-mouth is how this kind of project finds people who care.
- **Report bugs** — open an issue on GitHub. Reproducers are gold.
- **Contribute a MIDI mapping** — see [CONTRIBUTING.md](https://github.com/vimathic/vimathic/blob/main/CONTRIBUTING.md).
- **Fix a typo or clarify documentation** — small pull requests are always welcome.

## A note on commitments

VIMATHIC PRO, PRO AI, and mobile builds are real goals — not promises.
Software roadmaps are guidance, not contracts. If something can't be
built as planned, you'll hear about it in transparent updates. No fake
shipping dates, no quiet abandonment.

Your support is a contribution to development, not a pre-order with
guaranteed delivery. The free 1.0 will remain free and open-source
**forever** regardless of what happens with the commercial editions.
The foundation stays open.

---

*VIMATHIC is built by one person with AI assistance, in close
collaboration with [Claude](https://claude.ai) (Anthropic). The roadmap
moves at the pace one person can sustain — community support is what
lets it move faster than that.*
