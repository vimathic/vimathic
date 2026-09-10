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
    const log = window.__seLog ?? [];
    const said = log.find(e => e.text.trim());
    return {
      // `mutated` is what stops the fallback from reading the PREVIOUS apply's
      // message off the screen: compileAndApply blanks #se-error before it says
      // anything, so a press that reaches it always mutates. No mutation means
      // the button did nothing, and every assertion below has to fail rather
      // than inherit the last verdict, which within the two-second window would
      // still be a green tick.
      mutated: log.length > 0,
      text:   said?.text   ?? el.textContent,
      colour: said?.colour ?? getComputedStyle(el).color,
      errLines: document.querySelectorAll('#se-line-nums .ln-err').length,
    };
  });
}

const compiled = (v, what) => {
  expect(v.mutated, `${what}: APPLY changed nothing on screen — the button did not run`).toBe(true);
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

    // Tie each verdict to the body it is about. Without this the loop passes
    // while the SAME text is compiled n times — a preset button that failed to
    // fill the box would leave the previous entry's code in it and every
    // assertion would still be green.
    const seenBodies = new Set();
    for (let i = 0; i < n; i++) {
      const name = await buttons.nth(i).textContent();
      await buttons.nth(i).click();
      const body = await page.locator('#se-code').inputValue();
      expect(body.length, `preset ${name}: clicking it left the editor empty`).toBeGreaterThan(0);
      expect(seenBodies.has(body), `preset ${name}: the box still holds a previous preset's body`)
        .toBe(false);
      seenBodies.add(body);
      compiled(await apply(page), `preset ${name} — body:\n${body}`);
    }
    expect(seenBodies.size, 'the gallery compiled fewer distinct bodies than it has buttons').toBe(n);
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
  // Two groups, and the split is the point. REWRITES are bodies TIDY must
  // change — what the driver then compiles is what TIDY emitted, which is the
  // thing that used to be invalid. UNTOUCHED are bodies it must decline, and
  // they are here because every one of them is a protection that a review found
  // TIDY losing: a comment above a declaration blinded the name view entirely,
  // and a declarator list with initialisers registered only its first name.
  // "Nothing to tidy" is the assertion for those, and it is not a weaker one.
  const REWRITES = [
    ['vert', 'a leading-dot float under a power', 'y = .5^2 * sin(r*8. + T) * a;'],
    ['vert', 'a trailing-dot float as an exponent', 'y = sin(r*8. + T)^2. * a;'],
    ['vert', 'a negative base raised to a power',  'y = sin(r)^2 + cos(r)^2;'],
    ['vert', 'bare integers as operands',          'y = sin(r * 8 + T) * (0.2 + b * 0.8) * a;'],
    ['vert', 'the spelled-out audio names',        'y = bass * amp * 0.3 + sin(r*8. + time)*0.2;'],
    ['vert', 'a name table entry under a power',   'y = spectrum(r)^2 * bass * a;'],
    ['vert', 'a member of a call result, raised',  'y = normalize(pos).x^2 * a;'],
    ['frag', 'the fragment names and a power',     'c = getColor(uCM, t) * (0.5 + bass) + vec3(treble^2 * 0.2);'],
    ['frag', 'a palette called by name',           'c = lava(t) * (0.7 + bass*0.5);'],
    ['frag', 'the crossfading palette lookup',     'c = paletteAt(t) * (0.8 + bass*0.4);'],
    ['frag', 'a body that reads the SURF light',   'c = paletteAt(fract(t + time*0.05)) * (1.0 + treble^2);'],
  ];
  const UNTOUCHED = [
    ['vert', 'a local the body declares itself',   'float time = T*2.0;\ny = sin(r*8. + time)*a;'],
    ['vert', 'a declarator list with initialisers', 'float base = 0.2, time = T*0.5;\ny = sin(r*8. + time)*base*a;'],
    ['vert', 'an int used where no type is named', 'int n = 3;\nn = n + 2;\ny = float(n)*0.02;'],
    ['vert', 'an int declared under a comment',    '// how many ripples\nint rings = 3;\nrings = rings + 2;\ny = sin(r*float(rings))*a;'],
    ['vert', 'an integer vector constructor',      'ivec2 q = ivec2(1, 2);\ny = float(q.x)*0.05;'],
    ['vert', 'a for loop with an int counter',     'float s = 0.;\nfor (int i = 0; i < 4; i++) { s += sin(r*float(i)*3. + T); }\ny = s*0.1*a;'],
    ['vert', 'a caret whose operand is in a comment', 'y = sin(r*8. + T) // the ripple\n  * a;'],
  ];

  for (const [tab, what, body] of UNTOUCHED) {
    test(`${tab}: ${what} — TIDY declines, and it still compiles`, async ({ page }) => {
      await openEditor(page);
      await page.locator(`.se-tab[data-tab="${tab}"]`).click();
      await page.locator('#se-code').fill(body);

      await page.locator('#se-btn-tidy').click();
      await expect(page.locator('#se-error'),
        `${what}: TIDY rewrote a body it must leave alone`).toHaveText(/Nothing to tidy/);
      expect(await page.locator('#se-code').inputValue(),
        `${what}: the buffer changed while the status said nothing was tidied`).toBe(body);

      compiled(await apply(page), `${what} — untouched:\n${body}`);
    });
  }

  for (const [tab, what, body] of REWRITES) {
    test(`${tab}: ${what}`, async ({ page }) => {
      await openEditor(page);
      await page.locator(`.se-tab[data-tab="${tab}"]`).click();
      await page.locator('#se-code').fill(body);

      await page.locator('#se-btn-tidy').click();
      // The corpus exists to compile what TIDY EMITS, so an entry TIDY declines
      // to touch is testing nothing. Assert it actually rewrote something —
      // otherwise the raw body is what reaches the driver and the entry has
      // quietly stopped being about the rewriter at all.
      await expect(page.locator('#se-error'),
        `${what}: TIDY had nothing to say, so this entry never exercised it`)
        .toHaveText(/Tidied/);
      const tidied = await page.locator('#se-code').inputValue();
      expect(tidied.length, 'TIDY emptied the buffer').toBeGreaterThan(0);
      expect(tidied, 'TIDY reported a change it did not make').not.toBe(body);

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

    // And the shader really is the custom one. NOT `/uK0/`: the shipped default
    // body reads a knob too since 89de1ba, so that pattern no longer tells the
    // example apart from the text the editor opens with. `float freq` is in the
    // knob body and nowhere else.
    await revealControl(page, '#btn-open-editor');
    await page.locator('#btn-open-editor').click();
    await expect(page.locator('#se-code')).toHaveValue(/float freq\s*=/);
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

    // The assertion that means something: the editor is still usable and still
    // compiles afterwards. A failed probe that had torn down the live program —
    // or the context — would not get here. (The earlier version of this test
    // stopped at "the canvas is visible", which is true of a dead canvas too.)
    await page.locator('#se-code').fill('y = cos(r*4. + T)*a;');
    compiled(await apply(page), 'a good body after a failed one');

    await page.locator('#se-close').click();
    await expect(page.locator('#shader-editor-overlay')).not.toHaveClass(/open/);
  });
});
