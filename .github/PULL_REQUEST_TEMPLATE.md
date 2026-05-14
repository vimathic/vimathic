<!--
  Thanks for opening a PR to VIMATHIC. Please fill in the sections below
  so the review goes quickly. Delete sections that don't apply.

  Before submitting:
    • Make sure you've read CONTRIBUTING.md (scope freeze applies during
      Phase 0-2 — some categories of changes are not accepted yet).
    • Open an issue first for anything non-trivial.
    • Run `npm test && npm run test:e2e && npm run build` locally.
    • Target the `dev` branch, not `main`.
-->

## What does this PR do?

<!-- One or two sentences. The "why" matters more than the "what". -->


## Type of change

<!-- Tick all that apply. -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] Documentation update
- [ ] MIDI controller mapping
- [ ] Test coverage (canonical-reference checks, smoke test, etc.)
- [ ] Performance optimisation on existing code
- [ ] Browser-compatibility improvement
- [ ] Build / CI improvement
- [ ] Other (please describe)

## Related issue

<!-- Link the issue this PR addresses. PRs without a linked issue may be -->
<!-- asked to open one first. Use "Closes #123" to auto-close on merge. -->

Closes #

## Is this within the current scope?

<!-- See CONTRIBUTING.md for the Phase 0-2 freeze. Tick one. -->

- [ ] Yes — this is a bug fix, doc, MIDI mapping, test, perf, browser-compat,
      or CI improvement (in scope now)
- [ ] No — this adds a new formula / shader / palette / shape / hotkey or
      is a major refactor (frozen — please convert this PR into an issue
      tagged `phase-3-consideration`)

## How was this tested?

<!-- Tick all that apply and add details where useful. -->

- [ ] `npm test` passes (126 math validation tests)
- [ ] `npm run test:e2e` passes (Playwright smoke tests)
- [ ] `npm run build` succeeds and `dist/` looks correct
- [ ] Manually tested in browser — please specify which browser(s) and OS

Details:


## Documentation

<!-- If this PR changes user-facing behaviour, the docs in documents/*.md -->
<!-- must change too. The About modal and the static docs site both read -->
<!-- from there. -->

- [ ] No user-facing change — docs not affected
- [ ] Updated `documents/<file>.md` in this PR
- [ ] Documentation update belongs in a separate PR (linked above)

## Screenshots / video

<!-- If this is a visual change, drop a before/after screenshot or short clip. -->


## Checklist

- [ ] My code follows the existing style (comments explain *why*, not *what*)
- [ ] I have not reformatted unrelated files
- [ ] I have added comments to any non-obvious code
- [ ] My contribution is licensed under BUSL-1.1 (auto-converts to GPL v3
      on 2031-05-09 along with the rest of the project)
- [ ] I have the right to submit this contribution (e.g. if employed, my
      employer permits open-source contributions)