// tests/e2e/clip-camera.spec.js
//
// Camera ownership during clip playback — the browser half of the contract
// unit-tested in tests/clip-player-camera.test.js.
//
// The reported bug: arm the Camera Programmer (AUTO-ROTATE on) while a clip of
// presets is cycling, and it dies at the end of the current step — the next
// preset carries `camera.autoRot: false` and applyState pushes it. The camera
// the user asked for lasted exactly one hold time.
//
// The rule now:
//   • PLAY always starts with the player driving the camera;
//   • taking manual control mid-clip (AUTO-ROTATE, or APPLY in the programmer)
//     makes every later step look-only — colour/shape/formula keep cycling,
//     the camera stays where the user put it;
//   • switching AUTO-ROTATE off hands the camera back.
//
// Everything is observed through the UI the operator sees: #btn-ar's label,
// #clip-status, and #color-sel (proof the presets are still being applied).
// No engine internals are exposed on window, and that is deliberate — a test
// reaching past the DOM would keep passing if the wiring broke.
//
// ── Why the tests set the camera mode to Snap ────────────────────────────────
// The preset's auto-rotate wish is applied in the camera tween's onDone, so
// with a tween the label flips some hundreds of ms INTO the next step — and on
// a GPU-less runner (SwiftShader, single-digit FPS) "some hundreds" is not a
// number a test can pin down, since transitions advance once per rendered
// frame. #clip-cam-mode = "Snap (instant)" takes tweenCameraTo's dur<=0 path,
// which commits synchronously inside applyState: the camera state of a step is
// therefore in place the moment #clip-status names it. The last test keeps the
// tweened path covered on purpose — that is where a claim can land mid-tween.

import { test, expect } from '@playwright/test';
import { revealControl } from './helpers.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────
// A preset is a record { name, state, holdMs }. `state` here is the minimum
// migratePreset() accepts as a snapshot: one PARAM field (colorIdx — visible in
// #color-sel) and a camera block. No shape/gpuSelVal, so a step schedules no
// morph and the only thing moving is the camera.
//
// holdMs lives on the RECORD, not inside state — buildFromPresets reads it
// there, which also means these tests never touch #clip-hold.
const HOLD_MS = 1200;

function preset(name, colorIdx, autoRot, holdMs = HOLD_MS) {
  return {
    name,
    holdMs,
    state: {
      _version: 2,
      colorIdx,
      camera: {
        x: 0, y: 3.2, z: 7.2,
        tx: 0, ty: 0.1, tz: 0,
        fov: 45,
        physics: 'dark_matter',
        autoRot,
      },
    },
  };
}

// One step is hold + the morph allowance _runStep adds to every timer.
const stepMs = (holdMs = HOLD_MS) => holdMs + 1600;
const STEP_MS = stepMs();

/**
 * Boot the app with a seeded preset list. addInitScript runs before any page
 * script, so the list is in place by the time bindClip/_renderPresets read it.
 */
async function boot(page, presets) {
  await page.addInitScript(list => {
    try {
      localStorage.setItem('vimathic_about_seen', '1');   // skip the first-run tour
      localStorage.setItem('vimathic_presets', JSON.stringify(list));
      // A snapshot left by a previous run would be restored over our defaults
      // on boot — including its own camera block.
      localStorage.removeItem('vimathic_persisted_state');
    } catch (_) {}
  }, presets);
  await page.goto('/');
  await page.locator('canvas').waitFor();
  await revealControl(page, '#btn-clip-play');
  await revealControl(page, '#btn-ar');
}

const arBtn      = page => page.locator('#btn-ar');
const clipStatus = page => page.locator('#clip-status');

/** '0' = Snap (camera state committed synchronously), or a tween duration. */
const setCamMode = (page, value) =>
  page.locator('#clip-cam-mode').selectOption(value, { force: true });

/** Wait until the status line reports a different step than `from`. */
async function waitForStepChange(page, from) {
  await expect
    .poll(() => clipStatus(page).innerText(), { timeout: 3 * STEP_MS, intervals: [100] })
    .not.toContain(from);
}

test.describe('Clip player — camera ownership', () => {
  test('AUTO-ROTATE armed mid-clip survives the following presets', async ({ page }) => {
    await boot(page, [preset('cam-a', 13, false), preset('cam-b', 5, false)]);
    await setCamMode(page, '0');

    await page.locator('#btn-clip-play').click();
    await expect(clipStatus(page)).toContainText('[1/2]');

    // The operator switches rotation on mid-clip.
    await arBtn(page).click();
    await expect(arBtn(page)).toHaveText(/AUTO-ROTATE: ON/);

    // Snap mode: cam-b's camera block — `autoRot: false` included — is applied
    // in the same tick that renames the status line. So one boundary is the
    // whole test; the old behaviour is already OFF by the time we look.
    await waitForStepChange(page, '[1/2]');
    await expect(arBtn(page), 'the next preset switched the camera off')
      .toHaveText(/AUTO-ROTATE: ON/, { timeout: 1000 });
    await expect(clipStatus(page)).toContainText('MANUAL');

    // …and the clip itself never stopped doing its job: the second preset's
    // colour scheme is live, so only the CAMERA was left alone.
    await expect(page.locator('#color-sel')).toHaveValue('5');

    // Survive a second boundary too — the flag is not a one-step reprieve.
    await waitForStepChange(page, '[2/2]');
    await expect(arBtn(page)).toHaveText(/AUTO-ROTATE: ON/, { timeout: 1000 });

    await page.locator('#btn-clip-stop').click();
  });

  test('switching AUTO-ROTATE off hands the camera back to the player', async ({ page }) => {
    // cam-b turns auto-rotate ON when it is applied — that is the observable:
    // once the player owns the camera again, the button flips without a click.
    //
    // ── Why the claim comes through the programmer and not through the button ─
    // What this test is FOR is the release. The claim is only its setup, and as
    // setup the AUTO-ROTATE button is the one door that cannot be used safely
    // here: clicking it is a claim only while rotation is OFF, and cam-b turns
    // rotation on by itself, so a step boundary landing inside the click leaves
    // the button already ON and the click spends itself releasing a camera that
    // was never taken. Nothing reports MANUAL and the test fails on a race it is
    // not about.
    //
    // That race was answered twice by widening the margin — the hold went 1.2s,
    // then 8s, so a step would outlast a click. It does not, on a runner slow
    // enough, and slow enough has no upper bound. Measured across the two CI
    // runs of PR #44, same commit for everything Playwright loads, one green and
    // one red: the nineteen tests that pass in both take 637s on the fast
    // machine and 894s on the slow one — 1.40x, every test slower (1.26x to
    // 1.70x) — and the 8s hold that carried the fast run lost three attempts in
    // a row on the slow one.
    //
    // So the claim is made through APPLY in the Camera Programmer instead, which
    // claims unconditionally: there is no pre-state to read, so there is nothing
    // for a boundary to invalidate. AUTO-ROTATE as a WAY IN keeps its coverage
    // in the two tests either side of this one, where every preset carries
    // `autoRot: false` and no boundary can touch the button — race-free by
    // construction rather than by margin.
    //
    // The 8s hold stays: with the claim standing, every later step is look-only,
    // so the readings below cannot be moved by the player — but the release and
    // the assertions after it are still easier to read in a long step.
    const HOLD = 8000;
    await boot(page, [preset('cam-a', 13, false, HOLD), preset('cam-b', 5, true, HOLD)]);
    await setCamMode(page, '0');

    await page.locator('#btn-clip-play').click();
    await expect(clipStatus(page)).toContainText('[1/2]');

    await page.locator('#btn-open-cam-editor').click();
    await page.locator('#ce-btn-apply').click();     // claims; loadScript never touches autoRot
    await expect(clipStatus(page)).toContainText('MANUAL');
    await page.locator('#ce-close').click();

    // From here the label moves only when WE move it: the claim makes every step
    // look-only, so this read cannot be raced however slow the machine is.
    if (!/AUTO-ROTATE: ON/.test(await arBtn(page).innerText())) {
      await arBtn(page).click();                     // rotation on; the claim already stands
      await expect(arBtn(page)).toHaveText(/AUTO-ROTATE: ON/);
    }
    await expect(clipStatus(page), 'turning rotation on must not have disturbed the claim')
      .toContainText('MANUAL');

    // Ride to the start of a fresh step before releasing, so the release and the
    // two assertions after it have a whole step of room. Opening the programmer
    // costs an unknown slice of this one, and a release landing just before a
    // boundary would have cam-b flip the label to ON while the very next line
    // asserts OFF — a product accusation manufactured by timing. This wait is
    // only safe BECAUSE the claim stands: every step is look-only until we
    // release, so crossing a boundary changes nothing we are about to read.
    // Not waitForStepChange(): its budget is built from HOLD_MS and is shorter
    // than one step at this hold.
    const tag = ((await clipStatus(page).innerText()).match(/\[\d+\/\d+\]/) || [''])[0];
    await expect
      .poll(() => clipStatus(page).innerText(),
        { timeout: 3 * stepMs(HOLD), intervals: [100] })
      .not.toContain(tag);
    await expect(clipStatus(page), 'the claim did not survive a step boundary')
      .toContainText('MANUAL');

    await arBtn(page).click();                       // release
    await expect(arBtn(page)).toHaveText(/AUTO-ROTATE: OFF/);
    await expect(clipStatus(page)).not.toContainText('MANUAL');

    // Within two steps cam-b comes round and the player turns rotation on.
    await expect(arBtn(page)).toHaveText(/AUTO-ROTATE: ON/, { timeout: 3 * stepMs(HOLD) });

    await page.locator('#btn-clip-stop').click();
  });

  test('PLAY starts on the player camera logic, whatever the last clip ended on', async ({ page }) => {
    await boot(page, [preset('cam-a', 13, false), preset('cam-b', 5, false)]);
    await setCamMode(page, '0');

    await page.locator('#btn-clip-play').click();
    await arBtn(page).click();
    await expect(arBtn(page)).toHaveText(/AUTO-ROTATE: ON/);
    await expect(clipStatus(page)).toContainText('MANUAL');

    await page.locator('#btn-clip-stop').click();
    await page.locator('#btn-clip-play').click();

    // Fresh clip → the player owns the camera again, so step 1's
    // `autoRot: false` lands and the label goes OFF on its own.
    await expect(clipStatus(page)).not.toContainText('MANUAL');
    await expect(arBtn(page)).toHaveText(/AUTO-ROTATE: OFF/, { timeout: STEP_MS });

    await page.locator('#btn-clip-stop').click();
  });

  test('applying a Camera Programmer script claims the camera too', async ({ page }) => {
    await boot(page, [preset('cam-a', 13, false), preset('cam-b', 5, false)]);
    await setCamMode(page, '0');

    await page.locator('#btn-clip-play').click();
    await expect(clipStatus(page)).toContainText('[1/2]');

    // APPLY in the programmer modal is the other way in — the editor opens
    // pre-filled with the default script, so no typing is needed.
    await page.locator('#btn-open-cam-editor').click();
    await page.locator('#ce-btn-apply').click();
    await expect(clipStatus(page)).toContainText('MANUAL');

    await page.locator('#ce-close').click();
    await waitForStepChange(page, '[1/2]');
    await expect(clipStatus(page)).toContainText('MANUAL');

    await page.locator('#btn-clip-stop').click();
  });

  test('a claim made while the step camera tween is running still wins', async ({ page }) => {
    // The tweened path, where the preset's auto-rotate wish is deferred to the
    // tween's onDone. Those actions are queued BEFORE the click below, so
    // firing them unconditionally would flick the user's rotation back off
    // three seconds into the step. The 3s tween is long enough that the click
    // is certain to land inside it even on a slow runner; the hold is long
    // enough that no step boundary can arrive and confuse the reading — the
    // only thing that could switch the label back off here is the tween.
    const HOLD = 20_000;
    await boot(page, [preset('slow-a', 13, false, HOLD), preset('slow-b', 5, false, HOLD)]);
    await setCamMode(page, '3000');

    await page.locator('#btn-clip-play').click();
    await expect(clipStatus(page)).toContainText('[1/2]');

    await arBtn(page).click();
    await expect(arBtn(page)).toHaveText(/AUTO-ROTATE: ON/);

    // Past the 3s tween, still inside step 1 (4s hold + 1.6s morph).
    await page.waitForTimeout(4000);
    await expect(clipStatus(page)).toContainText('[1/2]');
    await expect(arBtn(page), 'the in-flight tween switched the camera off')
      .toHaveText(/AUTO-ROTATE: ON/, { timeout: 1000 });

    await page.locator('#btn-clip-stop').click();
  });

  test('flipping ♩ BARS → ⏱ SEC mid-clip keeps the Hold(s) value', async ({ page }) => {
    // The controller half of the hold contract, and the only place it is
    // reachable: _startClip's time-base branch is DOM-only. It used to build
    // its steps with a 0 ms sentinel in bars mode ("holdMs unused there"), and
    // _setMode does not rebuild them — so a live switch to seconds left every
    // step with a 0 ms hold while #clip-hold still read its number.
    //
    // No holdMs on the records: the default from buildFromPresets is exactly
    // what is under test. SKIP is what makes it observable — the status line is
    // written by onStep, so without it the reading would have to wait out a
    // 16 s bars step.
    await boot(page, [
      { name: 'hold-a', state: { _version: 2, colorIdx: 13 } },
      { name: 'hold-b', state: { _version: 2, colorIdx: 5  } },
    ]);
    await revealControl(page, '#clip-hold');
    await page.locator('#clip-hold').fill('2');

    await page.locator('#clip-mode-bars').click();
    await page.locator('#btn-clip-play').click();
    await expect(clipStatus(page)).toContainText('bars @');

    await page.locator('#clip-mode-sec').click();
    await page.locator('#btn-clip-skip').click();

    await expect(clipStatus(page), 'the step hold collapsed to 0 ms')
      .toContainText('— 2.0s');
    await expect(clipStatus(page)).not.toContainText('— 0.0s');

    await page.locator('#btn-clip-stop').click();
  });
});
