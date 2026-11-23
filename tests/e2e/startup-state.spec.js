// tests/e2e/startup-state.spec.js
//
// A first visit opens in the startup state (src/ui/startup-state.js); a
// browser that has been here before, with no saved session, gets the defaults.
// Every other spec sets vimathic_about_seen before navigating, so they all run
// on the defaults — this is the one place the first launch is exercised.

import { test, expect } from '@playwright/test';

const inlineOpacity = loc => loc.evaluate(el => el.style.opacity);

test('a first visit opens in the startup state', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  // The first launch also opens the About tour; close it.
  await expect(page.locator('#about-overlay')).toHaveClass(/open/, { timeout: process.env.CI ? 25_000 : 5_000 });
  await page.locator('#about-close').click();

  const wait = { timeout: process.env.CI ? 25_000 : 5_000 };
  await expect(page.locator('#shape-sel')).toHaveValue('box', wait);
  await expect(page.locator('#mode-points')).toHaveClass(/active/, wait);
  await expect(page.locator('#particle-style-sel')).toHaveValue('smoke', wait);
  await expect(page.locator('#deform-collapse')).toHaveClass(/active/, wait);
  await expect(page.locator('#color-sel')).toHaveValue('45', wait);
  await expect(page.locator('#night-btn')).toHaveClass(/active/, wait);
  await expect.poll(() => inlineOpacity(page.locator('#btn-toggle-stars')), wait).toBe('0.45');
  await expect(page.locator('#btn-ar')).toHaveText(/ON/, wait);

  expect(errors, errors.join(' | ')).toEqual([]);
});

test('control — a browser that has been here before, with no saved session, gets the defaults', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('vimathic_about_seen', '1'); } catch (_) {}
  });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(page.locator('#mode-wireframe')).toHaveClass(/active/);
  await expect(page.locator('#night-btn')).not.toHaveClass(/active/);
  expect(await inlineOpacity(page.locator('#btn-toggle-stars'))).toBe('');
});
