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
  // was in fact running fine. The suite takes ~1.5 min serialised, well inside
  // the job's 15-minute budget.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
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
