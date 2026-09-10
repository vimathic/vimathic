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
 * Press APPLY and read the verdict the editor WROTE, not the one still on
 * screen when the assertion happens to arrive.
 *
 * The first version of this read #se-error straight after the click, reasoning
 * that a round-trip is far inside the two seconds before the success message
 * clears itself. Under `fullyParallel` with several WebGL contexts on one
 * machine that stopped being true — the whole-suite run failed here while the
 * same test passed alone, which is the signature of a race and not of a bug in
 * the product.
 *
 * So the status line is recorded as it changes and the first non-empty entry is
 * the verdict. That is immune to the timer entirely, and it also removes the
 * reason the old comment gave for not using a polling expect().
 */
async function apply(page) {
  await page.evaluate(() => {
    const el = document.getElementById('se-error');
    window.__seLog = [];
    window.__seObs?.disconnect();
    window.__seObs = new MutationObserver(() => {
      window.__seLog.push({ text: el.textContent, colour: getComputedStyle(el).color });
    });
    window.__seObs.observe(el, { childList: true, characterData: true, subtree: true });
  });
  await page.locator('#se-btn-apply').click();
  return page.evaluate(() => {
    const el = document.getElementById('se-error');
    const said = (window.__seLog ?? []).find(e => e.text.trim());
    return {
      // The fallback covers the case where nothing mutated at all — which is a
      // failure of this test's premise and shows up as an empty `text`.
      text:   said?.text   ?? el.textContent,
      colour: said?.colour ?? getComputedStyle(el).color,
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
    ['frag', 'the crossfading palette lookup',     'c = paletteAt(t) * (0.8 + bass*0.4);'],
    ['frag', 'a body that reads the SURF light',   'c = paletteAt(fract(t + time*0.05)) * (1.0 + treble^2);'],
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

test.describe('the shipped example arrives without anyone opening the editor', () => {

  // The reach half of the same problem. Everything above happens inside a modal
  // three clicks deep; this is the one path by which an operator who will never
  // write GLSL meets a custom shader at all. It is also the only end-to-end
  // check that the seed is actually wired into boot — controls.js calls it
  // optional-chained, because bindControls runs against partial stubs in the
  // unit tests, and an optional call that resolves to nothing fails silently.
  test('a fresh profile finds it in the preset list, and loading it goes live', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    await revealControl(page, '#preset-list');

    const row = page.locator('#preset-list .preset-load-btn', { hasText: 'Knobs' });
    await expect(row, 'a browser that has never been here shows no example preset').toHaveCount(1);

    await row.click();
    // A numbered GPU shader, not a formula — otherwise the vertex body is
    // discarded and the example loads to no visible change.
    await expect(page.locator('#gpu-sel')).toHaveValue(/^\d+$/);
    // The knobs the bodies were written around arrive with it.
    await expect(page.locator('#shader-k0')).not.toHaveValue('0');
    await expect(page.locator('#k0v')).not.toHaveText('0.00');

    // And the shader really is the custom one: open the editor and read it.
    await revealControl(page, '#btn-open-editor');
    await page.locator('#btn-open-editor').click();
    await expect(page.locator('#se-code')).toHaveValue(/uK0/);
    compiled(await apply(page), 'the factory example, re-applied');
  });

  test('and deleting it means deleted — it does not come back on the next load', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible();
    await revealControl(page, '#preset-list');
    await expect(page.locator('#preset-list .preset-load-btn', { hasText: 'Knobs' })).toHaveCount(1);

    // Delete through storage rather than through the ✕ button and its confirm:
    // what is under test is the SEED's gate, not the delete dialog. An empty
    // list is the state the gate has to read as a decision.
    await page.evaluate(() => localStorage.setItem('vimathic_presets', '[]'));
    await page.reload();
    await expect(page.locator('canvas')).toBeVisible();
    await revealControl(page, '#preset-list');
    await expect(page.locator('#preset-list .preset-load-btn', { hasText: 'Knobs' }),
      'the example was seeded again over a deletion').toHaveCount(0);
  });
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
