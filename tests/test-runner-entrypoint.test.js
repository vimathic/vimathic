// tests/test-runner-entrypoint.test.js
//
// `npm test` must actually run the tests, and importing the runner must not.
//
// Those two sentences were in conflict for the whole of round 5 and nothing
// noticed, because the failure mode of the first one is a green run. The runner
// gated its entry on `import.meta.main`, a property node shipped in 24.2 and
// backported to 22.18. Below either version the value is `undefined`, main()
// never ran, and `npm test` printed nothing and exited 0 in a fifth of a second.
// Measured on this clone: node 22.11 → 0 characters of output, exit 0; node
// 24.20 → 1462 tests. CONTRIBUTING.md asked for "Node.js 22+" and made
// `npm test && npm run test:e2e && npm run build` the documented pre-push check,
// so an ordinary 22 LTS pin gave a contributor three green ticks and no tests.
//
// A guard that only fails on old runtimes cannot be caught by running the suite
// on a new one, so this file pins the two properties by BEHAVIOUR rather than by
// version: spawn the runner as an entry point and require that it runs, then
// import it from another entry point and require that it does not. Both hold on
// every version, which is the point of the comparison that replaced the flag.
//
// The version floor itself is stated in three places that used to disagree —
// package.json, CONTRIBUTING.md and ci.yml. They are compared against each other
// here rather than against a number written in this file, so raising the floor
// is one edit and this test follows it.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT   = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'scripts', 'run-tests.mjs');
const pkg    = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// One scratch directory for the two spawn tests. Kept outside the repository so
// the runner's own glob can never pick a fixture up as a real test file.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vimathic-runner-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// NODE_TEST_CONTEXT must not reach the child. `node --test` sets it on every
// test file it runs, and a node that sees it in its own environment assumes it
// is already inside a run: it prints "run() is being called recursively within a
// test file. skipping running files" as a WARNING, executes nothing, and exits
// 0. Inherited here that produces the precise symptom this file exists to catch
// — a runner that appears to work and runs no tests — from the test rather than
// from the code, which is the worst way for a guard to fail.
const node = (args, opts = {}) => {
  const env = { ...process.env, ...(opts.env ?? {}) };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args,
    { cwd: ROOT, encoding: 'utf8', timeout: 60_000, ...opts, env });
};

describe('the test runner runs the tests when it is the entry point', () => {

  test('spawning the runner with a file actually executes that file', () => {
    // A fixture rather than a real test file: this asserts that main() ran, and
    // coupling that to some other test's contents would make this fail for
    // reasons that have nothing to do with the entry point.
    //
    // The proof is a file the fixture writes, and its stdout only after that.
    // The runner spawns node with stdio:'inherit', so this is a grandchild two
    // pipes away, and its output is the more fragile of the two signals — see
    // the NODE_TEST_CONTEXT note on the helper for one way it goes quiet while
    // the exit code stays 0. A sentinel on disk says "this code executed"
    // whatever the plumbing does, which is the claim being made.
    const fixture  = path.join(tmp, 'fixture.test.js');
    const sentinel = path.join(tmp, 'ran.txt');
    fs.rmSync(sentinel, { force: true });
    fs.writeFileSync(fixture,
      "import { test } from 'node:test';\n" +
      "import fs from 'node:fs';\n" +
      // Inside the test body, not at module scope: a file that was merely
      // imported would satisfy a top-level write, and being imported is not
      // the thing under test.
      `test('the runner reached this file', () => { fs.writeFileSync(${JSON.stringify(sentinel)}, 'ran'); });\n`);

    const r = node([RUNNER, fixture]);

    assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
    assert.ok(fs.existsSync(sentinel),
      'the runner exited without running the file it was handed — this is exactly the ' +
      'import.meta.main failure: main() never ran, nothing was spawned, and the exit code was 0. ' +
      `stdout was:\n${r.stdout}\nstderr:\n${r.stderr}`);
    // Matched loosely on purpose: node's default reporter has been both `tap`
    // ("# pass 1") and `spec` ("ℹ pass 1"), and which one appears also depends
    // on whether stdout is a TTY. Pinning either spelling would make this fail
    // on a reporter change, which is not what it is here to detect.
    assert.match(r.stdout, /the runner reached this file/,
      `the fixture ran but the runner did not report it:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /\bpass 1\b/, `expected one passing test:\n${r.stdout}`);
    assert.equal(r.status, 0, `runner exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  });

  test('importing the runner from another entry point runs nothing', () => {
    // tests/build-pipeline-guards.test.js imports this module for its TEST_GLOB.
    // If the guard ever admits a non-entry-point import, that import starts a
    // second full suite from inside the first one.
    const importer = path.join(tmp, 'importer.mjs');
    fs.writeFileSync(importer,
      `const m = await import(${JSON.stringify(pathToFileURL(RUNNER).href)});\n` +
      "process.stdout.write('IMPORTED:' + m.TEST_GLOB);\n");

    const r = node([importer]);

    assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
    assert.equal(r.status, 0, `importer exited ${r.status}\n${r.stderr}`);
    assert.equal(r.stdout, `IMPORTED:${'tests/*.test.js'}`,
      'importing the runner emitted something besides the export — it ran the suite');
    assert.doesNotMatch(r.stdout, /# pass|# fail|TAP version/,
      'importing the runner started a test run');
  });

  test('the entry check does not depend on a property older runtimes lack', () => {
    const src = fs.readFileSync(RUNNER, 'utf8');
    // The comment above the guard explains the history and names the property,
    // so match only what would actually gate execution on it.
    assert.doesNotMatch(src, /^\s*if\s*\(\s*import\.meta\.main\s*\)/m,
      'import.meta.main is undefined below node 22.18 — gating the suite on it is a silent zero-test run');
  });
});

describe('the node floor is declared once and agreed on everywhere', () => {

  const floor = pkg.engines?.node?.match(/(\d+)\.(\d+)/);

  test('package.json declares an engines floor', () => {
    assert.ok(pkg.engines?.node, 'package.json has no engines.node');
    assert.ok(floor, `engines.node is "${pkg.engines.node}" — it must name a major.minor floor`);
    const [, maj, min] = floor.map(Number);
    assert.ok(maj > 22 || (maj === 22 && min >= 18),
      `engines.node allows ${maj}.${min}; scripts/run-tests.mjs needs 22.18 to run at all`);
  });

  test('.npmrc makes that floor a refusal, not a notice', () => {
    const npmrc = path.join(ROOT, '.npmrc');
    assert.ok(fs.existsSync(npmrc), 'no .npmrc — engines would only print a warning npm then ignores');
    assert.match(fs.readFileSync(npmrc, 'utf8'), /^\s*engine-strict\s*=\s*true\s*$/m);
  });

  test('CONTRIBUTING.md states the same floor package.json enforces', () => {
    const [, maj, min] = floor.map(Number);
    const doc = fs.readFileSync(path.join(ROOT, 'CONTRIBUTING.md'), 'utf8');
    assert.match(doc, new RegExp(`\\b${maj}\\.${min}\\b`),
      `CONTRIBUTING.md does not mention ${maj}.${min}; it said "Node.js 22+" while the runner ` +
      'needed 22.18, which is how a contributor came to run zero tests and be told they passed');
  });

  test('every CI job pins a version that satisfies the floor', () => {
    const [, maj, min] = floor.map(Number);
    const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const pins = [...yml.matchAll(/node-version:\s*'([^']+)'/g)].map(m => m[1]);
    assert.ok(pins.length > 0, 'ci.yml pins no node version');
    for (const pin of pins) {
      const m = pin.match(/^(\d+)(?:\.(\d+))?/);
      assert.ok(m, `ci.yml pins "${pin}", which names no version`);
      const pinMaj = Number(m[1]);
      const pinMin = m[2] === undefined ? null : Number(m[2]);
      if (pinMaj > maj) continue;
      assert.equal(pinMaj, maj, `ci.yml pins ${pin}, below the ${maj}.${min} floor`);
      // A bare major is the original bug, not a near miss: setup-node resolves
      // '22' to whatever 22.x the runner happens to have, so the required check
      // was passing without executing an assertion on any day that was < 22.18.
      assert.notEqual(pinMin, null,
        `ci.yml pins '${pin}' — setup-node resolves a bare major to the newest ${pin}.x on the ` +
        `runner, which may be below ${maj}.${min}. Pin the minor.`);
      assert.ok(pinMin >= min, `ci.yml pins ${pin}, below the ${maj}.${min} floor`);
    }
  });
});
