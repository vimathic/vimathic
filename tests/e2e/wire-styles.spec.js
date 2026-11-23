// tests/e2e/wire-styles.spec.js
//
// The Wire Style row — the WIRE counterpart of Particle Style — in a real
// browser. What only a browser can answer:
//   • the row belongs to WIRE, and unlike its particle twin it is on screen at
//     boot, because WIRE is the boot mode;
//   • picking a style actually reaches the engine through bindControls;
//   • no style breaks a program. The wire block lives in the FRAGMENT shader
//     that every viz mode shares, and two styles draw a body under the lines
//     with the live program — so a mistake is not a wrong look but a program
//     that fails to link and a black canvas. three reports a link failure on the
//     console, so a console-error assertion after each pick pins it, and the
//     editor case runs the same picks over a custom program.
//
// What is NOT here: how the styles look. tests/wire-style.test.js pins what
// each one sets; pixels are for eyes, and were checked against real frames
// when the styles were tuned.

import { test, expect } from '@playwright/test';
import { revealControl } from './helpers.js';

// Classic last, so every loop also ends by proving the way back.
const STYLES = ['neon', 'hidden', 'trails', 'depth', 'scan', 'hologram', 'rows', 'grid', 'contour',
                'lattice', 'electric', 'aurora', 'paint', 'glass', 'classic'];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('vimathic_about_seen', '1'); } catch (_) {}
  });
});

/** Page errors and console errors, collected for the whole test. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return errors;
}

test.describe('Wire style', () => {
  test('the row is there at boot, belongs to WIRE, and the pick survives leaving it', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();

    const wrap = page.locator('#wire-style-wrap');
    const sel  = page.locator('#wire-style-sel');
    const desc = page.locator('#wire-style-desc');

    await expect(wrap).toBeVisible();
    await expect(sel).toHaveValue('classic');
    await expect(desc).not.toBeEmpty();

    // Each style in turn: the description follows the pick, and neither the
    // shared fragment block nor a body under the lines falls over on the way.
    for (const style of STYLES) {
      await sel.selectOption(style);
      await expect(sel).toHaveValue(style);
      await expect(desc).not.toBeEmpty();
      await page.waitForTimeout(250);
      expect(errors, `style "${style}" broke something: ${errors.join(' | ')}`).toEqual([]);
    }

    // Remembered across a trip through both other modes — the courtesy the
    // particle style and the surface material get.
    await sel.selectOption('hologram');
    await page.locator('#mode-surface').click();
    await expect(wrap).toBeHidden();
    await page.locator('#mode-points').click();
    await expect(wrap).toBeHidden();
    await page.locator('#mode-wireframe').click();
    await expect(wrap).toBeVisible();
    await expect(sel).toHaveValue('hologram');

    expect(errors).toEqual([]);
  });

  test('a preset carries the style, and RESET ALL goes back to Classic', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();

    const sel = page.locator('#wire-style-sel');
    await sel.selectOption('scan');

    await revealControl(page, '#preset-name');
    await page.locator('#preset-name').fill('wire-test');
    await page.locator('#btn-preset-save').click();

    await sel.selectOption('neon');
    await expect(sel).toHaveValue('neon');
    // By name, not by position — the factory example sits in the list too.
    await page.locator('#preset-list .preset-load-btn', { hasText: 'wire-test' }).click();
    await expect(sel).toHaveValue('scan');

    // RESET ALL lands in WIRE, so the row stays up — showing Classic.
    await page.locator('#btn-reset-all').click();
    await expect(sel).toHaveValue('classic');
    await expect(page.locator('#wire-style-wrap')).toBeVisible();
  });

  test('every style still links under a custom shader from the editor', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();

    await revealControl(page, '#btn-open-editor');
    await page.locator('#btn-open-editor').click();
    await expect(page.locator('#shader-editor-overlay')).toHaveClass(/open/);
    await page.locator('.se-tab[data-tab="frag"]').click();

    // Record the status line as it changes and read the first verdict — the
    // success message clears itself after two seconds, and reading the line
    // once after the click races that timer (see shader-oracle.spec.js).
    await page.evaluate(() => {
      const el = document.getElementById('se-error');
      window.__wsLog = [];
      new MutationObserver(() => window.__wsLog.push(el.textContent))
        .observe(el, { childList: true, characterData: true, subtree: true });
    });
    await page.locator('#se-btn-apply').click();
    await expect.poll(() => page.evaluate(() => (window.__wsLog ?? []).find(t => t.trim()) ?? ''))
      .toMatch(/^[✔⚠] Compiled/);

    await page.locator('#se-close').click();
    await expect(page.locator('#shader-editor-overlay')).not.toHaveClass(/open/);

    // Every body under the lines is built from the LIVE program, so this is
    // where an editor scaffold missing the wire block, or a body left on the
    // built-ins, would show.
    const sel = page.locator('#wire-style-sel');
    for (const style of STYLES) {
      await sel.selectOption(style);
      await page.waitForTimeout(300);
      expect(errors, `style "${style}" over a custom shader: ${errors.join(' | ')}`).toEqual([]);
    }
  });
});
