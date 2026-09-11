// tests/device-class.test.js
//
// The one boolean that decides every performance budget classifies an iPad as
// a touch device.
//
// src/main.js tested the user-agent for /Android|iPhone|iPad|iPod|Mobile/ or a
// viewport under 768 px. Since iPadOS 13, Safari defaults to Request Desktop
// Website and reports a Macintosh UA carrying none of those tokens, and every
// iPad but the mini is 768 px or wider in portrait — so neither half fired and
// `isMobile` was false on the largest touch class the app has.
//
// Downstream that boolean alone decides planeSegs (160 vs 80), RENDER_FRAME_SKIP,
// UNIFORM_INTERVAL, MSAA, the device-pixel-ratio cap — iPads are DPR 2, so the
// backing store came out 2.25× the intended area — the perf tier, the math
// worker throttle, about twenty geometry LOD choices, every transition duration
// and two GPU-budget refusals.
//
// ── How this reads the app ──────────────────────────────────────────────────
// The same technique tests/clock-rate.test.js uses: the declaration is lifted
// out of src/main.js by regexp and executed against a navigator and window this
// file supplies. Nothing is transcribed, so a rewrite of the expression is
// judged on what it computes rather than on how it is spelled. The sensitivity
// controls at the bottom prove the harness can still fail.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

const DECL = (() => {
  const m = /^\s*const\s+isMobile\s*=.*$/m.exec(SRC);
  assert.ok(m, 'declaration of isMobile not found in src/main.js — it must stay on one line, ' +
               'because this file and tests/clock-rate.test.js both lift it out by regexp');
  return m[0].trim();
})();

/** Run the app's own declaration against a device. */
function classify({ ua, width, touchPoints = 0 }, decl = DECL) {
  const fn = new Function('navigator', 'window', `${decl}\nreturn isMobile;`);
  return fn({ userAgent: ua, maxTouchPoints: touchPoints }, { innerWidth: width });
}

// Real user-agent strings. The iPad ones are the two states one device reports
// depending on a Safari setting the user can flip at any time — the same
// hardware, the same budgets needed.
const UA = {
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  ipadMobileMode:  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iphone:          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  androidPhone:    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidTablet:   'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  mac:             'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  windows:         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

describe('an iPad is a touch device however Safari introduces it', () => {

  test('iPadOS in desktop mode — the case that was missed', () => {
    // 820 × 1180 portrait, DPR 2, maxTouchPoints 5. Not one token in the UA.
    assert.equal(classify({ ua: UA.ipadDesktopMode, width: 820, touchPoints: 5 }), true,
      'an iPad in the default Safari configuration is taking the desktop path: ' +
      'planeSegs 160, no frame skip, DPR uncapped at 2, perf tier high');
  });

  test('and in landscape, where it is wider than most laptops report', () => {
    assert.equal(classify({ ua: UA.ipadDesktopMode, width: 1180, touchPoints: 5 }), true);
  });

  test('iPadOS with Request Desktop Website turned off still works', () => {
    // The half that always worked. It must keep working — the UA token is the
    // signal here and maxTouchPoints is not needed.
    assert.equal(classify({ ua: UA.ipadMobileMode, width: 820, touchPoints: 5 }), true);
  });

  test('the two modes of one device agree with each other', () => {
    const desktopMode = classify({ ua: UA.ipadDesktopMode, width: 820, touchPoints: 5 });
    const mobileMode  = classify({ ua: UA.ipadMobileMode,  width: 820, touchPoints: 5 });
    assert.equal(desktopMode, mobileMode,
      'flipping a Safari setting changed the performance budget of the same hardware');
  });
});

describe('phones and tablets keep their budgets', () => {

  test('an iPhone', () => {
    assert.equal(classify({ ua: UA.iphone, width: 393, touchPoints: 5 }), true);
  });

  test('an Android phone', () => {
    assert.equal(classify({ ua: UA.androidPhone, width: 412, touchPoints: 5 }), true);
  });

  test('an Android tablet, which has no Mobile token but says Android', () => {
    assert.equal(classify({ ua: UA.androidTablet, width: 1600, touchPoints: 10 }), true);
  });
});

describe('desktops are not swept in with them', () => {

  test('a Mac reports no touch points and stays a desktop', () => {
    assert.equal(classify({ ua: UA.mac, width: 1512, touchPoints: 0 }), false,
      'a Mac was demoted to the mobile budget — the Macintosh UA is shared with ' +
      'iPadOS, so the touch count is the whole of what separates them');
  });

  test('a Windows laptop with a touchscreen is still a desktop', () => {
    // This is why the touch test is gated on the Macintosh UA. Touch-panel
    // Windows laptops are common and are desktops by every budget here.
    assert.equal(classify({ ua: UA.windows, width: 1920, touchPoints: 10 }), false,
      'a touch-screen Windows laptop was put on the mobile budget');
  });

  test('a Mac with some single-touch input device is still a desktop', () => {
    assert.equal(classify({ ua: UA.mac, width: 1512, touchPoints: 1 }), false);
  });

  test('control — a narrow window is still treated as mobile, as before', () => {
    // Pre-existing behaviour, deliberately unchanged: the width fallback is
    // what tests/clock-rate.test.js documents as making a desktop in a narrow
    // window take the mobile path for the whole session.
    assert.equal(classify({ ua: UA.mac, width: 700, touchPoints: 0 }), true);
  });
});

describe('the harness can still fail', () => {

  test('the previous expression fails the iPad rows', () => {
    // If this stops failing, the fix has been reverted or the classifier is no
    // longer being executed, and every green assertion above is worthless.
    const OLD = "const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;";
    assert.equal(classify({ ua: UA.ipadDesktopMode, width: 820, touchPoints: 5 }, OLD), false,
      'the historical expression no longer reproduces the bug — this harness is ' +
      'not measuring what it claims to measure');
  });

  test('the previous expression still agreed on everything else', () => {
    const OLD = "const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;";
    for (const [name, dev] of Object.entries({
      iphone:  { ua: UA.iphone,        width: 393,  touchPoints: 5 },
      android: { ua: UA.androidPhone,  width: 412,  touchPoints: 5 },
      mac:     { ua: UA.mac,           width: 1512, touchPoints: 0 },
      windows: { ua: UA.windows,       width: 1920, touchPoints: 10 },
      narrow:  { ua: UA.mac,           width: 700,  touchPoints: 0 },
    })) {
      assert.equal(classify(dev), classify(dev, OLD),
        `the fix changed how ${name} is classified; it was meant to change iPads only`);
    }
  });
});
