// tests/e2e/particle-styles.spec.js
//
// The Particle Style row — the PTS counterpart of Surface Material — in a real
// browser. What only a browser can answer:
//   • the row belongs to POINTS and appears with it, the way the material row
//     belongs to SURFACE;
//   • picking a style actually reaches the engine through bindControls;
//   • no style breaks the shader. The particle mask lives in the FRAGMENT
//     shader that every viz mode shares, so a mistake there is not a broken
//     particle — it is a program that fails to link and a black canvas. A
//     console-error assertion on each pick is the cheap way to pin that.
//
// What is NOT here: how the styles look. tests/particle-style.test.js pins the
// four settings each one applies (size, mask, blending, trail); pixels are for
// eyes, and were checked against screenshots when the styles were tuned.

import { test, expect } from '@playwright/test';
import { revealControl } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('vimathic_about_seen', '1'); } catch (_) {}
  });
});

test.describe('Particle style', () => {
  test('the row belongs to PTS, and the pick survives leaving it', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();

    const wrap = page.locator('#particle-style-wrap');
    const sel  = page.locator('#particle-style-sel');
    const desc = page.locator('#particle-style-desc');

    // Boot mode is WIRE — points do not exist, so neither does the control.
    await expect(wrap).toBeHidden();
    await page.locator('#mode-surface').click();
    await expect(wrap).toBeHidden();

    await page.locator('#mode-points').click();
    await expect(wrap).toBeVisible();
    await expect(sel).toHaveValue('squares');
    await expect(desc).not.toBeEmpty();

    // Each style in turn: the description follows the pick, and nothing in the
    // shared fragment shader falls over on the way.
    for (const style of ['dots', 'smoke', 'squares']) {
      await sel.selectOption(style);
      await expect(sel).toHaveValue(style);
      await expect(desc).not.toBeEmpty();
      await page.waitForTimeout(250);
      expect(errors, `style "${style}" broke something: ${errors.join(' | ')}`).toEqual([]);
    }

    // The choice is remembered across a trip through another mode — the same
    // courtesy the surface material gets.
    await sel.selectOption('smoke');
    await page.locator('#mode-wireframe').click();
    await expect(wrap).toBeHidden();
    await page.locator('#mode-points').click();
    await expect(wrap).toBeVisible();
    await expect(sel).toHaveValue('smoke');

    expect(errors).toEqual([]);
  });

  test('a preset carries the style, and RESET ALL clears it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();

    const sel = page.locator('#particle-style-sel');
    await page.locator('#mode-points').click();
    await sel.selectOption('smoke');

    // Presets live inside the collapsed ADVANCED block; expand it the way an
    // operator would (see helpers.js for why it is a <summary> click).
    await revealControl(page, '#preset-name');
    await page.locator('#preset-name').fill('smoke-test');
    await page.locator('#btn-preset-save').click();

    // Change the look, then load the preset back.
    await sel.selectOption('dots');
    await expect(sel).toHaveValue('dots');
    await page.locator('#preset-list .preset-load-btn').first().click();
    await expect(sel).toHaveValue('smoke');

    // RESET ALL returns to WIRE with the startup style remembered, so coming
    // back to PTS must show squares rather than the smoke left over.
    await page.locator('#btn-reset-all').click();
    await page.waitForTimeout(600);
    await page.locator('#mode-points').click();
    await expect(sel).toHaveValue('squares');
  });
});
