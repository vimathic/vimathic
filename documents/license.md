---
title: License
order: 12
group: about
description: How VIMATHIC is licensed — plain English version. The full legal text is in LICENSE.txt on GitHub.
---

# License — Plain English

This page explains the VIMATHIC license in plain language. The full legal text is in [LICENSE.txt on GitHub](https://github.com/vimathic/vimathic/blob/main/LICENSE.txt); that's the legally binding document.

## What you can do — right now

**Personal & artistic use.** Open VIMATHIC, drop in your music, watch the visualisations, record GIFs and WebMs of what you make. The output is yours — your creative work, your audio, your call.

**Read, study, and modify the code.** All source is on GitHub. Read it, learn from it, fork it for your own learning or art.

**Schools, universities, and non-profit educational organisations** can use VIMATHIC immediately under either the **Apache 2.0** or **GPL v3** terms — recipient's choice, no waiting for the Change Date. Use it in teaching, classroom demonstrations, research, exhibitions — go ahead. After 2031-05-09, all use falls under GPL v3 (see below).

## What requires permission — for now

The code is under **Business Source License 1.1** ("BUSL-1.1"). The short version of what *isn't* allowed without separate permission:

- Building a **competing commercial product** based on VIMATHIC or its code
- Selling **hosted VIMATHIC** as a paid service to others
- Re-publishing VIMATHIC under a different name as your own work

If you want to do any of these — or anything else that feels like it might cross the line — please email **vimathic.info@proton.me** and we'll talk. Reasonable use cases are usually OK; we just want to know.

## What happens in 2031

On **2031-05-09**, the entire codebase automatically converts to **GPL v3** — a strong open-source copyleft license. From that date, anyone can use, modify, and distribute the code, including commercially. The condition: any derivative work that you distribute must also be open-source under GPL v3.

In practice this means:

- **You can fork VIMATHIC, modify it, and distribute your version** — including charging for the distribution — but you must ship the source code of your modifications with it, under GPL v3. In practice this means anyone who receives your version can freely redistribute it, so selling closed-shop is not really an option; GPL v3 protects the user, not the seller.
- **You can build a commercial product on top of VIMATHIC's code** — but the product must also be GPL v3, with source available to anyone who receives a copy.
- **You cannot take VIMATHIC's code into a closed-source commercial product** — that's the boundary GPL v3 enforces.
- **Personal, educational, internal, and non-distributed use stays completely free** — same as today.

This is a hard deadline written into the license text. It's not "we'll see how things go" — it's contractually binding. The motivation is twofold: give the project room to establish itself first, then guarantee that VIMATHIC and everything built on top of it stays open-source forever. No company can ever take this code and lock it behind a paywall.

## The bundled audio track

VIMATHIC ships with an intro track — *S. Melentyev — Vimathic.mp3* — that plays on first load. The track is licensed **separately** from the code:

- **Personal, non-commercial playback inside VIMATHIC** — fine, no permission needed
- **Private rehearsals, learning, personal demos** — fine
- **Public performance, monetised streams, sampling, commercial use** — requires written permission from the author

The track's licensing terms are independent of the BUSL-1.1 schedule. The GPL v3 conversion in 2031 covers the code, not the track. See [LICENSE.txt](https://github.com/vimathic/vimathic/blob/main/LICENSE.txt) for the full bundled-media clause.

## Forks & Contributions

We love forks. If you build a cool feature, modification, or extension in your fork, we might merge it back into the main VIMATHIC branch (with credit to you).

When you open a pull request, you grant two things:

1. **A license to the project on the same terms as VIMATHIC itself** — BUSL-1.1 now, GPL v3 after the Change Date. This is the standard "your contribution joins the project" grant.
2. **A separate, broader license to the maintainer** — to use your contribution under any license terms, including in proprietary commercial products derived from VIMATHIC (for example, planned commercial mobile and desktop apps).

You retain copyright on your contribution. The grant above is non-exclusive — you can still use your own code anywhere else, under any terms you like.

This dual-grant model is how the project sustains itself: VIMATHIC stays free and open-source, while commercial derivatives may incorporate community contributions. It's disclosed upfront so there are no surprises later.

No Contributor License Agreement form, no paperwork — opening the PR is your acknowledgment of these terms. Full text in [CONTRIBUTING.md on GitHub](https://github.com/vimathic/vimathic/blob/main/CONTRIBUTING.md).

## Third-party libraries

VIMATHIC is built on top of these open-source projects, each under its own license:

- [Three.js](https://threejs.org) — MIT License, © mrdoob and contributors
- [gif.js](https://github.com/jnordberg/gif.js) — MIT License, © Johan Nordberg
- [micromark](https://github.com/micromark/micromark) — MIT License, © Titus Wormer
- [Vite](https://vitejs.dev) — MIT License, © Evan You and Vite contributors
- [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) — MIT License, © Richard Tallent

Each is used under its respective MIT license. The author of VIMATHIC makes no copyright claim to these libraries.

## When in doubt

If you're not sure whether your intended use is allowed — email **vimathic.info@proton.me** and ask.

Two notes on what an email exchange does and doesn't do:

- **An email asking permission does not by itself grant permission.** Silence is not consent. Only explicit written confirmation from the maintainer constitutes a license grant beyond what BUSL-1.1 already permits.
- **Replies aren't guaranteed.** The project is maintained in spare time, and inbox volume varies. If you don't hear back within a reasonable window and your intended use is commercial or large-scale, treat that as "permission not granted" rather than "permission implied".

---

*Full legal text: [LICENSE.txt on GitHub](https://github.com/vimathic/vimathic/blob/main/LICENSE.txt)*
