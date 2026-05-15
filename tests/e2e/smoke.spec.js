// tests/e2e/smoke.spec.js
//
// Bootstrap smoke tests for VIMATHIC.
//
// Goal: catch regressions in the audio.cb wiring, hotkey handlers, and
// DOM-id contract between HTML and bind*() calls. Anything that throws
// or leaves a critical DOM id orphaned breaks the whole UI silently in
// production — these tests fail loud at PR time instead.
//
// What we DON'T test here:
//   - Audio playback (requires user gesture + a real file)
//   - WebGL rendering correctness (visual-regression tooling, separate)
//   - MIDI device interactions (requires real hardware)
//   - Second-screen popup (popup blockers + cross-window stream)

import { test, expect } from '@playwright/test';

// Source of truth for required HTML ids lives in src/dom.js. Importing it
// here means the DOM-contract assertion below covers every id that boot
// actually needs, automatically. Previously this file kept its own hand-
// curated subset (~43 ids) that drifted behind dom.js (~128 ids) every
// time someone added a panel without updating the test.
//
// NOTE: adjust the relative path if your repo layout puts dom.js elsewhere.
// dom.js has a Node guard so `document` access is skipped on this side —
// only REQUIRED_IDS / OPTIONAL_IDS arrays are evaluated at import time.
import { REQUIRED_IDS } from '../../src/dom.js';

// ── Suppress first-launch About modal in all tests ──────────────────────────
// The About modal opens automatically on first visit until 'vimathic_about_seen'
// is set in localStorage. Playwright starts with clean state every time, so the
// modal would always block clicks on the UI underneath. Set the flag before any
// navigation to skip the first-launch tour and make all UI interactive.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('vimathic_about_seen', '1'); } catch (_) {}
  });
});

// ── 1. Smoke: page loads, no JS errors, no missing DOM ids ────────────────────
test.describe('Bootstrap', () => {
  test('loads without console errors and exposes the engines on window', async ({ page }) => {
    const errors = [];
    page.on('pageerror',  e => errors.push(`pageerror: ${e.message}`));
    page.on('console',    msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto('/');
    // First paint should produce a canvas — Three.js inserts it into <body>
    await expect(page.locator('canvas')).toBeVisible();

    // Every id dom.js considers required must exist in the rendered HTML.
    // dom.js already throws on boot if any are missing — this assertion
    // confirms that behaviour in a real browser, and also gives a clean
    // diff-able failure (the list of missing ids) instead of just the
    // pageerror from resolveGroup().
    const missing = await page.evaluate(
      ids => ids.filter(id => !document.getElementById(id)),
      REQUIRED_IDS,
    );
    expect(missing, `Missing DOM ids referenced by JS: ${missing.join(', ')}`).toEqual([]);

    expect(errors, `Console errors during boot: ${errors.join(' | ')}`).toEqual([]);
  });

  test('FPS counter starts ticking within 2s', async ({ page }) => {
    await page.goto('/');
    // Wait for the animate loop to run at least one second
    await expect.poll(
      () => page.locator('#fps').innerText(),
      { timeout: 3_000, intervals: [200, 500] }
    ).not.toBe('0');
  });
});

// ── 2. Hotkeys don't throw ────────────────────────────────────────────────────
test.describe('Hotkeys', () => {
  test('all main.js hotkeys execute without throwing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/');
    await page.locator('canvas').waitFor();

    // Spec from main.js: r, f, q, e, w, c, h, n, s
    // Skip: arrow keys (require playlist), space (toggles audio context)
    const keys = ['q', 'e', 'r', 'f', 'w', 'c', 'h', 'n', 's'];
    for (const k of keys) {
      await page.keyboard.press(k);
      await page.waitForTimeout(80); // give RAF a tick
    }
    expect(errors).toEqual([]);
  });
});

// ── 4. RESET ALL produces a known-good state ──────────────────────────────────
test.describe('Reset', () => {
  test('btn-reset-all returns key controls to documented defaults', async ({ page }) => {
    await page.goto('/');
    await page.locator('canvas').waitFor();

    // Mess up state first
    await page.locator('#shape-sel').selectOption('torus', { force: true });
    await page.locator('#color-sel').selectOption('5', { force: true });
    await page.locator('#amplitude').fill('1.5', { force: true });
    await page.waitForTimeout(900);

    await page.locator('#btn-reset-all').click();
    await page.waitForTimeout(900);

    // Documented defaults from controls.js btn-reset-all handler
    await expect(page.locator('#shape-sel')).toHaveValue('pyramid-smooth');
    await expect(page.locator('#color-sel')).toHaveValue('16');
    await expect(page.locator('#amplitude')).toHaveValue('0.7');
    await expect(page.locator('#wave-int')).toHaveValue('1');
    await expect(page.locator('#bloom')).toHaveValue('0.55');
    await expect(page.locator('#gpu-sel')).toHaveValue('m:differentialEqs:pendulumNonLinear');
  });
});

// ── 5. Modal open/close lifecycle ─────────────────────────────────────────────
test.describe('Modals', () => {
  for (const [openBtn, overlay, closeBtn] of [
    ['btn-open-output',     'output-overlay',     'out-close'],
    ['btn-open-cam-editor', 'cam-editor-overlay', 'ce-close'],
  ]) {
    test(`${overlay} opens and closes via button + Escape`, async ({ page }) => {
      await page.goto('/');
      await page.locator('canvas').waitFor();

      const overlayEl = page.locator(`#${overlay}`);
      await page.locator(`#${openBtn}`).click();
      await expect(overlayEl).toHaveClass(/open/);

      // Close via X button
      await page.locator(`#${closeBtn}`).click();
      await expect(overlayEl).not.toHaveClass(/open/);

      // Re-open and close via Escape
      await page.locator(`#${openBtn}`).click();
      await expect(overlayEl).toHaveClass(/open/);
      await page.keyboard.press('Escape');
      await expect(overlayEl).not.toHaveClass(/open/);
    });
  }
});

// ── 6. Preset save/load roundtrip via localStorage ────────────────────────────
test.describe('Presets', () => {
  test('save → list → load → state matches', async ({ page }) => {
    await page.goto('/');
    await page.locator('canvas').waitFor();

    // Set a distinctive state
    await page.locator('#shape-sel').selectOption('icosahedron', { force: true });
    await page.locator('#color-sel').selectOption('13', { force: true }); // lava
    await page.locator('#amplitude').fill('1.2', { force: true });
    await page.waitForTimeout(900);

    // Save under a name
    await page.locator('#preset-name').fill('e2e-test-1');
    await page.locator('#btn-preset-save').click();

    // Should appear in #preset-list
    const listText = await page.locator('#preset-list').innerText();
    expect(listText).toContain('e2e-test-1');

    // Reset
    await page.locator('#btn-reset-all').click();
    await page.waitForTimeout(900);
    await expect(page.locator('#shape-sel')).toHaveValue('pyramid-smooth');

    // Load preset by clicking its button
    await page.locator('#preset-list .preset-load-btn:has-text("e2e-test-1")').click();
    await page.waitForTimeout(900);

    await expect(page.locator('#shape-sel')).toHaveValue('icosahedron');
    await expect(page.locator('#color-sel')).toHaveValue('13');
    await expect(page.locator('#amplitude')).toHaveValue('1.2');

    // Cleanup — delete the test preset
    await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('vimathic_presets') || '[]')
        .filter(p => p.name !== 'e2e-test-1');
      localStorage.setItem('vimathic_presets', JSON.stringify(list));
    });
  });
});

// ── 7. Math worker is loaded (regression guard) ──
test.describe('Math worker', () => {
  test('window._vimathic_worker_active is true after CPU formula activates', async ({ page }) => {
    await page.goto('/');
    await page.locator('canvas').waitFor();

    // The default RESET ALL state already activates a CPU formula
    // (differentialEqs/pendulumNonLinear), so the flag should already be set.
    const flag = await page.evaluate(() => window._vimathic_worker_active);
    expect(flag).toBe(true);
  });
});
