// playwright.config.js
// Run: npx playwright test
// Run with UI: npx playwright test --ui
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Per-test budget, and on CI it has to be a different number. These tests
  // drive a real WebGL scene; a hosted runner has no GPU, so Chromium falls
  // back to SwiftShader and everything the tests wait on happens several times
  // slower. Ten of fourteen used to die with "Test timeout of 30000ms exceeded"
  // there while all fourteen passed here — each at whatever step happened to be
  // in flight, which read like ten unrelated product bugs and was one number
  // being too small.
  //
  // Per-test, measured on ubuntu-latest against the same commit (local → runner):
  //   Bootstrap  4.5 s →  8.1 s   1.8×      Reset     14.3 s → 52.7 s   3.7×
  //   FPS        8.4 s → 12.3 s   1.5×      Modals    13.7 s → 45.5 s   3.3×
  //   Hotkeys    7.0 s → 21.2 s   3.0×      Presets   14.8 s → 29.3 s   2.0×
  // So the factor is not uniform and reaches 3.7×. The slowest test here needs
  // 27.3 s, i.e. ~101 s there; 150 s leaves a 1.5× margin over that. Do not read
  // the smaller factors as the typical case — the budget has to cover the worst
  // one, and a test killed by its budget reports the step it was on rather than
  // the reason.
  //
  // 31.08.2026: the local half was 30_000 and had gone stale in exactly the way
  // the paragraph above warns about. The clip-camera specs grew an 8 s hold to
  // settle a race, and three of them now sit ON the old line — measured alone on
  // this machine: "still wins" 28.6 s, "keeps the Hold(s) value" 29.9 s, and
  // "hands the camera back" needs 48.9 s because two of its waits are written as
  // 3 × stepMs(8000). The last one could not pass locally at ANY speed, and its
  // report — "AUTO-ROTATE: OFF after 8 polls" — accused the product of a camera
  // bug that a DIAG trace then disproved (`autoRot -> true` fires on cam-b's
  // step, exactly as intended). It was carried as an inherited red across two
  // waves. 90 s restores the margin the CI half has (3× the slowest full-file
  // run) without blunting a genuine hang, and the CI number is untouched.
  timeout: process.env.CI ? 150_000 : 90_000,
  // Same reasoning for assertions, same factor: the 5 s default is measured
  // against a machine rendering at 60 FPS, and every wait budget has to scale
  // with the machine, not just the outer one. Per-assertion timeouts written
  // into the specs are deliberate and unaffected by this.
  expect: { timeout: process.env.CI ? 25_000 : 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry on CI, not two. Retries are there to absorb a flake, and at a
  // 150 s budget a third attempt no longer fits the job's 30 minutes.
  retries: process.env.CI ? 1 : 0,
  // A bound on the damage, so the job cannot be killed by its own budget again:
  // three failures cost 3 × 2 × 150 s = 15 min, which together with the tests
  // that passed before the bail leaves the run inside the job's 30 — and three
  // is already enough signal to act on. A run truncated by the runner tells you
  // nothing; one that stops itself tells you why. A green run is unaffected by
  // all of this: it takes ~11 min there.
  maxFailures: process.env.CI ? 3 : 0,
  // One worker in CI, not two. These tests drive a real WebGL scene and hosted
  // runners have no GPU, so Chromium falls back to SwiftShader; parallel
  // contexts then starve each other and the render loop misses its deadlines.
  // That is what made the FPS assertion time out on a machine where the app
  // was in fact running fine. Serialised the 14 tests take ~3-4 min here and
  // ~8-10 min on a hosted runner, which is what the job's 30-minute budget is
  // sized for; maxFailures above is what keeps a red run inside it.
  workers: process.env.CI ? 1 : undefined,
  // 'github' reports through annotations, not stdout (printsToStdio() is false),
  // so the runner auto-prepends the dot reporter — and dots carry no newline,
  // which Actions needs to flush a line. A job killed by its own timeout
  // therefore left NO test output in the log at all, unreadable precisely when
  // it mattered. Naming 'list' explicitly satisfies the runner's
  // someReporterPrintsToStdio check, so per-test lines replace the dots.
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Add { name: 'webkit', ... } and { name: 'firefox', ... } when ready —
    // expect Web Audio + captureStream + MIDI to behave differently across them.
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Scaled for the same reason as the budgets above: a cold vite start has to
    // transform math-collections.js (3k lines) before the first response, which
    // is ~3.5 s here and proportionally longer on a starved runner. It has not
    // timed out yet, and this is so it cannot start.
    timeout: process.env.CI ? 120_000 : 30_000,
  },
});
