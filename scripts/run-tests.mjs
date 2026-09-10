#!/usr/bin/env node
// run-tests.mjs — `npm test`, with a memory ceiling when the platform has one.
//
// ── Why this file exists ────────────────────────────────────────────────────
// A failing assertion in this suite can cost gigabytes. node's assert renders
// BOTH sides of a comparison through util.inspect with `depth: 1000` and
// `maxArrayLength: Infinity`, and the diff for two SIMILAR long arrays costs
// O(N·D) in the number of differing rows. Measured here: 589 824 words a side
// with ten rows differing is 521 MiB, a hundred rows 2143 MiB, a thousand is a
// dead process. The trap springs precisely when the test is RIGHT — a real
// regression moves thousands of vertices — so it is invisible in a green run.
// On 30.08.2026 that pattern took this machine's VM down twice in one hour.
//
// ── Why the ceiling is a cgroup and not a node flag ─────────────────────────
// `NODE_OPTIONS=--max-old-space-size` does NOT bound it: measured at 256, 512
// and 1024 MiB the peak was the same 2.3–2.5 GiB, because the cost is in the
// inspect/diff machinery's own buffers, not the JS heap. A cgroup bounds it;
// nothing else tried did.
//
// ── Why not a lint rule on the assert form ──────────────────────────────────
// That was the obvious alternative and it was measured before being rejected.
// The dangerous thing is not a spelling, it is an ARGUMENT that happens to be
// large, which is not visible in the source. The narrowest static probe that
// can be written — an assert call whose line mentions a typed array, a geometry
// or `.attributes` — matches 17 places in this suite and every one of them is
// safe (`.count`, `.needsUpdate`, `{ verts: 25921 }`). 17 false positives, 0
// true ones. A rule that wrong teaches people to route around their own guard,
// so there is no rule; there is this ceiling, and the comments at the four
// places where the form is genuinely dangerous.
//
// ── Behaviour ───────────────────────────────────────────────────────────────
// Runs the suite under `systemd-run --user --scope -p MemoryMax=…` when that
// works, and plainly otherwise. A CI container without cgroup delegation takes
// the second path — the ceiling is a local safety net, never a requirement, and
// this script must not be the reason a hosted run fails.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The set this runner runs with no arguments.
 *
 * Exported, and read by tests/build-pipeline-guards.test.js, so that the guard
 * on "the CI comment names what actually runs" compares against the value the
 * code USES. Its first attempt read the glob out of this file's text and
 * matched the one inside the comment below — mutating the real glob left it
 * green, which is the failure mode that guard exists to prevent.
 */
export const TEST_GLOB = 'tests/*.test.js';

// Importing this file must not run the suite — the guard above imports it.
//
// FIX: this was `if (import.meta.main)`, and that property landed in node 24.2
// and was backported to 22.18. Below either, it is `undefined` — main() never
// ran, nothing was spawned, and `npm test` printed nothing and exited 0.
// Measured on this clone: node 22.11 → 0 characters of output, exit 0, 0.2 s;
// node 24.20 → 1462 tests, 50 s. CONTRIBUTING.md named the floor as "22+" and
// makes `npm test && npm run test:e2e && npm run build` the pre-push check, so
// a contributor on an ordinary 22 LTS pin watched that chain pass in a fifth of
// a second and believed ninety test files were green. CI was green by luck:
// ci.yml pinned '22' and setup-node resolves that to the newest 22.x present on
// the runner — on a day that resolution was below 22.18 the required check
// passed without executing a single assertion. The irony was local: twenty
// lines below, this file refuses to let a glob that matches nothing fall
// through silently, with a comment saying a quietly-different green run is
// precisely the failure mode to prevent.
//
// The comparison below means the same thing on every version node has shipped.
// argv[1] goes through realpath because node resolves the entry point that way,
// so a clone reached through a symlink still matches. Under `node --test`,
// argv[1] is a test file rather than this one, which is what keeps the import at
// tests/build-pipeline-guards.test.js:197 from starting a second suite.
const entry = process.argv[1];
let isEntryPoint = false;
if (entry) {
  let href;
  try { href = pathToFileURL(realpathSync(entry)).href; }
  catch { href = pathToFileURL(entry).href; }   // deleted or unreadable: compare unresolved
  isEntryPoint = href === import.meta.url;
}
if (isEntryPoint) await main();

async function main() {
const MEM_MAX = process.env.VIMATHIC_TEST_MEM || '2500M';
const passed  = process.argv.slice(2);

// The glob is added unless the caller named FILES — not merely "unless the
// caller passed something". `npm test -- --test-name-pattern=foo` passes an
// option, not a target, and the first version treated it as one: the glob was
// dropped, node --test was left with no paths at all, and it fell back to its
// own recursive discovery. That silently runs a DIFFERENT set (everything
// matching node's default test patterns anywhere in the tree, e2e specs
// included) while reporting success. Found by an external review.
const namesFiles = passed.some(a => !a.startsWith('-'));
const nodeArgs = ['--test', '--test-concurrency=2', ...passed];
if (!namesFiles) nodeArgs.push(TEST_GLOB);

// Both properties the real invocation uses, not just the first: a systemd that
// accepts MemoryMax and rejects MemorySwapMax would pass this probe and then
// fail the actual run, instead of falling back to the uncapped path.
const canCap = spawnSync('systemd-run',
  ['--user', '--scope', '-q', '-p', `MemoryMax=${MEM_MAX}`, '-p', 'MemorySwapMax=0', '--', 'true'],
  { stdio: 'ignore' }).status === 0;

// The glob is expanded by this process, not a shell: spawn does no globbing,
// and `node --test 'tests/*.test.js'` would look for a file with a star in it.
const files = [];
for (const a of nodeArgs) {
  // FIX(r6): a FLAG is never a path, however many stars are in it. This globbed
  // any argument containing `*`, so `npm test -- --test-name-pattern="tidy.*caret"`
  // — a regexp, and the ordinary way to run one test — was expanded as a file
  // pattern, matched nothing, and exited 1 with "matched no files", accusing the
  // suite of being broken. Verified: without the `*` the same filter runs 98
  // tests and passes. CI is unaffected, which is why nothing caught it.
  if (a.startsWith('-') || !a.includes('*')) { files.push(a); continue; }
  const { globSync } = await import('node:fs');
  const hit = globSync(a).sort();
  // A glob that matches nothing is a broken suite specification, and it has to
  // be LOUD. Left to itself, node --test with no paths goes back to recursive
  // discovery and a repository whose tests had all been renamed would still
  // report a green run.
  if (!hit.length) {
    console.error(`[run-tests] ${a} matched no files — refusing to fall back to node's own discovery`);
    process.exit(1);
  }
  files.push(...hit);
}

const cmd = canCap
  ? ['systemd-run', ['--user', '--scope', '-q',
      '-p', `MemoryMax=${MEM_MAX}`, '-p', 'MemorySwapMax=0',
      '--', process.execPath, ...files]]
  : [process.execPath, files];

if (!canCap) {
  console.log('[run-tests] no usable cgroup here — running without a memory ceiling');
}
const r = spawnSync(cmd[0], cmd[1], { stdio: 'inherit' });
process.exit(r.status ?? 1);
}
