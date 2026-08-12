// tests/e2e/auto-cycle.spec.js
//
// The ⟳ AUTO toggles beside Color Scheme and Surface Material, in a real
// browser. What only a browser can answer:
//   • the buttons are where they were asked to be — beside their dropdown, not
//     under it (a flex row that collapses under a long palette name would still
//     pass every unit test);
//   • clicking one actually reaches the engine through bindControls;
//   • the material toggle inherits its dropdown's visibility rule, so it cannot
//     be left as a live control for a parameter that is forced to Matte.
//
// What is NOT here: the cadence. Proving "8 bars at the detected BPM" through
// the UI means either waiting out a period or installing a fake clock over a
// live WebGL render loop; tests/auto-cycle.test.js pins it in milliseconds
// against mock timers instead. The one timing fact this file does use is that
// arming a toggle changes the value immediately — that IS the feedback the
// button owes the operator, so it belongs in the UI test.

import { test, expect } from '@playwright/test';

// Same first-launch suppression as smoke.spec.js — the About modal would sit
// over the panel and eat every click.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('vimathic_about_seen', '1'); } catch (_) {}
  });
});

test.describe('AUTO colour', () => {
  test('sits beside the palette dropdown and changes it the moment it is armed', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();

    // #color-sel itself is display:none from load: makeSearchable() (bottom of
    // index.html) hides it inside a .srch-wrap combobox and drives it from a
    // filter input. So the native select is where the VALUE lives, the wrapper
    // is where the LAYOUT lives, and the input's placeholder is the palette
    // name a human actually reads. All three are checked below.
    const sel   = page.locator('#color-sel');
    const combo = page.locator('.cg-row:has(#color-sel) .srch-wrap');
    const label = combo.locator('.srch-input');
    const btn   = page.locator('#color-auto');
    await expect(btn).toBeVisible();
    await expect(combo).toBeVisible();

    // Placement: same row, to the right — the layout the screenshot asked for.
    const comboBox = await combo.boundingBox();
    const btnBox   = await btn.boundingBox();
    expect(btnBox.x).toBeGreaterThan(comboBox.x + comboBox.width - 1);
    expect(Math.abs(btnBox.y - comboBox.y)).toBeLessThan(comboBox.height);
    // And it must not have pushed itself out of the panel.
    const panelBox = await page.locator('.controls-panel').boundingBox();
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);

    const before      = await sel.inputValue();
    const beforeLabel = await label.getAttribute('placeholder');
    await btn.click();
    await expect(btn).toHaveClass(/active/);
    await expect(sel).not.toHaveValue(before);
    // The combobox has to follow a programmatic write, or the panel names one
    // palette while the shader draws another.
    await expect(label).not.toHaveAttribute('placeholder', beforeLabel);

    // Switching off is not a revert: the palette it reached stays on screen.
    const reached = await sel.inputValue();
    await btn.click();
    await expect(btn).not.toHaveClass(/active/);
    await expect(sel).toHaveValue(reached);
  });
});

test.describe('AUTO material', () => {
  test('hidden with its dropdown in WIRE, live in SURF', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();

    const sel = page.locator('#surface-material-sel');
    const btn = page.locator('#surface-material-auto');

    // Boot mode is WIRE, where a reconstructed normal makes reflections
    // nonsense: the material row — button included — is not shown at all.
    await expect(sel).toBeHidden();
    await expect(btn).toBeHidden();

    await page.locator('#mode-surface').click();
    await expect(sel).toBeVisible();
    await expect(btn).toBeVisible();

    const before = await sel.inputValue();
    await btn.click();
    await expect(btn).toHaveClass(/active/);
    await expect(sel).not.toHaveValue(before);

    // Back to WIRE: the control disappears again while still armed, and the
    // dropdown reads Matte because that is all this mode can draw.
    await page.locator('#mode-wireframe').click();
    await expect(btn).toBeHidden();
    await expect(sel).toHaveValue('matte');
  });

  test('RESET ALL disarms both toggles', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();

    await page.locator('#mode-surface').click();
    await page.locator('#color-auto').click();
    await page.locator('#surface-material-auto').click();
    await expect(page.locator('#color-auto')).toHaveClass(/active/);
    await expect(page.locator('#surface-material-auto')).toHaveClass(/active/);

    await page.locator('#btn-reset-all').click();
    await expect(page.locator('#color-auto')).not.toHaveClass(/active/);
    // RESET ALL also returns to WIRE, which hides the material control — assert
    // the state it carries, not its visibility.
    await expect(page.locator('#surface-material-auto')).not.toHaveClass(/active/);
  });
});
