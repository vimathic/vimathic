// playwright.config.js
// Run: npx playwright test
// Run with UI: npx playwright test --ui
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One worker in CI, not two. These tests drive a real WebGL scene and hosted
  // runners have no GPU, so Chromium falls back to SwiftShader; parallel
  // contexts then starve each other and the render loop misses its deadlines.
  // That is what made the FPS assertion time out on a machine where the app
  // was in fact running fine. Serialised the 14 tests take ~3-4 min on a
  // GPU-less machine, and up to 3× that if failures burn their two retries —
  // which is why the CI job's budget is 30 min, not the 15 it had.
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
    timeout: 30_000,
  },
});
