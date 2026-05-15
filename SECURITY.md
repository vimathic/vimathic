## SECURITY.md

# Security Policy — VIMATHIC™ 1.0 (Beta)

## Reporting a Vulnerability

VIMATHIC is a client-side, browser-only application — it has no server, no
authentication, no user data storage outside `localStorage` on the user's own
machine, and makes no network requests at runtime — everything is bundled into
four self-contained files: `index.html`, `math-worker-*.js`,
`second-screen.html`, and `vimathic-intro.mp3`.

That keeps the attack surface small but does not eliminate it. If you find:

- a way for a malicious audio file, MIDI device, or imported `.json` preset to
  execute arbitrary JavaScript in another user's session,
- a vulnerability in how custom GLSL shaders are sandboxed (WebGL shader
  compilation is handled by the browser's GPU driver — shader code cannot
  escape the GPU process, but compilation errors or driver crashes could be
  exploitable),
- a Cross-Site Scripting (XSS) issue in the UI (e.g. through preset names,
  audio file metadata, or shader editor content),
- a way for the Camera Programmer's `new Function()` code execution to access
  privileged browser APIs beyond the sandbox, or
- any other issue that could compromise a user running VIMATHIC locally,

please **report it privately** rather than opening a public issue.

**Email:** *<vimathic.reports@proton.me>*

Or use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (Settings → Security → Report a vulnerability).

We aim to acknowledge reports within 7 days and to publish a fix within 30 days
where feasible. Reporters who follow responsible disclosure will be credited in
the advisory (unless they ask to remain anonymous).

## Known considerations (not vulnerabilities)

The following are design decisions that have security implications but are
considered acceptable trade-offs for a local-only VJ tool:

- **Camera Programmer executes arbitrary JavaScript.** The Camera Programmer
  uses `new Function()` to evaluate user-written JS code for camera movement.
  This code runs in the same origin as the application and has full access to
  `localStorage`, `fetch()`, and the DOM. Imported presets containing camera
  scripts are sanitized before loading — the `active` flag is forced to
  `false` so the script never auto-executes. Users are shown a preview modal
  and must explicitly approve before the code is retained. Treat imported
  presets from untrusted sources with the same caution as any executable code.
- **GLSL shader editor compiles user code directly on the GPU.** Malformed
  shaders can cause GPU driver crashes or hangs. This is a browser/GPU driver
  concern, not a VIMATHIC vulnerability. The shader editor provides error
  feedback via Three.js `compileAsync()`.
- **Imported `.json` state files can override any application parameter.**
  State import is designed as a full system restore mechanism — it
  intentionally writes to every control. Malicious state files could set
  extreme values (e.g. amplitude = 10¹²) but cannot execute arbitrary code
  unless they contain a Camera Programmer script (see above).
- **Flashing visual content is not a security issue but is a user-safety one.**
  VIMATHIC produces rapid visual changes synchronised to music — bright flashes
  on detected beats, high-contrast strobing, fast fractal motion. This is
  documented in [DISCLAIMER.md](./DISCLAIMER.md). Reports about scenes that
  trigger seizures or migraine should be sent through the channels above so
  the photosensitivity warning can be expanded where needed; we do not treat
  these as vulnerabilities, but we take them seriously.

## Out of scope

- Vulnerabilities in third-party dependencies (Three.js, gif.js, Vite) — please
  report those upstream to the respective maintainers.
- Issues that require physical access to the user's machine.
- Excessive GPU temperature from extended use — see [DISCLAIMER.md](./DISCLAIMER.md).
- Accuracy of mathematical formulas or scientific claims — see
  [MATHEMATICAL_ACCURACY.md](./MATHEMATICAL_ACCURACY.md) and
  [SCIENCE.md](./SCIENCE.md).
- Denial of service via resource exhaustion (infinite loops in shader code,
  excessive memory allocation via extreme recorder settings) — the UI includes
  warnings and caps, but a determined user can bypass them via the console.
  This is expected for a local creative tool.

## No bug bounty programme

VIMATHIC has no formal bug bounty programme. There is no monetary reward
for security reports, but credit in the advisory will be given (unless the
reporter asks to remain anonymous).

## Dependency security

VIMATHIC has three runtime dependencies (Three.js, gif.js, and micromark, plus
their transitive dependencies bundled by Vite) plus build-time dependencies
(Vite, vite-plugin-singlefile, Playwright for testing). We do not run
automated dependency scanning, but all dependencies are pinned to specific
versions in `package-lock.json`. To check for known vulnerabilities in
dependencies:

```bash
npm audit
```

Run this before deploying in a security-sensitive context.

---

*This document was last reviewed on 2026-05-10. If you find a security issue,
please report it privately.*
