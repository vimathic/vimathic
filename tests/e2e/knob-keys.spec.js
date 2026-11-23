// tests/e2e/knob-keys.spec.js
//
// The formula slot's hold-and-drag keys, and the two tap keys they displaced,
// in a real browser.
//
// On 08.10.2026 the owner gave every knob in the slot a key: B Formula Detail,
// N Formula Phase, Y U H J Shader Knobs 1-4. Each key reaches only the bank the
// slot is showing — the pair on a CPU formula, the knobs on a numbered SHADER
// MODE entry — and the glitch punch and the hint overlay moved from Y and H to
// P and I, because a letter cannot hold both a tap and a drag.
//
// tests/controls-wiring.test.js drives every rule through the real listeners
// on a stub document, and tests/hotkey-map.test.js holds the two key maps and
// the overlay to each other as source. What neither can see is what this file
// is for: a real keydown, a real mouse move that the browser turns into
// movementX, a real wheel event, the real main.js switch (which no unit test
// can import), and the slider and badge an operator actually reads.

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // The first-launch About modal is aria-modal and stands every hotkey down.
    try { localStorage.setItem('vimathic_about_seen', '1'); } catch (_) {}
    // The first keydown is the gesture that fetches and starts the intro
    // track, and a playing track flashes the beat ring on every beat — which
    // would make "P flashes the ring, H and Y do not" a race against the
    // music. Declined the way a CLEAR declines it.
    try { localStorage.setItem('vimathic_intro_cleared', 'true'); } catch (_) {}
    // A snapshot from an earlier run would choose the selection for us.
    try { localStorage.removeItem('vimathic_persisted_state'); } catch (_) {}
  });
});

// #gpu-sel is hidden behind index.html's searchable widget, so selectOption
// cannot reach it; these are the two lines the widget runs on a pick — the
// same helper smoke.spec.js's "Formula knobs" group uses.
const pick = (page, v) => page.$eval('#gpu-sel', (sel, value) => {
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

const numberOf = async (page, sel) => {
  const loc = page.locator(sel);
  const tag = await loc.evaluate(el => el.tagName);
  return Number(tag === 'INPUT' ? await loc.inputValue() : await loc.textContent());
};

/** Hold `key` and move the mouse `dx` px along a row of the canvas. */
async function dragWith(page, key, dx, { x = 300, y = 300 } = {}) {
  await page.mouse.move(x, y);
  await page.keyboard.down(key);
  // Ten steps: the browser derives movementX from successive positions, and
  // the drag reads movementX, so the sum of the steps is the drag.
  await page.mouse.move(x + dx, y, { steps: 10 });
  await page.keyboard.up(key);
}

test.describe('The formula slot\'s keys', () => {

  test('on a numbered shader, Y and 300 px put Shader Knob 1 at its middle, and Formula Detail stays put', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();

    await pick(page, '0');                                     // 1. Bass Reactive Waves
    await expect(page.locator('#shader-k0')).toBeVisible();    // precondition: the knobs are the slot's bank
    expect(await numberOf(page, '#shader-k0')).toBe(0);

    await dragWith(page, 'y', 300);

    // 600 px is the whole 0 – 1, so 300 px from rest is the middle.
    await expect.poll(() => numberOf(page, '#shader-k0'), { timeout: 5_000 }).toBeCloseTo(0.5, 1);
    const slider = await numberOf(page, '#shader-k0');
    const badge  = await numberOf(page, '#k0v');
    expect(Math.abs(badge - slider), `the badge reads ${badge} beside a slider at ${slider}`).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(await numberOf(page, '#shader-k1'), 'Y moved Knob 2 as well').toBe(0);
    expect(await numberOf(page, '#formula-detail'), 'a knob key moved the hidden Formula Detail').toBe(0.5);

    expect(errors, errors.join(' | ')).toEqual([]);
  });

  test('on a formula, B moves Formula Detail and Y moves nothing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    // Boot is differentialEqs/pendulumNonLinear, a CPU formula: the pair is up.
    await expect(page.locator('#formula-detail')).toBeVisible();
    await expect(page.locator('#shader-k0')).toBeHidden();

    await dragWith(page, 'b', -150, { x: 500 });
    await expect.poll(() => numberOf(page, '#formula-detail'), { timeout: 5_000 }).toBeCloseTo(0.25, 1);
    expect(await numberOf(page, '#fdv')).toBeCloseTo(0.25, 1);

    await dragWith(page, 'y', 300);
    // Give the badge the frame it would need to follow a drag that happened.
    await page.waitForTimeout(250);
    expect(await numberOf(page, '#shader-k0'), 'Y moved Shader Knob 1 while its slider is hidden').toBe(0);
    await expect(page.locator('#k0v')).toHaveText('0.00');

    expect(errors, errors.join(' | ')).toEqual([]);
  });

  test('on a formula, N takes the wheel for Formula Phase', async ({ page }) => {
    // The wheel path, for the two-finger swipe and the plain mouse wheel: the
    // same 600-units-per-sweep rule, and the event is taken from the page.
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    await page.mouse.move(300, 300);

    await page.keyboard.down('n');
    await page.mouse.wheel(150, 0);
    await page.keyboard.up('n');

    await expect.poll(() => numberOf(page, '#formula-phase'), { timeout: 5_000 }).toBeCloseTo(0.25, 1);
    expect(await numberOf(page, '#fpv')).toBeCloseTo(0.25, 1);
  });
});

// ── FIX(review): the second review of the knob keys ──────────────────────────
// K1: any focused <input> stood every hotkey down, and the SHADER MODE picker
// keeps focus after a mouse pick (a readOnly field, on purpose), as a slider
// does after a mouse drag — so the main use of Y U H J, "pick a numbered
// shader, then play its knobs", did nothing until the canvas was clicked.
// K6: a held key and a wheel notch over the picture turned the knob AND zoomed
// the camera, because OrbitControls' listener on the canvas saw the event
// before the drag's did. L2: the hint's boot flash undid an early I.

/** What document.activeElement is, in the terms these tests ask about. */
const focusOf = page => page.evaluate(() => {
  const a = document.activeElement;
  return {
    tag: a?.tagName, id: a?.id || null, type: a?.type ?? null, readOnly: !!a?.readOnly,
    picker: !!(a?.classList?.contains('srch-input') && a.closest('.srch-wrap')?.querySelector('#gpu-sel')),
  };
});

test.describe('The keys right after a pick or a slider drag', () => {

  test('a numbered shader picked through the SHADER MODE list: Y plays Knob 1 at once, the picker still focused', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();

    // The real widget, the way an operator picks: click the field, click the
    // option. The option's mousedown calls preventDefault, which is what keeps
    // the focus in the field.
    const wrap = page.locator('.srch-wrap:has(#gpu-sel)');
    await wrap.locator('.srch-input').click();
    await wrap.locator('.srch-opt[data-value="0"]').click();
    await expect(page.locator('#shader-k0')).toBeVisible();          // the slot swapped to the knobs
    expect(await page.locator('#gpu-sel').inputValue()).toBe('0');
    expect(await focusOf(page), 'precondition: the pick left the SHADER MODE field focused')
      .toMatchObject({ tag: 'INPUT', type: 'text', readOnly: true, picker: true });

    await dragWith(page, 'y', 300);

    await expect.poll(() => numberOf(page, '#shader-k0'), { timeout: 5_000 }).toBeCloseTo(0.5, 1);
    expect(await focusOf(page), 'the test clicked something — the picker is no longer focused')
      .toMatchObject({ picker: true });
    expect(errors, errors.join(' | ')).toEqual([]);
  });

  test('after a mouse drag on Shader Knob 1\'s own slider, H plays Knob 3 with the slider still focused', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    await pick(page, '0');
    const slider = page.locator('#shader-k0');
    await expect(slider).toBeVisible();
    await slider.scrollIntoViewIfNeeded();

    const box = await slider.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, y, { steps: 5 });
    await page.mouse.up();
    expect(await focusOf(page), 'precondition: the drag left the range input focused')
      .toMatchObject({ tag: 'INPUT', id: 'shader-k0', type: 'range' });
    const k0 = await numberOf(page, '#shader-k0');
    expect(k0, 'precondition: the mouse drag moved the slider').toBeGreaterThan(0);

    await dragWith(page, 'h', 300);

    await expect.poll(() => numberOf(page, '#shader-k2'), { timeout: 5_000 }).toBeCloseTo(0.5, 1);
    expect(await numberOf(page, '#shader-k0'), 'H moved the focused slider as well').toBe(k0);
    expect(await focusOf(page)).toMatchObject({ id: 'shader-k0' });
  });

  test('right after a mouse pick in SHADER MODE, Space and → reach the music keys; with the list open, ↓ still steps it', async ({ page }) => {
    // FIX(review RR-LIVE-1): the picker kept Space, ← / →, Home, End and the
    // Page keys after a pick and did nothing with any of them, so main.js stood
    // down and play / pause and the track keys were dead until the canvas was
    // clicked. main.js calls preventDefault for Space and the arrows, so a
    // window listener registered after it — it runs after main.js's, on the
    // same target and phase — reads whether main.js took the key.
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    // With the intro declined the playlist is empty, and Space then asks for a
    // file (audio.togglePlay clicks #audio-file). Taking the chooser here keeps
    // a dialog from opening; it is not what this test measures.
    page.on('filechooser', () => {});
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    await page.evaluate(() => {
      window.__keys = [];
      window.addEventListener('keydown', e => { window.__keys.push({ key: e.key, prevented: e.defaultPrevented }); });
    });
    const taken = async () => {
      const k = await page.evaluate(() => window.__keys.splice(0));
      return Object.fromEntries(k.map(({ key, prevented }) => [key, prevented]));
    };

    const wrap = page.locator('.srch-wrap:has(#gpu-sel)');
    await wrap.locator('.srch-input').click();
    await wrap.locator('.srch-opt[data-value="0"]').click();
    await expect(page.locator('#shader-k0')).toBeVisible();
    expect(await focusOf(page), 'precondition: the pick left the SHADER MODE field focused')
      .toMatchObject({ tag: 'INPUT', readOnly: true, picker: true });
    await expect(wrap, 'precondition: the pick closed the list').not.toHaveClass(/\bopen\b/);
    await taken();

    await page.keyboard.press(' ');
    await page.keyboard.press('ArrowRight');
    expect(await taken(), 'main.js stood down for a key the closed picker does nothing with')
      .toEqual({ ' ': true, ArrowRight: true });
    expect(await page.locator('#gpu-sel').inputValue(), 'Space or → moved the selection').toBe('0');
    expect(await focusOf(page), 'the keys took the focus off the picker').toMatchObject({ picker: true });

    // control — the keys it does read are still its own: open the list again
    // and ↓ steps it one option, the picker calling preventDefault itself.
    await wrap.locator('.srch-input').click();
    await expect(wrap, 'precondition: a click on the field reopened the list').toHaveClass(/\bopen\b/);
    await page.keyboard.press('ArrowDown');
    expect(await taken()).toEqual({ ArrowDown: true });
    await expect.poll(() => page.locator('#gpu-sel').inputValue(), { timeout: 5_000 }).toBe('1');
    await expect(wrap.locator('.srch-opt.active'), 'the open list does not follow the step').toHaveAttribute('data-value', '1');

    expect(errors, errors.join(' | ')).toEqual([]);
  });
});

test.describe('A key event with no key', () => {

  test('raises no error in any key listener — Chrome\'s autofill sends such events', async ({ page }) => {
    // A plain Event of type keydown / keyup carries no `key` at all, which is
    // what Chrome dispatches when an autofill suggestion is accepted. main.js's
    // switch and the drag listeners each called `e.key.toLowerCase()` on it.
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    await page.evaluate(() => {
      for (const type of ['keydown', 'keyup']) document.body.dispatchEvent(new Event(type, { bubbles: true }));
    });
    await page.waitForTimeout(100);
    expect(errors, errors.join(' | ')).toEqual([]);
  });
});

test.describe('The wheel under a held key', () => {

  test.beforeEach(async ({ page }) => {
    // The camera is read from the app's own snapshot, which EXPORT builds with
    // captureState — the engines are not on window. The download itself is
    // dropped: only the blob is wanted.
    await page.addInitScript(() => {
      const make = URL.createObjectURL.bind(URL);
      URL.createObjectURL = obj => { window.__lastExport = obj; return make(obj); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (String(this.download).startsWith('vimathic_state_')) return;
        return click.call(this);
      };
    });
  });

  /** The camera's distance from its orbit target, as EXPORT writes it. */
  const cameraDistance = page => page.evaluate(async () => {
    window.__lastExport = null;
    document.getElementById('btn-export').click();
    const { camera: c } = JSON.parse(await window.__lastExport.text());
    return Math.hypot(c.x - c.tx, c.y - c.ty, c.z - c.tz);
  });

  test('on a numbered shader, Y and the wheel over the picture turn Knob 1 and leave the camera alone; with no key the wheel zooms', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    // RESET ALL parks the camera at a fixed spot with auto-rotate OFF, so the
    // distance moves only when something zooms it.
    await page.$eval('#btn-reset-all', b => b.click());
    await pick(page, '0');
    await expect(page.locator('#shader-k0')).toBeVisible();
    expect(await numberOf(page, '#shader-k0')).toBe(0);

    await page.mouse.move(300, 300);
    expect(await page.evaluate(() => document.elementFromPoint(300, 300)?.tagName),
      'precondition: the wheel goes to the picture, where OrbitControls listens').toBe('CANVAS');
    await page.waitForTimeout(300);
    const before = await cameraDistance(page);

    await page.keyboard.down('y');
    await page.mouse.wheel(0, -300);          // a plain vertical wheel: up is more
    await page.keyboard.up('y');

    await expect.poll(() => numberOf(page, '#shader-k0'), { timeout: 5_000 }).toBeCloseTo(0.5, 1);
    await page.waitForTimeout(300);           // a zoom lands on the next orbit update
    const held = await cameraDistance(page);
    expect(Math.abs(held - before), `the camera moved from ${before} to ${held} under the knob's wheel`).toBeLessThan(1e-3);

    // control — the same notch with no key held is the camera's.
    await page.mouse.wheel(0, -300);
    await expect.poll(() => cameraDistance(page), { timeout: 5_000 }).toBeLessThan(held - 0.05);
    expect(await numberOf(page, '#shader-k0'), 'a wheel with no key held turned the knob').toBeCloseTo(0.5, 1);
  });
});

test.describe('The tap keys that moved', () => {

  test('I toggles the hint and P flashes the beat ring; H and Y do neither any more', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    // The overlay flashes on by itself a second after boot and off three
    // seconds later (controls.js, "Show hotkey hint briefly on load"), so a
    // press inside that window would be judged against a timer. The flash is
    // waited out — observed rather than slept: this records every class
    // change on #hotkey-hint from before the app's own scripts run.
    await page.addInitScript(() => {
      window.__hintLog = [];
      new MutationObserver(records => {
        for (const r of records) {
          if (r.target.id === 'hotkey-hint') window.__hintLog.push(r.target.classList.contains('visible'));
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    await page.waitForFunction(() => window.__hintLog.includes(true) && window.__hintLog.at(-1) === false,
      null, { timeout: 15_000 });

    const hint = page.locator('#hotkey-hint');
    const ring = page.locator('#beat-ring');
    await expect(hint).not.toHaveClass(/\bvisible\b/);
    await expect(ring).not.toHaveClass(/\bflash\b/);           // precondition: no beat has flashed it

    // The old letters. On the boot formula both are knob keys whose sliders
    // are hidden, so they do nothing at all — in particular, not their old taps.
    await page.keyboard.press('h');
    await page.keyboard.press('y');
    await page.waitForTimeout(250);
    await expect(hint, 'H still toggles the hint').not.toHaveClass(/\bvisible\b/);
    await expect(ring, 'Y still fires the glitch punch').not.toHaveClass(/\bflash\b/);

    await page.keyboard.press('i');
    await expect(hint, 'I did not show the hint').toHaveClass(/\bvisible\b/);
    await page.keyboard.press('i');
    await expect(hint, 'a second I did not hide it').not.toHaveClass(/\bvisible\b/);

    await page.keyboard.press('p');
    await expect(ring, 'P did not flash the beat ring').toHaveClass(/\bflash\b/);

    expect(errors, errors.join(' | ')).toEqual([]);
  });

  test('an I pressed before the boot flash shows the hint, and the flash does not take it away', async ({ page }) => {
    // The flash shows the hint 1 s after the panel is bound and hides it 3 s
    // later. Every class change on #hotkey-hint and every I keydown is logged,
    // with its time since navigation, from before the app's own scripts run.
    await page.addInitScript(() => {
      window.__hint = [];
      window.__presses = [];
      new MutationObserver(records => {
        for (const r of records) {
          if (r.target.id === 'hotkey-hint') {
            window.__hint.push({ visible: r.target.classList.contains('visible'), t: performance.now() });
          }
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
      window.addEventListener('keydown', e => {
        if (e.key === 'i') window.__presses.push({ t: performance.now(), flashed: window.__hint.length > 0 });
      }, true);
    });
    // As early as the app can hear a key: main.js has run by DOMContentLoaded.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const hint = page.locator('#hotkey-hint');
    await page.keyboard.press('i');
    // On a slow machine the press can land while the flash is already showing
    // the hint, and then it hides it — the operator's toggle, as it should be.
    // A second press shows it again. Either way the hint is now on by hand.
    if (!(await hint.evaluate(el => el.classList.contains('visible')))) await page.keyboard.press('i');
    await expect(hint, 'I did not show the hint').toHaveClass(/\bvisible\b/);

    const presses = await page.evaluate(() => window.__presses);
    const shownAt = presses.at(-1).t;
    test.info().annotations.push({ type: 'first I', description: presses[0].flashed ? 'during the flash' : 'before the flash' });
    // main.js is a module script, so the panel — and the flash's timers — are
    // bound after the document is parsed and before DOMContentLoaded. The
    // flash's hide therefore fires between domInteractive + 4 s and
    // domContentLoadedEventStart + 4 s.
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return { parsed: n.domInteractive, dcl: n.domContentLoadedEventStart };
    });
    expect(shownAt, 'precondition: the hint was shown before the flash could hide it').toBeLessThan(nav.parsed + 4_000);

    // Past every timer of the flash, and at least the "5 s after load" of the
    // report.
    const after = Math.max(5_000, nav.dcl + 4_500);
    await page.waitForFunction(t => performance.now() > t, after, { timeout: 15_000 });

    await expect(hint, 'the boot flash hid the hint the operator had shown').toHaveClass(/\bvisible\b/);
    const hidden = await page.evaluate(t => window.__hint.filter(h => h.t > t && !h.visible), shownAt);
    expect(hidden, 'something hid the hint after the operator showed it').toEqual([]);
  });
});
