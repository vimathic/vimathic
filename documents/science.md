---
title: The Science
order: 11
group: about
description: What published research says about fractal patterns, audiovisual stimulation, and what VIMATHIC actually does.
---

# Why VIMATHIC Works — The Research

*This page summarises published, peer-reviewed research relevant to audio-visual mathematical stimulation. VIMATHIC is not a medical device. Effects vary by person, music, and context.*

> ⚠️ Every reference here has a working DOI and was verified against the journal of record. If you spot any inaccuracy, please [open an issue](https://github.com/vimathic/vimathic/issues). For safety information, see [Safety & Privacy](./safety.md).

---

## The Short Version

Two independent lines of published research are relevant to what VIMATHIC does:

1. Fractal patterns produce measurable changes in EEG activity, including elevated alpha-band power in the frontal cortex.
2. Audiovisual stimulation, in a large randomised controlled trial, produced anxiety-reduction effects comparable to short breath-focused meditation.

Neither study used VIMATHIC, neither makes a clinical claim about it, and the "compounding" of these effects is a hypothesis on this page, not a finding in the literature. With those caveats in mind:

---

## 1. Fractals and the Brain

**Hägerhäll, Laike, Taylor, Küller, Küller & Martin (2008)** — *Investigations of human EEG response to viewing fractal patterns.* [Perception 37(10): 1488–1494](https://doi.org/10.1068/p5918) · [PubMed: 19065853](https://pubmed.ncbi.nlm.nih.gov/19065853/)

The authors recorded EEG while participants viewed fractal silhouettes of varying fractal dimension. Patterns with **fractal dimension D ≈ 1.3** elicited the most pronounced EEG response: the **highest alpha activity in the frontal lobes**, but also the highest beta activity in the parietal area — the latter pointing to active spatial processing alongside the relaxation signature.

The authors interpret this as a complex interplay between attention and restorative response, not as a pure "relaxation effect". The study used relatively simple silhouette images; effects may differ for animated or three-dimensional fractals. Sample sizes in this line of research are small (typically n=20–30).

> VIMATHIC renders Mandelbrot, Julia, Burning Ship, Lyapunov, Lorenz, Hénon, and other fractal systems as canonical mathematical implementations. Whether the fractal dimension of any particular VIMATHIC scene falls in the D≈1.3 range measured by Hägerhäll et al. has not been characterised — the formulas produce a wide range of complexities depending on parameters and audio modulation.

---

## 2. Audiovisual Stimulation and Mood

**Johnson, Simonian & Reggente (2024)** — *Lightening the mind with audiovisual stimulation as an accessible alternative to breath-focused meditation for mood and cognitive enhancement.* [Scientific Reports 14: 25553](https://doi.org/10.1038/s41598-024-75943-8)

A randomised, double-blind, controlled study (**n = 262**) compared:

- audiovisual stimulation **with** binaural beats (ELA1)
- audiovisual stimulation **without** binaural beats (ELA2)
- closed-eye breath-focused meditation

…across three exposure durations (5.5, 11, 22 min). Mood was measured pre/post with STAI, HADS, POMS, and a global anxiety VAS, plus two mood-sensitive cognitive tasks (Stroop, Local-Global).

Findings relevant here:

- **All three conditions** produced statistically significant reductions across most anxiety, tension, fatigue, and confusion measures, with moderate-to-large effect sizes.
- Differences **between** the three conditions were not statistically significant — AVS performed comparably to short meditation, not better than it.
- A **brief 5.5-minute AVS** session produced anxiety improvements numerically similar to **11–22 minutes of meditation**, suggesting AVS may be a shorter-onset alternative — though this comparison was not significant in formal contrast.
- The AVS device used (an LED array with synchronised audio pulsing in alpha/theta range) is a different stimulus from VIMATHIC.

> VIMATHIC is an audiovisual stimulus driven by music the user chooses, with mathematical animation synchronised to bass / mid / treble bands and detected beats. It is not the ELA device used in this study, and no claim is made that VIMATHIC reproduces the study's effects.

---

## 3. The VIMATHIC Difference — Live Mathematical Computation

Neither of the studies above tested anything quite like what VIMATHIC does: a live mathematical computation reacting to music chosen by the user, in real time, with 192 distinct formula systems across 12 mathematical domains.

- **Real mathematics, not pre-rendered animation.** The height of every vertex, the colour of every fragment, and the acceleration of every camera movement is computed from audio analysis and mathematical functions at frame rate — nothing is pre-baked. The GPU shaders evaluate canonical mathematical expressions (Bessel functions, modular forms, reaction-diffusion PDEs) per frame.
- **User-chosen music.** The AVS devices in Johnson et al. (2024) used pre-programmed alpha/theta pulses. VIMATHIC processes whatever audio the user provides — a favourite album, a live mic feed, a DJ set — and maps the actual spectral content (bass energy, treble sharpness, beat timing) onto the visual output. The emotional connection to one's own music may amplify or alter the effects measured in laboratory settings — but this has not been studied.
- **Mathematical variety as a variable.** Hägerhäll et al. (2008) showed that different fractal dimensions produce different EEG signatures. VIMATHIC provides 192 formula systems with widely varying mathematical properties, plus configurable deformation modes (Surface / Volume / Collapse) and post-processing effects (bloom, god rays, motion blur). The interaction between mathematical structure and neurological response across this parameter space is entirely unexplored.

---

## What This Means for VIMATHIC

The honest summary:

- **Fractal geometry** has been shown to produce specific EEG signatures (Hägerhäll et al., 2008) when viewed as static images at certain dimensions.
- **Audiovisual stimulation more generally** has, in at least one well-controlled study, produced anxiety-reduction effects comparable to meditation (Johnson et al., 2024).
- VIMATHIC sits *adjacent* to both literatures — it generates fractal animation synchronised to audio — but **no study has measured VIMATHIC specifically**, and the two cited studies use stimuli that differ from VIMATHIC in important ways (static vs. animated; LED-based flicker vs. music-driven mathematical surfaces).

---

## Recording & Content Creation

VIMATHIC can export visualisations as GIF or WebM files via its built-in recording suite. These recordings are derivative works of the mathematical visualisation generated by the software in response to user-provided audio.

The research cited above applies to real-time viewing of visual stimuli, not to pre-recorded playback. Effects of viewing recorded mathematical animations have not been studied. The beat-synchronised GIF mode (which produces music-aligned perfect loops) creates content that is temporally locked to specific audio — whether the physiological response to such loops differs from the response to continuous live generation is unknown.

---

## The Honest Part

Limitations worth knowing before reading too much into any of this:

- Sample sizes in fractal-EEG research are small (Hägerhäll et al.: small, unblinded; this is a feature of the field, not a defect of the paper).
- The Johnson et al. (2024) study is rigorous (n=262, double-blind, controlled) but tested **specific** AVS hardware, not music-driven visualisers.
- "Mood improvement" and "anxiety reduction" in these studies are measured by self-report scales (STAI, HADS, POMS, GA-VAS) and by cognitive task performance — not by direct neural readout.
- Individual variation is large. Music preference, fractal dimension, attentional state, and prior meditation experience all moderate effects.
- No study has examined the specific combination of **user-chosen music + real-time mathematical animation + configurable post-processing** — which is precisely what VIMATHIC provides.

**VIMATHIC is not a medical device. It makes no therapeutic claims.** What it does: renders real mathematics that reacts to your music. What happens after that depends on you, the music, and the moment.

For safety information — including the photosensitivity warning that all users should read before using VIMATHIC — see [Safety & Privacy](./safety.md).

---

## References

Hägerhäll, C. M., Laike, T., Taylor, R. P., Küller, M., Küller, R., & Martin, T. P. (2008). Investigations of human EEG response to viewing fractal patterns. *Perception*, 37(10), 1488–1494. https://doi.org/10.1068/p5918

Johnson, M. A., Simonian, N., & Reggente, N. (2024). Lightening the mind with audiovisual stimulation as an accessible alternative to breath-focused meditation for mood and cognitive enhancement. *Scientific Reports*, 14, 25553. https://doi.org/10.1038/s41598-024-75943-8

---

*For the mathematical details behind VIMATHIC's formula implementations, see the [accuracy methodology on GitHub](https://github.com/vimathic/vimathic/blob/main/MATHEMATICAL_ACCURACY.md).*
