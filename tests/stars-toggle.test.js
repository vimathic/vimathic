// tests/stars-toggle.test.js
//
// STARS — the switch for the starfield behind the formula, and who decides
// whether the starfield is on screen.
//
// Run:
//   node --test tests/stars-toggle.test.js
//
// ── What the button switches, and what it does not ──────────────────────────
// The owner asked for a button that "switches off the stars and other
// background objects". Only one object actually sits behind the body: the
// 1200-point starfield, RenderEngine.stars. Everything else that might be
// called background is not an object or is not background — the grid has its
// own button; background colour, fog and clear colour are output settings that
// TRANSPARENT BG owns (tests/ui-colour-space.test.js pins their write sites);
// the lights are never drawn; the solar shape's orbits and belt are part of the
// shape the operator picked; Spectrum Rings and an imported model are the
// subject; post FX work on the whole screen, and the stars' bloom halo goes
// with the stars. So STARS switches `stars` and nothing else.
//
// ── The defect this is built to avoid ───────────────────────────────────────
// Until STARS, setTransparentBackground was the starfield's only writer, and its
// restore branch gave the stars back unconditionally (`_setStarsNow(true)`). A
// STARS button built on top of that would be undone every time the operator
// left transparent mode: the stars come back, the button still reads OFF, and
// everything reading the canvas — captureStream, the second screen, the
// recorders — shows the starfield the operator switched off. The grid had the
// same defect for the same reason (tests/grid-visibility.test.js).
//
// The fix is two inputs and one writer. `starsOn` is the operator's wish (the
// button), `transparentBg` is the output format, and RenderEngine._syncStars()
// is the only thing that writes stars.visible, as `starsOn && !transparentBg`.
// "STARS off survives a TRANSPARENT BG round trip" is the before/after case:
// the reinjected control below rebuilds setTransparentBackground with the
// shipped restore put back and shows it failing that exact assertion.
//
// ── How this runs ───────────────────────────────────────────────────────────
// The real RenderEngine methods, called on an Object.create(RenderEngine
// .prototype) host that carries only the fields those methods read — the
// pattern of tests/night-mode.test.js, with a hand-driven performance.now so a
// fade, if one were ever added, would show up as movement. No WebGL, no jsdom.
// The source pin at the end reads every src/**/*.js with fs, presets.js
// included: it carries a NUL byte, so ripgrep treats it as binary and a
// repo-wide search silently skips it.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.document = {
  getElementById: () => ({ value: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
  querySelectorAll: () => [],
};

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let RenderEngine, TransitionManager, GRID_OPACITY, STARS_OPACITY, GLARE, uiColor, THREE, REQUIRED_IDS;
before(async () => {
  ({ RenderEngine, TransitionManager, GRID_OPACITY, STARS_OPACITY, GLARE, uiColor } =
    await import('../src/render.js'));
  // Free variables in setTransparentBackground's body, handed to the rebuilt
  // copy in the reinjected control.
  THREE = await import('three');
  ({ REQUIRED_IDS } = await import('../src/dom.js'));
});

const realNow = performance.now.bind(performance);
let clock = 0;
before(() => { performance.now = () => clock; });
after(()  => { performance.now = realNow; });

let host;
beforeEach(() => {
  clock = 0;
  // The whole of what setStarsOn, _syncStars, setTransparentBackground and
  // setNightly read. If that list grows, this host should fail loudly rather
  // than quietly model a different engine — which is also why `starsOn` is
  // stated here: _syncStars reads it with no `?? true` fallback.
  host = Object.assign(Object.create(RenderEngine.prototype), {
    transitions: new TransitionManager(),
    grid:  { visible: false, material: { opacity: GRID_OPACITY, transparent: true } },
    stars: { visible: true, material: { opacity: STARS_OPACITY, transparent: true } },
    scene: {}, renderer: { setClearColor() {} },
    U: { uGlare: { value: GLARE } },
    gridLitOpacity: GRID_OPACITY,
    nightly: false,
    transparentBg: false,
    starsOn: true,
  });
});

const setStarsOn  = on => RenderEngine.prototype.setStarsOn.call(host, on);
const transparent = on => RenderEngine.prototype.setTransparentBackground.call(host, on);
const setNightly  = on => RenderEngine.prototype.setNightly.call(host, on);
const advance = ms => { for (let d = 0; d < ms; d += 16) { clock += 16; host.transitions.tick(); } };

describe('STARS switches the starfield', () => {

  test('off hides it, and on brings it back at STARS_OPACITY', () => {
    setStarsOn(false);
    assert.equal(host.starsOn, false);
    assert.equal(host.stars.visible, false, 'STARS off left the starfield on screen');

    host.stars.material.opacity = 0.9;           // whatever it was left at
    setStarsOn(true);
    assert.equal(host.stars.visible, true, 'STARS on did not bring the starfield back');
    assert.equal(host.stars.material.opacity, STARS_OPACITY,
      'the starfield came back at the wrong strength — the writer parks it at its rest value');
  });

  test('instant, both ways — nothing fades it', () => {
    // night-mode.test.js pins "nothing fades them" for NIGHT; the same holds
    // for STARS, and for a reason that matters more here: STARS travels in
    // presets and clip steps, and an alpha capture must never see a fade.
    setStarsOn(false);
    assert.equal(host.stars.visible, false, 'not hidden on the same call');
    setStarsOn(true);
    assert.equal(host.stars.visible, true, 'not shown on the same call');
    assert.equal(host.stars.material.opacity, STARS_OPACITY);
    advance(600);
    assert.equal(host.stars.visible, true);
    assert.equal(host.stars.material.opacity, STARS_OPACITY,
      `opacity moved to ${host.stars.material.opacity} after the call — something is fading it`);
  });

  test('control — STARS on over a starfield that is already on changes nothing', () => {
    setStarsOn(true);
    assert.equal(host.starsOn, true);
    assert.equal(host.stars.visible, true);
    assert.equal(host.stars.material.opacity, STARS_OPACITY);
  });

  test('control — the writer reads the wish strictly: an engine without it shows no stars', () => {
    // The house rule from tests/grid-visibility.test.js: no default fallback
    // that would let an uninitialised field look correct. A `?? true` in
    // _syncStars would make this pass a starfield nobody asked for.
    delete host.starsOn;
    RenderEngine.prototype._syncStars.call(host);
    assert.notEqual(host.stars.visible, true,
      '_syncStars defaulted a missing starsOn to true — a host that forgot the field would look right');
  });
});

describe('TRANSPARENT BG and STARS — two inputs, one writer', () => {

  test('STARS off survives a TRANSPARENT BG round trip', () => {
    setStarsOn(false);
    transparent(true);
    assert.equal(host.stars.visible, false, 'alpha capture must not carry white points');
    transparent(false);
    assert.equal(host.stars.visible, false,
      'leaving transparent mode brought back stars the operator switched off — the button reads OFF');
    assert.equal(host.starsOn, false, 'the round trip rewrote the wish');
  });

  test('control — reinjected: the shipped restore, which gave the stars back unconditionally, fails the case above', () => {
    // Rebuild setTransparentBackground from its own source with the restore
    // branch's _syncStars() replaced by what _setStarsNow(true) did before
    // STARS. If the case above passed against this mutant, it would not be
    // telling the fix from the defect.
    const src = RenderEngine.prototype.setTransparentBackground.toString();
    const at  = src.lastIndexOf('this._syncStars();');
    assert.ok(at > src.indexOf('this._syncStars();'),
      'setTransparentBackground no longer calls _syncStars() on both branches — this control has nothing to reinject');
    const mutant = src.slice(0, at)
      + 'this.stars.visible = true; this.stars.material.opacity = STARS_OPACITY;'
      + src.slice(at + 'this._syncStars();'.length);
    const shipped = new Function('THREE', 'uiColor', 'STARS_OPACITY', `return function ${mutant}`)(
      THREE, uiColor, STARS_OPACITY);

    setStarsOn(false);
    shipped.call(host, true);
    shipped.call(host, false);
    assert.equal(host.stars.visible, true,
      'the pre-STARS restore no longer reproduces the defect, so the case above proves nothing');
  });

  test('STARS on during TRANSPARENT BG does not show them, and leaving does', () => {
    setStarsOn(false);
    transparent(true);
    setStarsOn(true);                        // the wish changes inside the capture...
    assert.equal(host.stars.visible, false,
      'STARS put 1200 white points into an alpha capture');
    assert.equal(host.starsOn, true, '...and is recorded, not dropped');
    transparent(false);
    assert.equal(host.stars.visible, true, 'leaving transparent mode ignored the latest wish');
    assert.equal(host.stars.material.opacity, STARS_OPACITY);
  });

  test('STARS off during TRANSPARENT BG keeps them off after leaving', () => {
    transparent(true);
    setStarsOn(false);
    assert.equal(host.stars.visible, false);
    transparent(false);
    assert.equal(host.stars.visible, false,
      'the operator switched STARS off inside transparent mode and leaving it brought them back');
  });

  test('control — a round trip with STARS on restores them', () => {
    transparent(true);
    assert.equal(host.stars.visible, false);
    transparent(false);
    assert.equal(host.stars.visible, true, 'the plain round trip lost the stars');
    assert.equal(host.stars.material.opacity, STARS_OPACITY);
  });

  test('control — enabling twice does not lose the wish', () => {
    // The panel button and the output modal drive the same call, which is why
    // the grid half needed FIX(r2). The stars keep no snapshot to overwrite,
    // and this says so.
    transparent(true);
    transparent(true);
    transparent(false);
    assert.equal(host.stars.visible, true);
  });
});

describe('NIGHT moves nothing, in either STARS state', () => {
  for (const wish of [false, true]) {
    test(`with STARS ${wish ? 'on' : 'off'}, NIGHT on and off leaves the starfield where STARS put it`, () => {
      setStarsOn(wish);
      setNightly(true);  advance(600);
      assert.equal(host.stars.visible, wish, `NIGHT ${wish ? 'hid' : 'showed'} the starfield`);
      assert.equal(host.stars.material.opacity, STARS_OPACITY, 'NIGHT moved the starfield\'s opacity');
      setNightly(false); advance(600);
      assert.equal(host.stars.visible, wish);
      assert.equal(host.stars.material.opacity, STARS_OPACITY);
      assert.equal(host.starsOn, wish, 'NIGHT rewrote the STARS wish');
    });
  }
});

// ── Source pin: one writer, two assignments ─────────────────────────────────
// The behaviour above holds only while nothing else writes the starfield. A
// third writer would bring back exactly the defect this file exists for, so it
// is pinned by reading the source: every `.visible =` on the starfield (direct,
// or through a local alias of it) across src/, every `starsOn =`, and the
// value the constructor starts the wish at.
const jsFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? jsFiles(path.join(dir, e.name))
                  : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));

/** Lines of a file with comment lines blanked, so line numbers survive. */
const codeLines = file => fs.readFileSync(file, 'utf8').split('\n').map(l => {
  const t = l.trim();
  return (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) ? '' : l;
});

/** The class method whose body a line sits in: the nearest 2-space-indented header above it. */
const METHOD = /^  (?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/;
const enclosingMethod = (lines, i) => {
  for (let j = i; j >= 0; j--) { const m = lines[j].match(METHOD); if (m) return m[1]; }
  return null;
};

describe('the starfield has one writer, and the wish two assignments', () => {
  const files = jsFiles(path.join(ROOT, 'src'));
  /** The constructor's line, comment-stripped and trimmed: the wish starts ON. */
  const STARS_ON_AT_BOOT = /^this\.starsOn\s*=\s*true\s*;?$/;
  /**
   * FIX(review R4): the line as the pin reads it — its trailing `//` comment
   * gone. codeLines blanks whole-line comments only, so a harmless
   * `this.starsOn = true; // the wish starts ON` failed the anchored pin, with
   * a message saying the wish reads OFF. The anchor stays: it is what refuses
   * `this.starsOn = true && x`.
   */
  const bootLine = text => text.replace(/\s*\/\/.*$/, '').trim();

  test('the scan reads presets.js and the rest of src/', () => {
    // ripgrep skips presets.js as binary; fs does not. If this list ever stops
    // including it, a writer hiding there would pass unseen.
    const rel = files.map(f => path.relative(ROOT, f).replace(/\\/g, '/'));
    for (const f of ['src/render.js', 'src/ui/presets.js', 'src/ui/controls.js', 'src/main.js']) {
      assert.ok(rel.includes(f), `${f} is not in the scan`);
    }
    assert.ok(codeLines(path.join(ROOT, 'src/ui/presets.js')).some(l => /starsOn/.test(l)),
      'presets.js was read but carries no starsOn — the read is not reaching its content');
  });

  test('stars.visible is written only in _syncStars', () => {
    const writes = [];
    for (const file of files) {
      const lines = codeLines(file);
      // Local aliases of the starfield in this file: `const s = this.stars;`.
      const aliases = new Set();
      for (const l of lines) {
        const m = l.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w$.]*\bstars\s*;/);
        if (m) aliases.add(m[1]);
      }
      lines.forEach((l, i) => {
        for (const m of l.matchAll(/([\w$.]+)\.visible\s*=(?!=)/g)) {
          const recv = m[1];
          if (/(?:^|\.)stars$/.test(recv) || aliases.has(recv)) {
            writes.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), line: i + 1,
                          method: enclosingMethod(lines, i), text: l.trim() });
          }
        }
      });
    }
    assert.ok(writes.length >= 1, 'no write of stars.visible found at all — the scan is broken');
    const stray = writes.filter(w => !(w.file === 'src/render.js' && w.method === '_syncStars'));
    assert.deepEqual(stray, [],
      'stars.visible is written outside RenderEngine._syncStars — a second writer can undo the ' +
      'STARS wish or put stars into an alpha capture:\n' +
      stray.map(w => `  ${w.file}:${w.line} (in ${w.method}) ${w.text}`).join('\n'));
    assert.equal(writes.length, 1, 'more than one write inside _syncStars');
  });

  test('starsOn is assigned only in the constructor and setStarsOn', () => {
    const sites = [];
    for (const file of files) {
      const lines = codeLines(file);
      lines.forEach((l, i) => {
        if (/\bstarsOn\s*(?:=(?!=)|\?\?=|\|\|=|&&=)/.test(l)) {
          sites.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), line: i + 1,
                       method: enclosingMethod(lines, i), text: l.trim() });
        }
      });
    }
    const where = sites.map(s => `${s.file}:${s.method}`).sort();
    assert.deepEqual(where, ['src/render.js:constructor', 'src/render.js:setStarsOn'],
      'starsOn is assigned somewhere other than the constructor and setStarsOn:\n' +
      sites.map(s => `  ${s.file}:${s.line} (in ${s.method}) ${s.text}`).join('\n'));
  });

  test('the engine starts with the stars on — the constructor assigns `this.starsOn = true`', () => {
    // FIX(review): every host in the suite states `starsOn: true` itself, so
    // nothing unit-level read the constructor's value, and `= false` passed
    // all of it. The app would still DRAW stars at boot (nothing calls
    // _syncStars in the constructor), but the wish would read OFF: the first
    // STARS click would do nothing visible and paint the button ON, and the
    // first autosave would store starsOn:false, so the next reload hid a
    // starfield the operator never switched off. Only the e2e reload test
    // caught it.
    const file  = path.join(ROOT, 'src/render.js');
    const lines = codeLines(file);
    const inCtor = lines
      .map((l, i) => ({ text: l.trim(), method: enclosingMethod(lines, i) }))
      .filter(s => s.method === 'constructor' && /\bstarsOn\s*=(?!=)/.test(s.text));
    assert.equal(inCtor.length, 1, `expected one starsOn assignment in the constructor, found ${inCtor.length}`);
    assert.match(bootLine(inCtor[0].text), STARS_ON_AT_BOOT,
      `the engine boots with "${inCtor[0].text}" — the starfield is drawn but the wish reads OFF`);
  });

  test('control — the same matcher refuses an engine that boots with the wish off', () => {
    // Run on the mutant it exists for, and on a computed value that is not
    // plainly true: it has to tell both from the shipped line — through the
    // same comment strip the pin uses, so a comment cannot carry a mutant past.
    for (const bad of ['this.starsOn = false;', 'this.starsOn = !!opts.stars;',
                       'this.starsOn = true && x;', 'this.starsOn = false; // = true']) {
      assert.doesNotMatch(bootLine(bad), STARS_ON_AT_BOOT, bad);
    }
    for (const good of ['this.starsOn = true;', 'this.starsOn = true; // the wish starts ON',
                        'this.starsOn = true']) {
      assert.match(bootLine(good), STARS_ON_AT_BOOT, good);
    }
  });

  test('the pre-STARS writer is gone', () => {
    for (const file of files) {
      const hit = codeLines(file).findIndex(l => /_setStarsNow\b/.test(l));
      assert.equal(hit, -1,
        `${path.relative(ROOT, file)}:${hit + 1} still calls _setStarsNow, which took its answer from the caller`);
    }
  });
});

// ── Markup: where the button sits, and that boot requires it ────────────────
describe('the STARS button in the FPS row', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  /** [start, end) of the .eq-fps-row element, found by counting <div> depth. */
  const rowSpan = () => {
    const start = html.indexOf('<div class="eq-fps-row">');
    assert.ok(start >= 0, 'index.html has no .eq-fps-row');
    let depth = 0;
    for (const m of html.slice(start).matchAll(/<div\b|<\/div>/g)) {
      depth += m[0] === '</div>' ? -1 : 1;
      if (depth === 0) return [start, start + m.index];
    }
    assert.fail('.eq-fps-row is never closed');
  };

  test('it sits between STOP MOTION and TOGGLE GRID, inside the row', () => {
    const [start, end] = rowSpan();
    const at = id => {
      const i = html.indexOf(`id="${id}"`);
      assert.ok(i > start && i < end, `#${id} is not inside .eq-fps-row`);
      return i;
    };
    const freeze = at('btn-freeze-frame'), stars = at('btn-toggle-stars'), grid = at('btn-toggle-grid');
    assert.ok(freeze < stars && stars < grid,
      'the row order is not STOP MOTION, STARS, TOGGLE GRID');
    assert.equal(html.split('id="btn-toggle-stars"').length - 1, 1, 'the id appears more than once');
  });

  test('it is labelled STARS in plain text, ships ON, and TOGGLE GRID keeps its name', () => {
    const tag = html.match(/<button id="btn-toggle-stars"([^>]*)>([^<]*)<\/button>/);
    assert.ok(tag, '#btn-toggle-stars is not a plain-text <button> (no nested tags)');
    assert.equal(tag[2], 'STARS');
    assert.doesNotMatch(tag[1], /opacity/,
      'an inline opacity makes the button ship reading OFF over a starfield that ships on');
    assert.match(html, /<button id="btn-toggle-grid"[^>]*>TOGGLE GRID<\/button>/);
  });

  test('the row was tightened to make room for it', () => {
    // Measured: a third button in the old style overflows the 258-268 px row
    // by 30-40 px, and .ctrl-body's overflow:hidden clips TOGGLE GRID. The e2e
    // geometry guard (tests/e2e/stars.spec.js) measures the result; this pins
    // the three edits that produce it, so a "tidy-up" back to the old values
    // fails here first.
    assert.match(html, /\.eq-fps-row\{[^}]*\bgap:4px/, '.eq-fps-row gap is not 4px');
    for (const id of ['btn-freeze-frame', 'btn-toggle-stars', 'btn-toggle-grid']) {
      const style = html.match(new RegExp(`<button id="${id}"[^>]*style="([^"]*)"`))?.[1] ?? '';
      assert.match(style, /padding:3px 4px/, `#${id} is not at padding 3px 4px`);
      assert.match(style, /letter-spacing:0\b/, `#${id} does not set letter-spacing:0`);
    }
  });

  test('boot requires it — it is in dom.js REQUIRED', () => {
    assert.ok(REQUIRED_IDS.includes('btn-toggle-stars'), 'btn-toggle-stars is not in REQUIRED_IDS');
  });

  // FIX(review): the ☾ NIGHT tooltip still said NIGHT "hides the starfield".
  // It has not since r6 (the NIGHT group above holds the engine to that), and
  // with STARS two buttons along the panel the two tooltips named different
  // owners for the same object — the one user-facing copy of the claim this
  // branch's comment pass had missed.
  /** The title attribute of the <button> with this id. */
  const titleOf = id => html.match(new RegExp(`<button id="${id}"[^>]*?\\btitle="([^"]*)"`))?.[1];

  // FIX(review RR3-C1, and R5 / RR-C2 before it): this guard is an exact pin
  // now. For three rounds it tried to tell a true rewording of the starfield
  // sentence from a false one with regexps — first over the verbs it knew, then
  // per sentence, then per mention of the star noun with leave-alone escapes —
  // and each round's review found sentences it read the wrong way round (14 of
  // 27 in the last probe: "The starfield isn't left alone" passed as leaving
  // it alone, "It leaves the starfield alone" failed). A copy pin cannot
  // understand English, so it no longer tries. The title must carry the one
  // starfield sentence below word for word, and nothing else in it may mention
  // the starfield or the stars. Rewording that sentence is allowed; it is a
  // deliberate edit of this constant, made by someone who has checked that the
  // new words are still true.
  //
  // FIX(review RR4-1): the star word was `starfield|stars?`, so "starfields"
  // and "the starry backdrop" slipped past. It now takes the noun's other
  // forms too (and still lets "start" through). What no copy pin that allows
  // edits elsewhere can see is a follow-up that turns the pinned sentence
  // round without naming the stars ("… switches it off. So does NIGHT.");
  // NIGHT_PIN_ADVICE, and the engine-side NIGHT tests above, are the safeguard
  // there.
  const NIGHT_STARS_SENTENCE = 'The starfield stays; STARS switches it off.';
  const STAR_WORD = /\bstar(?:s|ry|light|field|fields|scape)?\b/i;

  /** What is wrong with a NIGHT title, as messages; [] when nothing is. */
  const nightStarProblems = title => {
    const problems = [];
    if (!title.includes(NIGHT_STARS_SENTENCE)) {
      problems.push(`the NIGHT tooltip no longer carries the pinned sentence "${NIGHT_STARS_SENTENCE}"`);
    }
    // The pinned sentence holds the label STARS and the word starfield on
    // purpose; take it out before looking for any other mention.
    const rest = title.split(NIGHT_STARS_SENTENCE).join(' ');
    const other = rest.match(STAR_WORD);
    if (other) {
      problems.push(`the NIGHT tooltip mentions "${other[0]}" outside the pinned sentence`);
    }
    return problems;
  };
  const NIGHT_PIN_ADVICE =
    'If you reworded the starfield sentence of the ☾ NIGHT tooltip on purpose, check that it is still true — ' +
    'NIGHT does not touch the starfield (the NIGHT group above holds the engine to that), and STARS is the ' +
    'switch — then update NIGHT_STARS_SENTENCE in tests/stars-toggle.test.js. Any other mention of the ' +
    'starfield or the stars belongs in that one sentence.';

  // The control's injections go in as a sentence of their own after the live
  // title's first sentence, whatever that says (FIX(review RR-C2): an
  // injection into a literal clause turned the control red on a harmless edit
  // of that clause).
  const firstStop = t => { const i = t.indexOf('. '); assert.ok(i > 0, 'the title has no second sentence to inject before'); return i + 2; };
  const nightWith = sentence => {
    const t = titleOf('night-btn');
    const at = firstStop(t);
    return `${t.slice(0, at)}${sentence} ${t.slice(at)}`;
  };

  test('the NIGHT tooltip carries the pinned starfield sentence, and no other word about the stars', () => {
    const night = titleOf('night-btn');
    assert.ok(night, '#night-btn has no title this test can read');
    assert.deepEqual(nightStarProblems(night), [], NIGHT_PIN_ADVICE);
  });

  test('control — every false sentence the earlier guards had to catch is caught, and harmless edits pass', () => {
    const night = titleOf('night-btn');
    assert.ok(night, '#night-btn has no title this test can read');
    assert.ok(nightWith('X.').includes('X. '), 'precondition: the injection lands inside the title');
    const stars = titleOf('btn-toggle-stars');
    assert.ok(stars, '#btn-toggle-stars has no title this test can read');
    // The r5 NIGHT wording on its own, and then as a sentence injected into
    // today's title; STARS's own title (true for STARS, false for NIGHT); every
    // claim FIXES3 Y3 listed; the three inversions of a leave-alone word; and
    // RR3-C1's N1-N5, which the last regexp guard passed.
    const r5 = 'Narrows the palette pool to the NIGHT series, hides the starfield, dims the grid';
    const MUST_CATCH = [
      r5,
      nightWith(`${r5}.`),
      nightWith(stars),
      nightWith('It hides the starfield.'),
      nightWith('It switches the stars off.'),
      nightWith('It removes the starfield.'),
      nightWith('It takes the stars away.'),
      nightWith('The starfield goes dark, and STARS brings it back.'),
      nightWith('It hides the starfield, which STARS brings back.'),
      nightWith('It hides the stars, not the music.'),
      nightWith('The dropdown stays free and the starfield goes dark.'),
      nightWith('It hides the starfield (STARS brings it back).'),
      nightWith('It hides the stars but not the music.'),
      nightWith('The starfield stays dark.'),
      nightWith('It does not show the stars.'),
      nightWith('The starfield is not shown.'),
      nightWith("The starfield isn't left alone; STARS switches it off."),
      nightWith('The starfield is not kept; STARS brings it back.'),
      nightWith('The starfield stays invisible; STARS switches it off.'),
      nightWith('STARS hides the starfield, and so does NIGHT.'),
      nightWith('The starfield is never left on; STARS switches it off.'),
      // RR4-1: the noun's other forms.
      nightWith('It hides the starfields.'),
      nightWith('It also hides the starry backdrop.'),
      // The pinned sentence itself altered in place, a word at a time.
      night.replace(NIGHT_STARS_SENTENCE, NIGHT_STARS_SENTENCE.replace('stays', 'goes dark')),
      night.replace(NIGHT_STARS_SENTENCE, NIGHT_STARS_SENTENCE.replace('STARS', 'NIGHT')),
      night.replace(NIGHT_STARS_SENTENCE, ''),
    ];
    for (const t of MUST_CATCH) assert.ok(nightStarProblems(t).length > 0, `not caught: ${t}`);
    assert.ok(night.includes(NIGHT_STARS_SENTENCE), 'precondition: the in-place alterations above start from the pinned sentence');

    // A harmless edit elsewhere: a new sentence with no star word, and a
    // sentence of the title that does not mention the stars, reworded — found
    // in the live title, not quoted.
    const sentences = night.split(/(?<=\.)\s+/);
    const plain = sentences.find((s, i) => i > 0 && !STAR_WORD.test(s));
    assert.ok(plain, 'precondition: the title has a sentence after the first with no star word in it');
    const MUST_PASS = [
      night,
      nightWith('It also dims the panel.'),
      night.replace(plain, plain.replace(/\.$/, ', as before.')),
      night.replace(plain, plain.toUpperCase()),
    ];
    for (const t of MUST_PASS) assert.deepEqual(nightStarProblems(t), [], `a harmless edit was refused: ${t}`);
  });
});
