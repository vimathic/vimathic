#!/usr/bin/env node
// scripts/bench-cpu-formulas.mjs — what one tick of a CPU formula costs.
//
// Run:  node scripts/bench-cpu-formulas.mjs [--grid 161] [--repeats 7] [--top 20]
//
// ── Why this exists ─────────────────────────────────────────────────────────
// Nothing in this repository could time anything. tests/e2e/shader-oracle.spec.js
// compiles and links but reads no clock, and tests/e2e/smoke.spec.js refuses an
// fps threshold on purpose because a hosted runner has no GPU. So every claim
// about cost here has been an estimate, and src/shaders.js carries a retracted
// frame-time figure to prove how that ends.
//
// The CPU formula path is the one part of this app that CAN be measured without
// a browser: generateSurfaceFromFormula is a pure function over a grid, and the
// worker calls exactly it (src/math-worker.js, the 'tick' case). This measures
// that call and nothing else.
//
// ── What it measures, and what it does not ──────────────────────────────────
// MEASURES: wall-clock for one generateSurfaceFromFormula call, per formula,
// at several values of `comp` — the third parameter every formula receives and
// the only one the operator has no control over (src/math-visualizer.js builds
// it as `0.5 + mid * 0.4`, so it never leaves 0.5..0.9).
//
// DOES NOT measure: the frame. The worker runs off the render loop, results are
// posted back and blended, and the GPU does its own work. A formula inside the
// tick budget here can still miss a frame for reasons this script cannot see.
// It also runs in Node's V8 rather than the browser's, on this machine's CPU —
// so the RATIOS between formulas and between comp values are the useful output,
// and the absolute milliseconds are indicative.
//
// `time` advances between repeats on purpose. Several heavy formulas memoise
// their simulation grid and rebuild it when the clock moves (HEAVY_TIME_EPS in
// src/math-collections.js); holding t still would measure a warm cache that the
// real loop never sees.

import { performance } from 'node:perf_hooks';
import { getAllFormulasList, getFormula, generateSurfaceFromFormula, FIELD_EXTENT }
  from '../src/math-collections.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

// 161 is what the app actually asks for: MathVisualizer sets _gridSize from
// sqrt(position.count) and the plane is 160 segments, so 161² = 25,921 points
// per tick. The default in generateSurfaceFromFormula is 90 and is not what
// ships on the plane.
const GRID    = arg('grid', 161);
const REPEATS = arg('repeats', 7);
const TOP     = arg('top', 20);

// Today's reachable band is 0.5..0.9 and nothing else. The values outside it
// are what a knob would open up, which is the number this script exists for.
const COMPS = [0, 0.25, 0.5, 0.7, 0.9, 1.0];
const TODAY_MAX = 0.9;

// One worker tick per rendered frame at 60 Hz. The worker is off-thread, so
// this is not a frame budget — it is the rate at which ticks arrive, and a
// formula slower than this cannot keep up with them.
const TICK_BUDGET_MS = 1000 / 60;

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function timeOne(fn, comp) {
  // amp and freq at their silent-input values: MathVisualizer builds them as
  // `amp * (1 + bass*0.5)` and `waveInt * (1 + treble*0.3)`, both 1 with no
  // audio and the sliders at rest.
  const params = { amp: 1, freq: 1, comp };
  const samples = [];
  // Warm-up, discarded: first call pays JIT and any lazy table build.
  generateSurfaceFromFormula(fn, params, GRID, FIELD_EXTENT, 0);
  for (let i = 0; i < REPEATS; i++) {
    // 0.48 units/s is the formula clock's rate; one frame at 60 Hz is 0.008.
    const t = 1 + i * 0.008;
    const a = performance.now();
    generateSurfaceFromFormula(fn, params, GRID, FIELD_EXTENT, t);
    samples.push(performance.now() - a);
  }
  return median(samples);
}

const list = getAllFormulasList();
console.log(`grid ${GRID}x${GRID} = ${(GRID * GRID).toLocaleString('en-US')} points | ` +
            `${REPEATS} repeats, median | ${list.length} formulas | ` +
            `tick budget ${TICK_BUDGET_MS.toFixed(1)} ms at 60 Hz`);
console.log('');

const rows = [];
for (const entry of list) {
  const f = getFormula(entry.collectionId ?? entry.collId, entry.key ?? entry.formulaKey);
  if (!f?.f) continue;
  const by = {};
  for (const c of COMPS) {
    try { by[c] = timeOne(f.f, c); } catch (e) { by[c] = NaN; }
  }
  rows.push({
    name: entry.name ?? entry.key ?? '(unnamed)',
    id: `${entry.collectionId ?? entry.collId}/${entry.key ?? entry.formulaKey}`,
    by,
    // What opening the top of the range would cost this formula.
    widen: by[1.0] / by[TODAY_MAX],
  });
}

rows.sort((a, b) => (b.by[TODAY_MAX] || 0) - (a.by[TODAY_MAX] || 0));

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const ms  = v => (Number.isFinite(v) ? v.toFixed(2).padStart(7) : '      -');

console.log(pad('formula', 34) + COMPS.map(c => `  comp ${c}`.padStart(9)).join('') + '   1.0/0.9');
console.log('-'.repeat(34 + COMPS.length * 9 + 11));
for (const r of rows.slice(0, TOP)) {
  console.log(pad(r.name, 34) + COMPS.map(c => ms(r.by[c])).join('  ') +
              '  ' + (Number.isFinite(r.widen) ? r.widen.toFixed(2) + '×' : '   -'));
}

console.log('');
const over = c => rows.filter(r => r.by[c] > TICK_BUDGET_MS).length;
for (const c of COMPS) {
  console.log(`comp ${String(c).padEnd(4)} : ${String(over(c)).padStart(3)} of ${rows.length} formulas over the ${TICK_BUDGET_MS.toFixed(1)} ms tick budget` +
              (c > TODAY_MAX ? '   ← outside today\'s reachable range' : ''));
}

const widens = rows.map(r => r.widen).filter(Number.isFinite).sort((a, b) => b - a);
console.log('');
console.log(`opening comp from ${TODAY_MAX} to 1.0 costs: ` +
            `median ${median(widens).toFixed(2)}×, worst ${widens[0]?.toFixed(2)}× ` +
            `(${rows.find(r => r.widen === widens[0])?.name ?? '-'})`);

// The finding this script was not built to make, and the one that matters more:
// which formulas cannot keep up with the tick at settings that are reachable
// TODAY. A knob is a question about the edges of a range; this is about the
// middle of it.
const already = rows.filter(r => r.by[TODAY_MAX] > TICK_BUDGET_MS || r.by[0.5] > TICK_BUDGET_MS);
if (already.length) {
  console.log('');
  console.log(`OVER BUDGET AT SETTINGS REACHABLE TODAY — ${already.length} of ${rows.length}:`);
  for (const r of already) {
    console.log('  ' + pad(r.name, 34) + ms(r.by[0.5]) + ' ms at comp 0.5, ' +
                ms(r.by[TODAY_MAX]).trim() + ' ms at ' + TODAY_MAX +
                `   (${(r.by[TODAY_MAX] / TICK_BUDGET_MS).toFixed(1)}× the tick)`);
  }
}
