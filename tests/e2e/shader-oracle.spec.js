// tests/e2e/shader-oracle.spec.js
//
// The instrument this subsystem did not have: something that COMPILES the
// shader editor's programs.
//
// ── Why it had to exist ─────────────────────────────────────────────────────
// Measured, not assumed. An undeclared identifier plus a missing semicolon
// injected into SE_FS_TEMPLATE passes `npm test` (1696 tests, 0 failures) and
// `npm run build` (exit 0), because tests/gpu-shape-y.test.js says it outright
// at its own head — "There is no GLSL compiler in this environment" — and the
// 31 e2e tests never open #shader-editor-overlay. tests/e2e/smoke.spec.js and
// particle-styles.spec.js do catch a broken BUILT-IN program, through three.js's
// console.error on a link failure, but the editor's two scaffolds are assembled
// only inside ShaderEditor#compileAndApply, which nothing called.
//
// So the four defects fixed in a8c6d21 — all of them a rewriter emitting GLSL
// that cannot compile — were invisible to 137 assertions written specifically
// about that rewriter. They were regexes over source text. This is not.
//
// ── Why through the UI rather than through a headless compiler ──────────────
// A glslangValidator or headless-gl dependency would check the SYNTAX of a
// string this test file assembled itself. Driving APPLY compiles the program
// the product actually assembles, through the real templates, on the real
// driver, and links it — locally that is ANGLE/D3D11, in CI SwiftShader. It
// costs a browser and buys the whole path.
//
// The control at the bottom is not decoration: without it every assertion here
// would also pass on a page where APPLY does nothing at all.

import { test, expect } from '@playwright/test';
import { revealControl } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('vimathic_about_seen', '1'); } catch (_) {}
  });
});

const RED = 'rgb(255, 102, 102)';           // #f66 — the failure colour

/** Open the editor the way an operator does: expand ADVANCED, then the button. */
async function openEditor(page) {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await revealControl(page, '#btn-open-editor');
  await page.locator('#btn-open-editor').click();
  await expect(page.locator('#shader-editor-overlay')).toHaveClass(/open/);
  await expect(page.locator('#se-code')).toBeVisible();
}

/**
 * Press APPLY and read the verdict AT ONCE.
 *
 * Read rather than awaited on purpose: the success message clears itself after
 * two seconds (ten after the amber warning), so an expect() that polls could
 * arrive at a blank line and call it a pass. A failure has no timer — it stays
 * until the next APPLY — so the direction of any race here is safe, and the
 * positive assertion on the tick is what makes the pass mean something.
 */
async function apply(page) {
  await page.locator('#se-btn-apply').click();
  return page.evaluate(() => {
    const el = document.getElementById('se-error');
    return {
      text: el.textContent,
      colour: getComputedStyle(el).color,
      errLines: document.querySelectorAll('#se-line-nums .ln-err').length,
    };
  });
}

const compiled = (v, what) => {
  expect(v.colour, `${what}: the driver rejected it — "${v.text}"`).not.toBe(RED);
  expect(v.text, `${what}: APPLY reported nothing, so nothing was compiled`)
    .toMatch(/^[✔⚠] Compiled/);
  expect(v.errLines, `${what}: a line was marked in the gutter`).toBe(0);
};

test.describe('everything the editor ships compiles on a real driver', () => {

  test('all eight gallery presets link', async ({ page }) => {
    await openEditor(page);
    const buttons = page.locator('#se-preset-wrap .se-preset');
    const n = await buttons.count();
    expect(n, 'the preset gallery is empty').toBeGreaterThanOrEqual(8);

    for (let i = 0; i < n; i++) {
      const name = await buttons.nth(i).textContent();
      await buttons.nth(i).click();
      compiled(await apply(page), `preset ${name}`);
    }
  });

  test('both shipped default bodies link, on the tab each belongs to', async ({ page }) => {
    await openEditor(page);
    // RESET puts the defaults back into both buffers and the built-in program
    // back on screen, which is the state a first-time visitor opens.
    await page.locator('#se-btn-reset').click();

    await page.locator('.se-tab[data-tab="vert"]').click();
    compiled(await apply(page), 'the default vertex body');

    await page.locator('.se-tab[data-tab="frag"]').click();
    compiled(await apply(page), 'the default fragment body');
  });
});

test.describe('nothing TIDY emits is rejected by the driver', () => {

  // Every entry is written the way this codebase writes GLSL — `.5`, `8.`,
  // spelled-out audio names, a caret for a power — and the first six are the
  // exact shapes that used to come back out of TIDY as text no driver accepts.
  const CORPUS = [
    ['vert', 'a leading-dot float under a power', 'y = .5^2 * sin(r*8. + T) * a;'],
    ['vert', 'a trailing-dot float as an exponent', 'y = sin(r*8. + T)^2. * a;'],
    ['vert', 'a local the body declares itself',   'float time = T*2.0;\ny = sin(r*8. + time)*a;'],
    ['vert', 'an int used where no type is named', 'int n = 3;\nn = n + 2;\ny = float(n)*0.02;'],
    ['vert', 'an integer vector constructor',      'ivec2 q = ivec2(1, 2);\ny = float(q.x)*0.05;'],
    ['vert', 'a negative base raised to a power',  'y = sin(r)^2 + cos(r)^2;'],
    ['vert', 'bare integers as operands',          'y = sin(r * 8 + T) * (0.2 + b * 0.8) * a;'],
    ['vert', 'the spelled-out audio names',        'y = bass * amp * 0.3 + sin(r*8. + time)*0.2;'],
    ['vert', 'a name table entry under a power',   'y = spectrum(r)^2 * bass * a;'],
    ['vert', 'a for loop with an int counter',     'float s = 0.;\nfor (int i = 0; i < 4; i++) { s += sin(r*float(i)*3. + T); }\ny = s*0.1*a;'],
    ['frag', 'the fragment names and a power',     'c = getColor(uCM, t) * (0.5 + bass) + vec3(treble^2 * 0.2);'],
    ['frag', 'a palette called by name',           'c = lava(t) * (0.7 + bass*0.5);'],
  ];

  for (const [tab, what, body] of CORPUS) {
    test(`${tab}: ${what}`, async ({ page }) => {
      await openEditor(page);
      await page.locator(`.se-tab[data-tab="${tab}"]`).click();
      await page.locator('#se-code').fill(body);

      await page.locator('#se-btn-tidy').click();
      // TIDY writes through the selection so the undo stack survives; what
      // matters here is only that the buffer changed into something.
      const tidied = await page.locator('#se-code').inputValue();
      expect(tidied.length, 'TIDY emptied the buffer').toBeGreaterThan(0);

      compiled(await apply(page), `${what} — TIDY produced:\n${tidied}`);
    });
  }
});

test.describe('the oracle can fail', () => {

  // Without this, every assertion above would also pass on a page where APPLY
  // is a no-op, the status line never changes, or the editor never opened.
  test('a body the driver cannot compile is reported red, with the line', async ({ page }) => {
    await openEditor(page);
    await page.locator('.se-tab[data-tab="vert"]').click();
    await page.locator('#se-code').fill('y = 1.0;\ny = notADeclaredName * 2.0\ny = 2.0;');

    const v = await apply(page);
    expect(v.colour, 'a program with an undeclared name and a missing semicolon was accepted')
      .toBe(RED);
    expect(v.text).not.toMatch(/^✔/);
    expect(v.errLines, 'the failing line was not marked in the gutter').toBeGreaterThan(0);
  });

  test('and the previous program stays live after a failure', async ({ page }) => {
    // compileAndApply's contract: a failed probe leaves what was on screen
    // alone. If this ever stops holding, a typo blanks the projector.
    await openEditor(page);
    await page.locator('.se-tab[data-tab="vert"]').click();
    await page.locator('#se-code').fill('y = sin(r*8. + T)*a;');
    compiled(await apply(page), 'a body that does compile');

    await page.locator('#se-code').fill('y = still not glsl;');
    const bad = await apply(page);
    expect(bad.colour).toBe(RED);

    await expect(page.locator('canvas')).toBeVisible();
    await page.locator('#se-close').click();
    await expect(page.locator('#shader-editor-overlay')).not.toHaveClass(/open/);
  });
});
