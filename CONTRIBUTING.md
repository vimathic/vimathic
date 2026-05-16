# Contributing to VIMATHIC

Thanks for your interest in contributing. VIMATHIC is a one-person project maintained in spare time, and outside help — bug reports, MIDI mappings, doc fixes, browser-compat patches — meaningfully extends what's possible.

Before opening an issue or PR, please skim this document. It's short.

## Code of Conduct

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md). By participating, you agree to abide by it. Report incidents to **vimathic.reports@proton.me**.

## Before you start: scope freeze (Phase 0–2)

VIMATHIC is at **v1.0-beta** and currently in a stability period. Until roughly Week 10 post-launch, the following are **frozen** and PRs in these areas will be closed without merge:

- New mathematical formulas (192 is the curated count)
- New GPU shaders (38 is intentional)
- New colour schemes (36 covers the design space)
- New base shapes (20 + deformation modes cover geometry)
- New keyboard shortcuts (hotkey surface is full)
- Major architecture refactors
- New external dependencies (currently 3: `three`, `gif.js`, `micromark`)

This is not "we don't want your ideas" — it's "the next 10 weeks are for catching regressions, not adding surface area." If your idea fits one of these categories, **open an issue** with the `phase-3-consideration` label and it'll be reviewed during the next direction-setting cycle.

## What's accepted right now

- **Bug fixes** — anything that's measurably broken
- **Browser compatibility patches** — Firefox / Safari / mobile
- **Performance optimisations on existing code paths**
- **MIDI controller default mappings** — Akai, Launchpad, Novation, etc.
- **Documentation** — typo fixes, clarifications, new examples in existing docs
- **Tests** — additional canonical-reference checks for `math-collections.js`
- **Build / CI improvements** — workflow hardening, lint rules, etc.
- **Better error messages** — bug-fix-adjacent UX improvements

## How to contribute

### Reporting bugs

Open an issue using the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md). The most useful bug reports include browser + OS, what you did, what happened, and what you expected. Console output (F12 → Console) catches ~80% of real issues.

For math accuracy bugs, include a reference value from `mpmath`, `scipy.special`, NIST DLMF, or Wolfram Alpha. The template walks you through this.

### Suggesting features

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md). It includes the scope-freeze checklist so you can self-categorise. If unsure, tick "I'm not sure" — the maintainer will sort it.

### Security vulnerabilities

**Do not open a public issue.** Email **vimathic.reports@proton.me** or use GitHub's private vulnerability reporting. See [SECURITY.md](./SECURITY.md).

### Pull requests

1. **Open an issue first** for anything non-trivial. A two-line "this is what I want to do, OK?" before writing the code saves both of us from a closed PR.
2. **Fork → branch → PR against `main`**. Branch protection requires required CI status checks (`test`, `build`) to pass and squash-merge as the only allowed method.
3. **One concern per PR.** A docs typo fix + a CSS tweak + a bug fix = three PRs.
4. **Run the test suite locally before pushing:**

```bash
   npm test           # math validation (126 tests)
   npm run test:e2e   # Playwright smoke tests
   npm run build      # single-file build check
```

5. **Match the existing code style.** Comments explain *why*, not *what*. Don't reformat unrelated files.
6. **Update docs in the same PR** if you change user-facing behaviour. Source of truth is `documents/*.md`.

### Contributing a MIDI controller mapping

If your controller sends standard CC and you've worked out a useful default mapping, please contribute it.

1. Create `documents/midi-<vendor>-<model>.md` (e.g. `midi-akai-mpk-mini.md`)
2. Include frontmatter:

```yaml
   ---
   title: Akai MPK Mini Mapping
   order: 30
   group: production
   description: Recommended CC mapping for the Akai MPK Mini MIDI controller.
   ---
```

3. List the mapping as a table: CC number → parameter → recommended knob/pad on the controller
4. One paragraph at the top describing why this mapping (e.g. "Knob row 1 lives nearest the master fader, so amplitude goes there")
5. Open PR against `dev`

## Licensing of contributions

VIMATHIC is licensed under [BUSL-1.1](./LICENSE.txt), auto-converting to GPL v3 on **2031-05-09**.

By opening a pull request, you agree to the following:

1. You **retain copyright** on your contribution.

2. You **license the contribution to the project** under the same terms as the project itself (BUSL-1.1, converting to GPL v3 on the change date).

3. You additionally grant the project maintainer **a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license** to use, modify, and distribute your contribution under any license terms, including in proprietary commercial products derived from VIMATHIC (e.g. planned mobile apps, possibly desktop).

This dual license reflects a sustainable open-core model: the open-source VIMATHIC (this repository) is free forever, while commercial derivatives may incorporate contributions. Your code stays free in VIMATHIC 1.0; it may also appear in commercial products built by the maintainer.

No CLA, no paperwork — opening the PR is your acknowledgment of these terms.

If you're contributing on behalf of an employer, please verify that you have the right to do so before opening the PR.

## Development setup

```bash
git clone https://github.com/vimathic/vimathic
cd vimathic
npm install
npm run dev        # http://localhost:3000
```

Required: **Node.js 22+**.

Tests:

```bash
npm test                # math validation, fast
npm run test:e2e        # Playwright in Chromium, slower
npm run build           # single-file build, ~10s
```

Pre-push self-check:

```bash
npm test && npm run test:e2e && npm run build
```

If all three pass locally, CI almost always passes too.

## Project layout

Source code lives in `src/`. Documentation lives in `documents/` (one `.md` per About-modal tab and static docs page). Plugins live in `plugins/`. Tests in `tests/`. Browse the repo tree on GitHub for the full layout.

Key principles:

- **`src/dom.js`** is the single source of truth for DOM lookups. Don't `document.getElementById()` elsewhere — add the id to `dom.js`.
- **`src/params.js`** is the declarative registry for every parameter that has a slider, MIDI mapping, or preset capture path. Adding a new audio-reactive knob is a single-place change.
- **Markdown docs are trusted source.** Raw HTML (e.g. `<picture>`, `<kbd>`) is permitted in `documents/*.md` because the maintainer authors them and PRs are reviewed. Don't add a markdown-upload UI without sanitising.
- **Comments explain *why*, not *what*.** A line of code that's surprising should have a comment above it telling the reader why it has to be that way.

## Recognition

Contributors who land merged PRs are credited in the [CHANGELOG.md](./CHANGELOG.md) entry for the release that contains their work.

## Questions?

Open a [Discussion](https://github.com/vimathic/vimathic/discussions) or email **vimathic.info@proton.me** for anything that doesn't fit a bug or feature template.

Thank you for considering it.