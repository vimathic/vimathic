---
name: Bug report
about: Report something that's broken or behaves unexpectedly
title: "[Bug] "
labels: bug
assignees: ''
---

## What happened?

<!-- A clear description of what went wrong. One or two sentences is fine. -->


## What did you expect to happen?

<!-- What should VIMATHIC have done instead? -->


## Steps to reproduce

<!-- Number the steps so a stranger could follow them. -->

1.
2.
3.

## Environment

<!-- Required. Bugs that don't include this almost always come back to us asking. -->

- **Browser & version**: <!-- e.g. Chrome 132 on Windows 11 -->
- **VIMATHIC version**: <!-- shown in About modal, or commit hash if running from source -->
- **How loaded**: <!-- vimathic.com / local dist/index.html / `npm run dev` -->
- **Hardware (if relevant)**: <!-- MIDI controller model, audio interface, GPU, etc. -->

## Console output

<!-- Press F12, switch to Console tab, paste any red errors here. -->

```
(paste errors here)
```

## Screenshot or screen recording

<!-- If it's a visual bug, a screenshot speaks louder than words. -->
<!-- Drag images directly into this box; GitHub will upload them. -->


## Reproducibility

<!-- Tick one. -->

- [ ] Happens every time I try the steps above
- [ ] Happens sometimes / unpredictably
- [ ] Only happened once and I can't reproduce it now

## Severity (your view)

<!-- Tick one. -->

- [ ] Crashes / freezes / blank screen — VIMATHIC unusable
- [ ] Major feature broken (recording, MIDI, audio, etc.)
- [ ] Visual glitch / cosmetic issue
- [ ] Minor / nice-to-fix

## Math accuracy bug? (skip if not applicable)

<!-- If you're reporting a formula returning wrong values, fill in these. -->
<!-- Otherwise delete this section. -->

- **Formula**: <!-- e.g. gamma_fn, bessel0 -->
- **Input(s)**: <!-- e.g. x = 0.3 -->
- **Observed output**: <!-- what VIMATHIC computed -->
- **Expected output**: <!-- with source: mpmath, scipy.special, NIST DLMF, Wolfram Alpha -->
- **Reference**:

```
e.g. Python:
>>> from math import gamma
>>> gamma(0.3)
2.991568987687591
```

## Anything else?

<!-- Workarounds, hunches about the cause, related issues, etc. -->
