// tests/e2e/stars.spec.js
//
// STARS in a real browser: the button's wiring through the real modules, the
// autosave and boot restore that carry it across a reload, RESET ALL, and the
// FPS row's geometry with a third text button in it.
//
// What this file does NOT assert, and why: the starfield itself. The app
// exposes no handle on the renderer, and sampling canvas pixels for 1200 small
// dim points is a luminance threshold that has to hold across a software and a
// hardware GL path. The engine half — the wish against TRANSPARENT BG, the one
// writer — is measured exactly in tests/stars-toggle.test.js. What is left here
// is what a stub cannot check: an id that resolves, a listener on the element
// the operator actually clicks, a snapshot that really reaches localStorage and
// really comes back, and a row that really fits.
//
// The geometry guard exists because the fit was measured, not assumed: the
// row had 10.8 px to spare before STARS, a third button in the old style
// overflowed it by 40 px, and `.ctrl-body{overflow:hidden}` clipped TOGGLE
// GRID instead of scrolling it — a half-visible button with no error anywhere.
// index.html's .eq-fps-row comment has the numbers.
//
// FIX(review): the guard used to measure a row 10 px wider than users get.
// Playwright launches headless Chromium with --hide-scrollbars, so the panel's
// scrollbar took 0 px and the row was 268 px. In a real browser the panel
// scrolls (at 1280x720 on a fresh boot, at 1920x1080 once ADVANCED is open)
// and its thin scrollbar takes 10 px, leaving 258 px — 22.8 px of slack, not
// the 32.8 px the guard saw, so a change that widened the row by 23-32.8 px
// passed here and clipped TOGGLE GRID for real users. The flag is dropped for
// this file (the top-level test.use below: a launch option cannot be set per
// describe group), ADVANCED is opened so the panel scrolls at both sizes, and
// the test checks the scrollbar is really there before it measures (with the
// flag put back, that precondition is what fails). Measured with it: 258 px at
// both sizes. Run against the pre-STARS styling (gap 8px, padding 3px 7px,
// letter-spacing 1px), it fails at both sizes — scrollWidth 298 against 258 —
// and so does a STARS widened by 26 px, which the 268 px row had room for.
//
// The phone block checks the other half: there the row is 366 px and fits
// easily, and the three text buttons get a 32 px touch height.

import { test, expect } from '@playwright/test';
import { revealControl } from './helpers.js';

// Real scrollbars for every test in this file. Only the geometry block needs
// them; the STARS tests click, reload and read localStorage, and a scrollbar
// in the panel changes none of that.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

// The first-launch About modal is aria-modal and would swallow these clicks.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('vimathic_about_seen', '1'); } catch (_) {}
  });
});

const PERSIST_KEY = 'vimathic_persisted_state';
const inlineOpacity = loc => loc.evaluate(el => el.style.opacity);

test.describe('STARS', () => {

  test('the switch is saved, survives a reload, and RESET ALL turns it back on', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();

    const btn = page.locator('#btn-toggle-stars');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('STARS');
    // Ships ON: no inline opacity at all, so the stylesheet's full strength.
    expect(await inlineOpacity(btn)).toBe('');

    await btn.click();
    expect(await inlineOpacity(btn)).toBe('0.45');

    // The click is inside .controls-panel, so the delegated listener schedules
    // a save; the debounce is 1500 ms. Poll rather than sleep — the 1 s
    // fingerprint tick may re-arm it once.
    await expect.poll(
      () => page.evaluate(k => {
        try { return JSON.parse(localStorage.getItem(k) ?? 'null')?.starsOn; } catch (_) { return undefined; }
      }, PERSIST_KEY),
      { timeout: 8_000, intervals: [250, 500, 500, 1000] },
    ).toBe(false);

    // Boot restore runs after bindControls and goes through applyState, which
    // paints the button through ui.setStars — so it comes up reading OFF.
    await page.reload();
    await expect(page.locator('canvas')).toBeVisible();
    // The boot restore lands after the rest of the boot, which on a GPU-less CI
    // runner takes ~20 s; the 5 s that is plenty here is the same factor short
    // there, which is why playwright.config.js scales its own expect budget.
    await expect.poll(() => inlineOpacity(btn), { timeout: process.env.CI ? 25_000 : 5_000 }).toBe('0.45');

    await revealControl(page, '#btn-reset-all');
    await page.locator('#btn-reset-all').click();
    expect(await inlineOpacity(btn)).toBe('1');

    expect(errors, errors.join(' | ')).toEqual([]);
  });

  test('control — a fresh session boots with the stars on', async ({ page }) => {
    // Without this the reload case above passes just as well against a build
    // that always boots with the button dimmed.
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    const btn = page.locator('#btn-toggle-stars');
    // Give the boot restore and the first autosave tick time to run.
    await page.waitForTimeout(1_500);
    expect(await inlineOpacity(btn)).toBe('');
  });
});

const TEXT_BUTTONS = ['btn-freeze-frame', 'btn-toggle-stars', 'btn-toggle-grid'];

/** The row, the panel's scrollbar, and the three text buttons' boxes. */
const rowGeometry = page => page.evaluate(ids => {
  const row   = document.querySelector('.eq-fps-row');
  const panel = document.querySelector('.controls-panel');
  const cs    = getComputedStyle(panel);
  const rect  = el => el.getBoundingClientRect();
  const box   = id => rect(document.getElementById(id));
  return {
    scrollWidth: row.scrollWidth,
    clientWidth: row.clientWidth,
    rowLeft:   rect(row).left,
    rowRight:  rect(row).right,
    // What the panel's vertical scrollbar takes out of its width.
    panelScrollbar: panel.offsetWidth - panel.clientWidth
      - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth),
    freezeLeft: box('btn-freeze-frame').left,
    starsRight: box('btn-toggle-stars').right,
    gridRight:  box('btn-toggle-grid').right,
    heights: Object.fromEntries(ids.map(id => [id, box(id).height])),
  };
}, TEXT_BUTTONS);

test.describe('FPS row geometry', () => {
  for (const [width, height] of [[1280, 720], [1920, 1080]]) {
    test(`STOP MOTION, STARS and TOGGLE GRID fit the row at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await expect(page.locator('canvas')).toBeVisible();

      // ADVANCED open, the way an operator opens it, so the panel scrolls at
      // both sizes: the narrowest row a real browser gives at this width.
      const adv = page.locator('details.adv-section');
      await adv.locator('summary').first().click();
      await expect(adv).toHaveJSProperty('open', true);

      const g = await rowGeometry(page);

      expect(g.clientWidth, 'the row has no width — the panel is not laid out').toBeGreaterThan(0);
      // The precondition the numbers below depend on. Zero means the panel is
      // measured without the scrollbar a real browser shows — --hide-scrollbars
      // is back in the launch args, or the panel stopped scrolling — and the row
      // is 10 px wider than the one users get.
      expect(g.panelScrollbar,
        `the panel's scrollbar takes ${g.panelScrollbar} px, so this measures a ${g.clientWidth} px row ` +
        'no real browser gives a scrolling panel').toBeGreaterThan(0);
      expect(g.scrollWidth, `the ${g.clientWidth} px row overflows by ${g.scrollWidth - g.clientWidth} px`)
        .toBeLessThanOrEqual(g.clientWidth);
      // Half a pixel for sub-pixel rounding of the last flex item's edge;
      // the overflow this guards against was 40 px.
      expect(g.gridRight, `TOGGLE GRID ends ${(g.gridRight - g.rowRight).toFixed(1)} px past the ` +
        `${g.clientWidth} px row, where .ctrl-body clips it`).toBeLessThanOrEqual(g.rowRight + 0.5);
      expect(g.starsRight).toBeLessThanOrEqual(g.gridRight);
      expect(g.freezeLeft).toBeGreaterThanOrEqual(g.rowLeft - 0.5);
      // Control for the phone block below: its touch height stays on phones.
      for (const id of TEXT_BUTTONS) {
        expect(g.heights[id], `#${id} grew to ${g.heights[id]} px tall on the desktop`).toBeLessThan(24);
      }
    });
  }
});

test.describe('FPS row on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the three text buttons are touch-sized, and the row still fits', async ({ page }) => {
    // Their inline 8px font and padding beat the mobile button rule, so they
    // were 17-19 px tall; index.html's media query gives them a min-height.
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    const g = await rowGeometry(page);
    for (const id of TEXT_BUTTONS) {
      expect(g.heights[id], `#${id} is ${g.heights[id]} px tall — too small to tap`).toBeGreaterThanOrEqual(32);
    }
    expect(g.scrollWidth, `the ${g.clientWidth} px row overflows by ${g.scrollWidth - g.clientWidth} px`)
      .toBeLessThanOrEqual(g.clientWidth);
    expect(g.gridRight).toBeLessThanOrEqual(g.rowRight + 0.5);
  });
});
