// tests/e2e/transparent-bg.spec.js
//
// TRANSPARENT BG at the shipped Bloom, read off the real canvas.
//
// What only a browser can answer: whether the alpha the composer hands the page
// is the picture's own. three's UnrealBloomPass used to add a constant (~2.3 at
// the shipped 0.55) to every pixel's alpha, so with TRANSPARENT BG on the whole
// frame came out opaque — measured, 100 % of pixels — and OBS composited a
// black rectangle over the camera. tests/bloom-alpha.test.js pins the
// arithmetic of the fix; this reads the pixels.

import { test, expect } from '@playwright/test';
import { revealControl } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('vimathic_about_seen', '1'); } catch (_) {}
  });
});

/** Max alpha over the four 24×24 corners and over a 240×240 centre box. */
const readAlpha = page => page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
  const src = document.querySelector('canvas');
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const box = (x0, y0, w, h) => {
    const d = g.getImageData(x0, y0, w, h).data;
    let m = 0;
    for (let i = 3; i < d.length; i += 4) m = Math.max(m, d[i]);
    return m / 255;
  };
  const W = c.width, H = c.height, s = 24, cb = 240;
  res({
    corners: Math.max(box(0, 0, s, s), box(W - s, 0, s, s), box(0, H - s, s, s), box(W - s, H - s, s, s)),
    centre: box((W - cb) >> 1, (H - cb) >> 1, cb, cb),
  });
}))));

test.describe('TRANSPARENT BG', () => {
  test('stays transparent at the shipped Bloom, and the body stays drawn', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    // The setting this is about: Bloom as shipped, well above the ~0.3 where
    // the old blend had already made the frame opaque.
    await expect(page.locator('#bloom')).toHaveValue('0.55');

    await revealControl(page, '#btn-transp-bg');
    await page.locator('#btn-transp-bg').click();
    await page.waitForTimeout(800);

    const on = await readAlpha(page);
    expect(on.corners, 'the empty corners are opaque — the bloom is covering the whole frame again').toBeLessThan(0.05);
    expect(on.centre, 'the body vanished with the background').toBeGreaterThan(0.5);

    // Control: switched off, the stage is opaque again — so the corners above
    // were read off a canvas that can report alpha at all.
    await page.locator('#btn-transp-bg').click();
    await page.waitForTimeout(800);
    const off = await readAlpha(page);
    expect(off.corners).toBeGreaterThan(0.95);
  });
});
