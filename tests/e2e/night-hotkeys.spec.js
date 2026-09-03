// tests/e2e/night-hotkeys.spec.js
//
// The three colour hotkeys under NIGHT, in a real browser.
//
// ── Why this file, when params.js is already unit-tested ─────────────────────
// tests/colour-pool-step.test.js pins the RULE — nextInPool — and
// tests/controls-wiring.test.js pins the HOOK that swaps the pool. Neither can
// see the wire between them, because it is `main.js`'s keydown switch: importing
// that file constructs the whole app, so no node test reaches it, and that is
// exactly where the defect was. E stepped `(colorIdx + 1) % 54` — the whole
// catalogue — while NIGHT had narrowed every other unattended picker to ten
// schemes. The mode opens on scheme 44, so ten presses of "next colour" walked
// out of the series and onto scheme 0, the brightest thing in the build.
//
// So the assertions here are deliberately end-to-end and dumb: press the key a
// browser press, read the value the panel shows. #color-sel is the app's own
// readout of which palette is live — every colour write in the app assigns it.
//
// Each claim carries its control in the same shape: the same walk with the mode
// OFF has to leave the series, or these tests would pass on a pool that simply
// had nowhere else to go.

import { test, expect } from '@playwright/test';

// The NIGHT series as index.html declares it. Written out rather than imported:
// this file is the outside view, and a constant taken from params.js would
// agree with the app by construction.
const NIGHT_FIRST = 44;
const NIGHT_LAST  = 53;
const SHIPPED     = 16;

const inSeries = v => v >= NIGHT_FIRST && v <= NIGHT_LAST;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // The first-launch About modal is aria-modal and stands every hotkey down.
    try { localStorage.setItem('vimathic_about_seen', '1'); } catch (_) {}
    // A snapshot from an earlier run would decide the palette and the mode for
    // us, which is the one thing these tests must decide themselves.
    try { localStorage.removeItem('vimathic_persisted_state'); } catch (_) {}
  });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  // Hotkeys stand down while an input, select or textarea holds focus — and the
  // panel's pickers keep focus after a click. Put it on the canvas.
  await page.locator('canvas').click({ position: { x: 40, y: 40 } });
});

/** Press a key n times and collect the palette the panel reports after each. */
async function walk(page, key, times) {
  const seen = [];
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    seen.push(Number(await page.locator('#color-sel').inputValue()));
  }
  return seen;
}

test.describe('NIGHT owns the colour keys', () => {

  test('E steps around the series instead of walking out of it', async ({ page }) => {
    await page.locator('#night-btn').click();
    await expect(page.locator('body')).toHaveClass(/nightly/);
    await expect(page.locator('#color-sel')).toHaveValue(String(NIGHT_FIRST));

    // Twelve, not ten: the series is ten long, so this also crosses the wrap.
    const seen = await walk(page, 'e', 12);

    expect(seen.every(inSeries),
      `E left the NIGHT series: ${seen.join(', ')}`).toBe(true);
    // The wrap lands on the first of the series, and this is the exact value
    // the old rule got wrong — it stepped from 53 to 0.
    expect(seen[9]).toBe(NIGHT_FIRST);
    expect(seen.slice(0, 10).sort((a, b) => a - b))
      .toEqual([44, 45, 46, 47, 48, 49, 50, 51, 52, 53]);
  });

  test('control — with the mode off the same walk does leave the series', async ({ page }) => {
    // Without this the test above passes on a build where E does nothing at
    // all, and on one where the pool happens to have nowhere else to go.
    await page.locator('#night-btn').click();
    await expect(page.locator('#color-sel')).toHaveValue(String(NIGHT_FIRST));
    await page.locator('#night-btn').click();          // …and back off
    await expect(page.locator('body')).not.toHaveClass(/nightly/);

    const seen = await walk(page, 'e', 12);

    expect(seen.some(v => !inSeries(v)),
      'E stayed inside the NIGHT ten with the mode switched off').toBe(true);
    expect(seen[9]).toBe(0);   // 53 -> 0, the catalogue's own next
  });

  test('Q draws only from the series', async ({ page }) => {
    // Q was already right — it draws from the shuffle bag main.js rebuilds on
    // the pool hook. Pinned here anyway: it was the key the report named, and
    // the wire it depends on is the same one E was missing.
    await page.locator('#night-btn').click();
    const seen = await walk(page, 'q', 20);
    expect(seen.every(inSeries), `Q drew outside the series: ${seen.join(', ')}`).toBe(true);
    // …and it is a draw, not a stuck value.
    expect(new Set(seen).size).toBeGreaterThan(3);
  });

  test('control — with the mode off Q reaches the rest of the catalogue', async ({ page }) => {
    const seen = await walk(page, 'q', 20);
    expect(seen.some(v => !inSeries(v)),
      'Q never left the NIGHT ten in a session with no NIGHT in it').toBe(true);
  });

  test('R randomises everything and still keeps the palette dark', async ({ page }) => {
    await page.locator('#night-btn').click();
    const seen = await walk(page, 'r', 10);
    expect(seen.every(inSeries), `R drew outside the series: ${seen.join(', ')}`).toBe(true);
  });

  test('a bright palette reached through the dropdown is stepped back into the series', async ({ page }) => {
    // NIGHT deliberately leaves the dropdown free — the mode is about what the
    // app picks unattended, not about what the operator may pick. So a bright
    // scheme under NIGHT is reachable, and E has to move somewhere sensible
    // from it rather than stand still or continue along the catalogue.
    await page.locator('#night-btn').click();
    await page.evaluate((v) => {
      const sel = document.getElementById('color-sel');
      sel.value = String(v);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, SHIPPED);
    await expect(page.locator('#color-sel')).toHaveValue(String(SHIPPED));

    await page.locator('canvas').click({ position: { x: 40, y: 40 } });
    const seen = await walk(page, 'e', 3);

    expect(seen[0]).toBe(NIGHT_FIRST);
    expect(seen.every(inSeries), `E carried on down the catalogue: ${seen.join(', ')}`).toBe(true);
  });
});
