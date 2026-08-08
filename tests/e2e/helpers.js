// tests/e2e/helpers.js
//
// Shared helpers for the Playwright specs. Not named *.spec.js on purpose —
// playwright.config.js picks up test files by that suffix, so this module is
// imported, never collected as a suite.

import { expect } from '@playwright/test';

// ── Progressive disclosure: expand the <details> hiding a control ────────────
// Everything below RESET ALL lives inside <details class="adv-section">, which
// ships collapsed, and five <details class="adv-sub"> nest inside it (MODEL
// IMPORT, SHADER EDITOR, CAMERA PROGRAMMER, VIDEO OUTPUT & AUDIO IN, MIDI
// MAPPING). A collapsed <details> gives its content no layout box, so
// Playwright's actionability check reports `element is not visible` and the
// click times out — that is what used to fail the Modals and Presets specs on
// #preset-name, #btn-open-cam-editor and #btn-open-output.
//
// The collapse is deliberate UX, not a bug, so the fix belongs in the test:
// expand the panel the way an operator does, then interact.
//
// Why a click on <summary> rather than `d.open = true`:
//   • It exercises the real toggle path (native <summary> activation), so a
//     future regression that puts an overlay over the panel fails loudly here
//     instead of being papered over by a property write.
//   • It cannot deadlock on its own visibility rule — a <summary> keeps its
//     layout box while its <details> is shut; only the *content* is hidden.
//     That is exactly why the outer→inner order below matters: a nested
//     <summary> IS inside the outer content, so it only becomes clickable
//     after the outer <details> is open.
// If this ever turns flaky (an animated panel, a scroll-into-view race), the
// safe fallback is `await d.evaluate(el => { el.open = true; })` in place of
// the click — the `open` assertion after it stays valid either way.
//
// @param {import('@playwright/test').Page} page
// @param {string} selector  CSS selector of the control that must end up visible
export async function revealControl(page, selector) {
  for (const wrapper of ['details.adv-section', 'details.adv-sub']) {
    const d = page.locator(`${wrapper}:has(${selector})`);
    if (await d.count() === 0) continue;             // not nested in this level
    if (await d.evaluate(el => el.open)) continue;    // already expanded
    // The first <summary> in document order inside `d` is its own label; the
    // nested adv-sub summaries come later in the subtree.
    await d.locator('summary').first().click();
    await expect(d).toHaveJSProperty('open', true);
  }
  await expect(page.locator(selector)).toBeVisible();
}
