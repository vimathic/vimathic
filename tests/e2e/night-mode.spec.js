// tests/e2e/night-mode.spec.js
//
// NIGHT in a real browser.
//
// Everything else that tests this mode runs against stubs: tests/night-mode.js
// calls three RenderEngine methods on a hand-built host, and the panel half is
// driven through a fake document in tests/controls-wiring.test.js. Neither of
// them loads the real modules in a real page, so neither can see the mode fail
// for the reasons a browser fails things — an id that dom.js resolves to
// nothing, a listener bound to an element the panel never shows, a class
// written to the wrong node.
//
// What this file does NOT assert, and why: the starfield and the grid. The app
// exposes no handle on the renderer (deliberately — see the notes on the
// preview tooling), so reading either from here would mean sampling canvas
// pixels, and a luminance threshold that has to hold across a software and a
// hardware GL path is a flake waiting to happen. The engine half of the mode is
// measured in tests/night-mode.test.js instead, where the numbers are exact.
// What is left here is the wiring, which is precisely what a stub cannot check.

import { test, expect } from '@playwright/test';
import { revealControl } from './helpers.js';

// The first-launch About modal is aria-modal and would swallow these clicks.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('vimathic_about_seen', '1'); } catch (_) {}
  });
});

// The first scheme of the NIGHT series, and the palette the app ships on.
// Written out rather than imported: this file is the outside view, and a
// constant taken from params.js would agree with the app by construction.
const FIRST_NIGHT = '44';
const SHIPPED     = '16';

test.describe('NIGHT', () => {

  test('the switch dims the chrome and moves the palette into the series', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('#color-sel')).toHaveValue(SHIPPED);

    await page.locator('#night-btn').click();

    await expect(page.locator('#night-btn')).toHaveClass(/active/);
    await expect(page.locator('body')).toHaveClass(/nightly/);
    // The mode is about what the app picks unattended, but switching it on
    // over a bright palette would leave it looking broken — stars gone, grid
    // dimmed, picture still glaring — so the switch-on moves the palette once.
    await expect(page.locator('#color-sel')).toHaveValue(FIRST_NIGHT);
  });

  test('switching it off gives the chrome back and keeps the palette', async ({ page }) => {
    await page.goto('/');
    await page.locator('#night-btn').click();
    await expect(page.locator('#color-sel')).toHaveValue(FIRST_NIGHT);

    await page.locator('#night-btn').click();

    await expect(page.locator('#night-btn')).not.toHaveClass(/active/);
    await expect(page.locator('body')).not.toHaveClass(/nightly/);
    // Documented behaviour, not an oversight: the NIGHT palettes are ordinary
    // members of the catalogue, and a good look should not evaporate because
    // the furniture came back.
    await expect(page.locator('#color-sel')).toHaveValue(FIRST_NIGHT);
  });

  test('RESET ALL clears it — it is a mode, not a value', async ({ page }) => {
    await page.goto('/');
    await page.locator('#night-btn').click();
    await expect(page.locator('body')).toHaveClass(/nightly/);

    await revealControl(page, '#btn-reset-all');
    await page.locator('#btn-reset-all').click();

    // Left on, "back to the startup state" landed on a bright palette under a
    // starless sky with the panel still dimmed and the button still lit.
    await expect(page.locator('#night-btn')).not.toHaveClass(/active/);
    await expect(page.locator('body')).not.toHaveClass(/nightly/);
    await expect(page.locator('#color-sel')).toHaveValue(SHIPPED);
  });
});
