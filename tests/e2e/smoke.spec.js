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
import { revealControl } from './helpers.js';

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

// revealControl — expands the collapsed ADVANCED panel around a control.
// Lives in helpers.js since clip-camera.spec.js needs it too; the reasoning
// behind the <summary> click is documented there.

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

  test('FPS counter is driven by a live render loop', async ({ page }) => {
    await page.goto('/');
    await page.locator('canvas').waitFor();

    // index.html hardcodes `<span id="fps">60</span>`, so a `not.toBe('0')`
    // assertion passes before a single frame is drawn — on a dead renderer.
    //
    // Real liveness check: stamp a sentinel the app can never write, then wait
    // for animate()'s once-per-second `DOM.fps.textContent = frames` to replace
    // it. Twice, so it proves the loop is still running, not that it ticked once.
    //
    // Deliberately no threshold on the number: CI here runs on SwiftShader at
    // 3-8 FPS, so any "must be ≥ N" assertion would be a flake generator. The
    // only claim made is "the counter is being written, with a frame count > 0".
    const SENTINEL = 'stale';
    for (let round = 1; round <= 2; round++) {
      await page.locator('#fps').evaluate((el, s) => { el.textContent = s; }, SENTINEL);

      // The counter is rewritten at most ~1s after the stamp (the `now - lastT
      // >= 1000` branch), but a software-rendered rAF can be coarse — 6s of
      // headroom keeps this honest without being slow in the happy path.
      await expect.poll(
        () => page.locator('#fps').textContent(),
        { timeout: 6_000, intervals: [250, 250, 500] },
      ).toMatch(/^\d+$/);

      // `frames` is incremented before the once-per-second check, so a live
      // loop can only ever publish a positive integer. Zero would mean the
      // counter was written by something other than animate().
      const fps = Number(await page.locator('#fps').textContent());
      expect(fps, `round ${round}: FPS counter published a non-positive value`)
        .toBeGreaterThan(0);
    }
  });
});

// ── 2. Hotkeys don't throw ────────────────────────────────────────────────────
test.describe('Hotkeys', () => {
  test('all main.js hotkeys execute without throwing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/');
    await page.locator('canvas').waitFor();

    // Every tap-action in main.js's keydown switch, in source order. 'd'
    // (next shape), 't' (surface-material cycle) and 'g' (grid fade) are the
    // ones that can actually throw — they reach into the DOM
    // (`#surface-material-sel`) and into render.grid.material — so none of
    // the three may be dropped from this list.
    //
    // Excluded on purpose: 'c' / 'n' are hold-and-drag aliases for Wave
    // Intensity owned by _fsParams in src/ui/controls.js and have no tap case,
    // so pressing them asserts nothing; ' ' (togglePlay) needs a user-gesture'd
    // AudioContext plus a loaded track; ArrowLeft / ArrowRight need a playlist.
    const keys = ['d', 't', 'f', 'r', 'q', 'e', 'w', 'g', 'h', 's'];
    for (const k of keys) {
      await page.keyboard.press(k);
      // D / R / F each kick off a morph transition and G runs a rAF fade;
      // 120ms lets one settle before the next starts, so a throw inside a
      // transition callback is attributed to the key that caused it.
      await page.waitForTimeout(120);
    }
    // 'h' left the hotkey-hint overlay open — harmless, nothing runs after it.
    expect(errors).toEqual([]);
  });

  // ── The randomiser must reach BOTH families in #gpu-sel ──────────────────
  // 38 GPU shaders (numeric values) and 192 CPU formulas (`m:collection:key`)
  // share that dropdown. The pool behind R and F was built from the CPU
  // catalogue alone, so a GPU shader could not come up at all — the shape of
  // bug that only an end-to-end press can catch, because the unit test for the
  // pool (tests/formula-picker.test.js) cannot see how main.js fills it.
  //
  // 16 presses with an early exit: the two families are drawn by a coin flip,
  // so seeing only one of them 16 times running is a 3-in-100 000 event, and
  // the loop stops as soon as both have appeared — usually within four.
  const bothFamilies = async (page, key, tries = 16) => {
    const sel  = page.locator('#gpu-sel');
    const seen = new Set();
    for (let i = 0; i < tries && seen.size < 2; i++) {
      await page.keyboard.press(key);
      await page.waitForTimeout(120);
      seen.add((await sel.inputValue()).startsWith('m:') ? 'cpu' : 'gpu');
    }
    return [...seen].sort();
  };

  test('F lands on GPU shaders as well as CPU formulas', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.locator('canvas').waitFor();

    expect(await bothFamilies(page, 'f')).toEqual(['cpu', 'gpu']);
    expect(errors).toEqual([]);
  });

  test('R does too, and still randomises the shape with it', async ({ page }) => {
    // R applies the same pick plus a shape swap, and the two families take
    // different routes to get there: a CPU formula rides inside the shape's
    // morph, a GPU shader crossfades while the shape morphs separately.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.locator('canvas').waitFor();

    const shapeBefore = await page.locator('#shape-sel').inputValue();
    expect(await bothFamilies(page, 'r')).toEqual(['cpu', 'gpu']);
    await expect(page.locator('#shape-sel')).not.toHaveValue(shapeBefore);
    expect(errors).toEqual([]);
  });
});

// ── 4. RESET ALL produces a known-good state ──────────────────────────────────
test.describe('Reset', () => {
  test('btn-reset-all returns key controls to documented defaults', async ({ page }) => {
    await page.goto('/');
    await page.locator('canvas').waitFor();

    // #bass-sens lives inside the collapsed ADVANCED block; expand it so the
    // "mess up" fill below goes through the same path a user would take.
    await revealControl(page, '#bass-sens');

    // Mess up state first
    await page.locator('#shape-sel').selectOption('torus', { force: true });
    await page.locator('#color-sel').selectOption('5', { force: true });
    await page.locator('#amplitude').fill('1.5', { force: true });
    await page.locator('#bass-sens').fill('0.4');
    await page.waitForTimeout(900);

    await page.locator('#btn-reset-all').click();
    await page.waitForTimeout(900);

    // Documented defaults from controls.js btn-reset-all handler.
    // Every number here is PARAMS.<id>.default in src/params.js — that
    // registry is what resetParamsToDefault() sweeps, so it is the only
    // source of truth. The direct writes in the handler run first and are
    // then overwritten by the sweep.
    await expect(page.locator('#shape-sel')).toHaveValue('pyramid-smooth');
    // Regression guard for defect #2: PARAMS.colorIdx.default used to be 0,
    // so RESET ALL wrote 16 (Amber) and resetParamsToDefault() immediately
    // clobbered it back to 0 (Teal Orange). 16 is startup state — main.js
    // sets audio.colorIdx = 16 and index.html marks that <option> selected.
    await expect(page.locator('#color-sel')).toHaveValue('16');
    await expect(page.locator('#amplitude')).toHaveValue('0.7');
    await expect(page.locator('#wave-int')).toHaveValue('1');
    // Regression guard for defect #19: PARAMS.bassSens.default was 1.0 while
    // audio.js boots at 1.2 and the slider ships value="1.2" — RESET ALL
    // silently dropped bass sensitivity below the startup value.
    await expect(page.locator('#bass-sens')).toHaveValue('1.2');
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

      // Both open-buttons sit two <details> deep: ADVANCED → VIDEO OUTPUT &
      // AUDIO IN for #btn-open-output, ADVANCED → CAMERA PROGRAMMER for
      // #btn-open-cam-editor. Expand once — nothing below re-collapses them,
      // so the re-open leg further down needs no second call.
      await revealControl(page, `#${openBtn}`);

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

    // #preset-name / #btn-preset-save / #preset-list are all inside the
    // collapsed ADVANCED block (one level — no adv-sub around them).
    await revealControl(page, '#preset-name');

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
