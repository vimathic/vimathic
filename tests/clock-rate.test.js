// tests/clock-rate.test.js
//
// FIX(#50). The formula clock must run at 0.48 units per real second on every
// device path and at every display refresh rate.
//
// Run:
//   node --test tests/clock-rate.test.js
//
// ── What this guards ────────────────────────────────────────────────────────
// Until FIX(#50), main.js advanced `time += 0.008` per RENDERED frame, after
// the RENDER_FRAME_SKIP gate, so formula time was a multiple of the render
// rate: 0.24 units/s on the mobile path at 60 Hz, 0.48 on a 60 Hz desktop,
// 1.152 at 144 Hz — a ×9.6 spread across reachable configurations. And
// `isMobile` includes `window.innerWidth < 768` evaluated once at load, so a
// desktop opened in a narrow window sat at half speed for the whole session.
//
// ── How it guards ───────────────────────────────────────────────────────────
// It does not assert that main.js contains a particular sentence. It cuts the
// real text of animate() out of src/main.js (balanced-brace scan that skips
// comments and strings), computes isMobile / RENDER_FRAME_SKIP from their own
// declarations in that file, executes the body under a virtual
// performance.now(), and measures units of `time` per virtual second. Rewrites
// that keep the clock at 0.48 units/s pass; anything that re-couples it to the
// render rate fails the parity matrix below — including a plausible "cleanup"
// of the dt cap from 0.05·RENDER_FRAME_SKIP to a bare 0.05, which shaves 25 %
// off the mobile path at 30 Hz and is caught by the (phone, 30 Hz) cell.
//
// The probe proves its own sensitivity: re-injecting the historical
// `time += 0.008` into the same harness MUST reproduce the old spread, and
// doubling the rate constant MUST read as exactly ×2. If those controls stop
// failing-when-they-should, the harness is measuring something else and every
// green cell above it is worthless.

import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

// ── Extraction: the real animate(), not a transcription ─────────────────────

function extractBalanced(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
  }
  throw new Error('unbalanced braces while extracting animate()');
}

const animStart = SRC.indexOf('function animate() {');
assert.ok(animStart >= 0, 'function animate() not found in src/main.js');
const ANIMATE_SRC = 'function animate() ' + extractBalanced(SRC, SRC.indexOf('{', animStart));

// If the source stops carrying the gate, the increment, or the frame stamp,
// this file must fail loudly here — not pass vacuously below.
assert.ok(/renderFrameCounter\s*%\s*RENDER_FRAME_SKIP\s*!==\s*0\)\s*return/.test(ANIMATE_SRC),
  'extracted animate() has no render-rate gate — harness assumptions are stale');
assert.ok(/time\s*\+=/.test(ANIMATE_SRC),
  'extracted animate() does not advance the clock — harness assumptions are stale');
assert.ok(/lastFrameT/.test(ANIMATE_SRC),
  'extracted animate() has no frame stamp — FIX(#50) has been rewritten, update this guard');

// isMobile / RENDER_FRAME_SKIP / UNIFORM_INTERVAL from their own declarations,
// so window width and UA are judged by the same code the app ships.
const declOf = (name) => {
  const m = new RegExp('^\\s*const\\s+' + name + '\\s*=.*$', 'm').exec(SRC);
  assert.ok(m, 'declaration of ' + name + ' not found in src/main.js');
  return m[0].trim();
};
function deviceConfig({ ua, width }) {
  const fn = new Function('navigator', 'window', `
    ${declOf('isMobile')}
    ${declOf('RENDER_FRAME_SKIP')}
    ${declOf('UNIFORM_INTERVAL')}
    return { RENDER_FRAME_SKIP, UNIFORM_INTERVAL };
  `);
  return fn({ userAgent: ua }, { innerWidth: width });
}

// ── Harness: virtual clock, counting stubs ──────────────────────────────────

function makeStub() {
  const target = function () {};
  return new Proxy(target, {
    get(_t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (typeof k === 'symbol') return undefined;
      return makeStub();
    },
    set() { return true; },
    apply() { return makeStub(); },
  });
}

// Returns { env, step(frameMs) } so tests can drive frames, jump the clock and
// toggle isFrozen mid-run. `dev` is the object deviceConfig() returns.
function makeAnimate(animateSrc, dev) {
  let vnow = 1000;
  const env = {
    time: 0,
    frames: 0,
    lastT: vnow,
    lastFrameT: vnow,
    lastUniformUpdate: 0,
    renderFrameCounter: 0,
    isFrozen: false,
    RENDER_FRAME_SKIP: dev.RENDER_FRAME_SKIP,
    UNIFORM_INTERVAL: dev.UNIFORM_INTERVAL,
    performance: { now: () => vnow },
    requestAnimationFrame: () => {},
    Math,
    // Branch predicates set explicitly: the universal stub is truthy and would
    // steer the frame into the script-driving branch.
    camera: {
      estimatedBpm: 0,
      autoRot: true, userInt: false, tweenHold: false,
      isScriptDriving: () => false,
      updatePhysics: () => {}, updatePlayhead: () => {}, applyRoll: () => {},
      setElapsedForKeyframe: () => {}, runScript: () => {},
    },
    DOM: { fps: {}, camEditorOverlay: { classList: { contains: () => false } } },
  };
  for (const n of ['render', 'audio', 'mathViz', 'output']) env[n] = makeStub();

  const scope = new Proxy(env, {
    has: (_t, k) => k !== Symbol.unscopables,
    get(t, k) {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      return makeStub();
    },
    set(t, k, v) { t[k] = v; return true; },
  });

  const animate = new Function('scope', `with (scope) { ${animateSrc}; return animate; }`)(scope);
  return {
    env,
    step: (frameMs) => { animate(); vnow += frameMs; },
    sleep: (ms) => { vnow += ms; },        // the clock moves, no frame runs
  };
}

function rate(animateSrc, dev, hz, seconds = 10) {
  const { env, step } = makeAnimate(animateSrc, dev);
  const ticks = Math.round(hz * seconds);
  for (let i = 0; i < ticks; i++) step(1000 / hz);
  return env.time / seconds;
}

const UA_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const UA_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';
const CONFIGS = [
  { label: 'desktop, window 1920', ua: UA_DESKTOP, width: 1920 },
  { label: 'desktop, window 700',  ua: UA_DESKTOP, width: 700 },
  { label: 'phone UA, width 412',  ua: UA_PHONE,   width: 412 },
];
const REFRESH = [30, 60, 120, 144];
const UNITS_PER_SECOND = 0.48;

// ── The guard ───────────────────────────────────────────────────────────────

describe('formula clock parity (FIX(#50))', () => {
  const matrix = [];
  before(() => {
    for (const cfg of CONFIGS) {
      const dev = deviceConfig(cfg);
      for (const hz of REFRESH) {
        matrix.push({ label: `${cfg.label} @ ${hz} Hz (skip ${dev.RENDER_FRAME_SKIP})`, r: rate(ANIMATE_SRC, dev, hz) });
      }
    }
  });

  test('the clock runs at 0.48 units per second in every cell', () => {
    for (const { label, r } of matrix) {
      // 0.01 absolute: the first counted frame contributes the 1e-4 floor
      // instead of a full interval, which reads 0.478 over a 10 s run.
      assert.ok(Math.abs(r - UNITS_PER_SECOND) < 0.01, `${label}: ${r.toFixed(4)} units/s, expected ${UNITS_PER_SECOND}`);
    }
  });

  test('no cell differs from another by more than 1 %', () => {
    const rs = matrix.map(m => m.r);
    const hi = Math.max(...rs), lo = Math.min(...rs);
    assert.ok(hi / lo < 1.01, `spread ×${(hi / lo).toFixed(3)} across configurations — the clock is coupled to the render rate again`);
  });
});

describe('freeze and clock edges (FIX(#50) + FIX(#8))', () => {
  const dev = deviceConfig(CONFIGS[0]);

  test('STOP MOTION is an exact hold, and resume steps by one frame, not by the freeze', () => {
    const { env, step } = makeAnimate(ANIMATE_SRC, dev);
    for (let i = 0; i < 60; i++) step(1000 / 60);
    const frozenAt = env.time;
    env.isFrozen = true;
    for (let i = 0; i < 120; i++) step(1000 / 60);
    assert.ok(env.time === frozenAt, `clock moved under freeze: ${frozenAt} → ${env.time}`);
    env.isFrozen = false;
    step(1000 / 60);
    const resumed = env.time - frozenAt;
    // If lastFrameT were stamped only on unfrozen frames, this step would span
    // the whole 2 s freeze (capped: 0.05 · 0.48 = 0.024), not one frame.
    assert.ok(Math.abs(resumed - (1000 / 60 / 1000) * UNITS_PER_SECOND) < 1e-9,
      `first unfrozen frame advanced ${resumed.toFixed(6)}, expected one frame's worth ${(0.48 / 60).toFixed(6)}`);
  });

  test('a backgrounded tab hands back one capped step, not the whole absence', () => {
    for (const cfg of [CONFIGS[0], CONFIGS[2]]) {
      const dev2 = deviceConfig(cfg);
      const { env, step, sleep } = makeAnimate(ANIMATE_SRC, dev2);
      const warmup = 4 * dev2.RENDER_FRAME_SKIP;
      for (let i = 0; i < warmup; i++) step(1000 / 60);
      const before10s = env.time;
      sleep(10_000);                                   // the tab goes to sleep
      // Exactly one counted frame lands in this window (skip − 1 are gated).
      for (let i = 0; i < dev2.RENDER_FRAME_SKIP; i++) step(1000 / 60);
      const jump = env.time - before10s;
      const cap = 0.05 * dev2.RENDER_FRAME_SKIP * UNITS_PER_SECOND;
      assert.ok(jump <= cap + 1e-9, `${cfg.label}: 10 s gap advanced the clock ${jump.toFixed(4)}, cap is ${cap.toFixed(4)}`);
      assert.ok(jump > 0.9 * cap, `${cfg.label}: 10 s gap advanced the clock only ${jump.toFixed(4)} — the counted frame never landed, the probe is not measuring the cap`);
    }
  });

  test('dt = 0 (coarsened performance.now) does not mute the clock', () => {
    const { env, step } = makeAnimate(ANIMATE_SRC, dev);
    step(1000 / 60);
    const t1 = env.time;
    step(0); step(0);                                  // two frames, same timestamp
    assert.ok(env.time > t1, 'clock stalled on dt = 0 — the 1e-4 floor is gone');
  });
});

// ── Sensitivity: the probe must be able to fail ─────────────────────────────

describe('probe sensitivity (the controls that make the green above worth anything)', () => {
  const RATE_RE = /time\s*\+=\s*dt\s*\*\s*0\.48/;

  test('re-injecting the historical fixed step reproduces the ×9.6-class spread', () => {
    const mutant = ANIMATE_SRC.replace(RATE_RE, 'time += 0.008');
    assert.ok(mutant !== ANIMATE_SRC, 'mutation did not apply — RATE_RE is stale, fix the control');
    const phone60 = rate(mutant, deviceConfig(CONFIGS[2]), 60);
    const desk144 = rate(mutant, deviceConfig(CONFIGS[0]), 144);
    assert.ok(phone60 < 0.3, `mutant phone @ 60 Hz reads ${phone60.toFixed(3)} — probe no longer sees the render-rate coupling`);
    assert.ok(desk144 > 1.0, `mutant desktop @ 144 Hz reads ${desk144.toFixed(3)} — probe no longer sees the render-rate coupling`);
    assert.ok(desk144 / phone60 > 4, `mutant spread ×${(desk144 / phone60).toFixed(2)}, expected > 4`);
  });

  test('doubling the rate constant reads as exactly ×2', () => {
    const mutant = ANIMATE_SRC.replace(RATE_RE, 'time += dt * 0.96');
    assert.ok(mutant !== ANIMATE_SRC, 'mutation did not apply — RATE_RE is stale, fix the control');
    const dev = deviceConfig(CONFIGS[0]);
    const ratio = rate(mutant, dev, 60) / rate(ANIMATE_SRC, dev, 60);
    assert.ok(Math.abs(ratio - 2) < 1e-6, `doubled constant reads ×${ratio.toFixed(6)} — probe is not reading the constant`);
  });

  test('a bare 0.05 cap (the plausible cleanup) is caught by the phone @ 30 Hz cell', () => {
    const CAP_RE = /0\.05\s*\*\s*RENDER_FRAME_SKIP/;
    const mutant = ANIMATE_SRC.replace(CAP_RE, '0.05');
    assert.ok(mutant !== ANIMATE_SRC, 'mutation did not apply — CAP_RE is stale, fix the control');
    const r = rate(mutant, deviceConfig(CONFIGS[2]), 30);
    assert.ok(r < 0.40, `bare-cap mutant phone @ 30 Hz reads ${r.toFixed(3)} — the parity matrix would miss a cap regression`);
  });
});
