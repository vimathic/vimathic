// tests/catalog-worker-contract.test.js
//
// Contract test between the catalogue's off-thread evaluator (src/math-worker.js)
// and the peer that owns it (src/math-visualizer.js).
//
// Run:
//   node --test tests/catalog-worker-contract.test.js
//
// ── Why this exists ───────────────────────────────────────────────────────────
// The worker's message-contract block argued a trade-off that stopped being
// true. It justified routing every failure through `postMessage({type:'error'})`
// on the grounds that an exception reaching `worker.onerror` would cost "the
// off-thread channel for the rest of the session" — but since the peer learned
// to forgive WORKER_ERROR_TOLERANCE post-startup onerror hits, the message
// channel is the harsher of the two: one error message disables the worker
// permanently. The behaviour is deliberate and documented on the peer's side;
// the worker's stated reason for it was a year out of date.
//
// Prose cannot be checked, but the two named constants and the one branch that
// implements the policy can be, so this reads both sources and pins the pair:
// the peer's behaviour (which must not change) and the worker's account of it
// (which must not contradict the peer again in silence).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');

const WORKER     = read('src/math-worker.js');
const VISUALIZER = read('src/math-visualizer.js');

describe('math-worker.js — the error channel is described the way the peer treats it (#7)', () => {
  test('control — an error message still retires the channel, permanently', () => {
    // The behaviour the worker's comment has to describe. `type: 'error'`
    // routes into _disableWorker, and _disableWorker is one-way: _workerReady
    // is assigned in the constructor and cleared here, and nothing re-arms it.
    assert.match(VISUALIZER, /data\.type === 'error'[\s\S]{0,600}?this\._disableWorker\(/,
      "the 'error' message no longer routes into _disableWorker");
    assert.match(VISUALIZER, /_disableWorker\(reason\)\s*\{\s*if \(!this\._workerReady\) return;\s*this\._workerReady = false;/,
      '_disableWorker no longer clears _workerReady');
    const reArmed = VISUALIZER.match(/_workerReady\s*=\s*true/g);
    assert.equal(reArmed, null, 'something now re-arms _workerReady — the asymmetry below is stale');
  });

  test('control — a post-startup worker.onerror is still forgiven up to a tolerance', () => {
    // The other half of the asymmetry: onerror, the path the message channel
    // was supposed to be safer than, survives WORKER_ERROR_TOLERANCE hits.
    assert.match(VISUALIZER, /const WORKER_ERROR_TOLERANCE = 3;/,
      'WORKER_ERROR_TOLERANCE is gone or has moved');
    assert.match(VISUALIZER, /\+\+this\._workerErrors > WORKER_ERROR_TOLERANCE/,
      'onerror no longer counts errors against the tolerance');
  });

  test('the worker no longer claims the error channel spares the off-thread path', () => {
    // Both sentences were written before the tolerance existed and now read
    // as the opposite of what happens.
    assert.ok(!/costing the off-thread channel for the rest of the session/.test(WORKER),
      'math-worker.js still says an onerror throw is what costs the channel');
    assert.ok(!/MathVisualizer\._disableWorker reads as a dead Worker instance/.test(WORKER),
      'math-worker.js still offers avoiding _disableWorker as the reason for the error message');
  });

  test('the worker names the tolerance that inverted the trade-off', () => {
    // A developer reading math-worker.js on its own has to come away knowing
    // which of the two channels is the expensive one.
    assert.match(WORKER, /WORKER_ERROR_TOLERANCE/,
      'math-worker.js does not mention the tolerance that makes onerror the cheaper path');
  });
});
