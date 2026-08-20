// tests/shader-source-owner.test.js
//
// Contract test for "which GLSL program is live": RenderEngine owns it, and
// every material that draws the GPU mesh must carry it — the surface material
// and the POINTS proxy alike.
//
// Run:
//   node --test tests/shader-source-owner.test.js
//
// ── The defects this pins ─────────────────────────────────────────────────────
// There are two materials (gpuMat and the POINTS proxy) and three writers (the
// shader editor's APPLY, its RESET, and the proxy's own construction). Each
// writer used to reach a different subset:
//   • the proxy was always built from the built-in VS/FS, so an applied custom
//     shader silently vanished on clicking ⋯ PTS and reappeared in SURF —
//     indistinguishable from a random glitch;
//   • RESET restored gpuMat only, and in POINTS mode gpuMesh.visible is false,
//     so the button reported success while the picture did not change at all;
//   • a preset with no custom shader could not undo a live one for the same
//     reason, which let one shader-carrying clip step poison a whole clip.
// applyShaderSource() is the single owner all three now go through.
//
// Also pinned: an editor vertex shader must write gl_PointSize, or the same
// program installed on the proxy draws points of undefined size.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// No GL: the renderer is a stub whose debug.onShaderError never fires, which is
// exactly the "compiled successfully" path, and setVizModeGPU only builds
// three.js objects. document is stubbed for #se-code / #se-error.

import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as G from './helpers/glsl.js';

globalThis.document = {
  _els: new Map(),
  getElementById(id) {
    if (!this._els.has(id)) {
      this._els.set(id, { value: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } });
    }
    return this._els.get(id);
  },
  querySelectorAll: () => [],
};

let RenderEngine, ShaderEditor, VS, FS, THREE;
before(async () => {
  ({ RenderEngine } = await import('../src/render.js'));
  ({ ShaderEditor, VS, FS } = await import('../src/shaders.js'));
  THREE = await import('three');
});

// Everything setVizModeGPU / applyShaderSource / compileAndApply touch.
function makeRender() {
  const U = {
    uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
    uAmp: { value: 1 }, uBeat: { value: 0 }, uWI: { value: 1 },
    uPointSize: { value: 1 }, uLighting: { value: 1 }, uPtStyle: { value: 0 },
    uMode: { value: 0 }, uMathMode: { value: 0 }, uModeNext: { value: 0 },
    uMorphProgress: { value: 1 }, uModeBlend: { value: 0 },
  };
  const gpuMat  = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: U });
  const gpuMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 2, 2), gpuMat);
  const scene   = new THREE.Scene();
  scene.add(gpuMesh);
  const host = {
    U, gpuMat, gpuMesh, scene,
    gpuPtsProxy: null,
    // No imported model on the stage. The single owner reaches a model's
    // materials too — that half is pinned in tests/model-import-stage.test.js.
    modelMeshes: [],
    activeVS: VS, activeFS: FS,
    vizMode: 'surface',
    // A renderer that links cleanly by default: no onShaderError call, so
    // compileAndApply takes its real onSuccess branch. `failWith` makes a test
    // opt into a driver-shaped failure — the reason the compile-failure paths
    // were never exercised before is that this stub could not fail at all.
    failWith: null,
    renderer: {
      debug: {},
      compile() {},
      render() {
        if (!this._host.failWith) return;
        const log = this._host.failWith;
        this.debug.onShaderError?.(
          {
            getShaderInfoLog: sh => (sh === 'VS' ? log.vert ?? '' : log.frag ?? ''),
            getProgramInfoLog: () => '',
            // What the driver actually compiled. three.js prepends its own
            // preamble to every program, so this is not the string the editor
            // assembled — which is the whole point of asking for it.
            getShaderSource: sh => (sh === 'VS' ? log.srcVert : log.srcFrag) ?? null,
          },
          'PROGRAM', 'VS', 'FS',
        );
      },
      getRenderTarget() { return null; },
      setRenderTarget() {},
    },
    // Entering PTS applies the current particle style, which needs these two.
    // The style itself is pinned in tests/particle-style.test.js; here they
    // exist so setVizModeGPU can run its real body.
    currentParticleStyle: 'squares',
    afterglow: null,
    setAfterglow(on, amount) { this.afterglow = { on, amount }; },
    applyShaderSource(...a) { return RenderEngine.prototype.applyShaderSource.apply(this, a); },
    setVizModeGPU(...a)     { return RenderEngine.prototype.setVizModeGPU.apply(this, a); },
    setParticleStyle(...a)  { return RenderEngine.prototype.setParticleStyle.apply(this, a); },
  };
  host.renderer._host = host;
  return host;
}

describe('applyShaderSource — one owner, every material', () => {
  let render, se;

  beforeEach(() => {
    render = makeRender();
    se = new ShaderEditor(render);
    document._els.clear();
  });

  test('a custom shader applied in SURF survives the switch to PTS', () => {
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = vec3(1.0, 0.0, 0.0);';
    se.compileAndApply();
    assert.ok(se.customFS, 'compileAndApply did not take its success path');

    render.setVizModeGPU('points');
    assert.ok(render.gpuPtsProxy, 'points proxy was not built');
    assert.equal(render.gpuPtsProxy.material.vertexShader,   se.customVS);
    assert.equal(render.gpuPtsProxy.material.fragmentShader, se.customFS);
  });

  test('a custom shader applied while already in PTS reaches the visible material', () => {
    render.setVizModeGPU('points');
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = vec3(0.0, 1.0, 0.0);';
    se.compileAndApply();
    assert.equal(render.gpuPtsProxy.material.fragmentShader, se.customFS);
  });

  test('RESET puts the built-ins back on the points proxy, not just on gpuMat', () => {
    render.setVizModeGPU('points');
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = vec3(1.0, 0.0, 0.0);';
    se.compileAndApply();
    se.reset();
    assert.equal(se.customVS, null);
    assert.equal(render.gpuMat.vertexShader,   VS);
    assert.equal(render.gpuMat.fragmentShader, FS);
    assert.equal(render.gpuPtsProxy.material.vertexShader,   VS);
    assert.equal(render.gpuPtsProxy.material.fragmentShader, FS);
  });

  test('revertToBuiltIn restores the program without touching the editor text', () => {
    se._tab = 'frag';
    const body = 'c = vec3(1.0, 0.0, 0.0);';
    document.getElementById('se-code').value = body;
    se.compileAndApply();
    const textBefore = se._frag;
    se.revertToBuiltIn();
    assert.equal(render.gpuMat.fragmentShader, FS);
    assert.equal(se.customFS, null);
    assert.equal(se._frag, textBefore, 'revertToBuiltIn must not stomp the buffers');
  });

  test('a proxy built after a revert inherits the built-ins', () => {
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = vec3(1.0, 0.0, 0.0);';
    se.compileAndApply();
    se.revertToBuiltIn();
    render.setVizModeGPU('points');
    assert.equal(render.gpuPtsProxy.material.fragmentShader, FS);
  });

  test('an editor vertex program writes gl_PointSize', () => {
    // Without it the same program on the POINTS proxy draws undefined-size
    // points — one visible glitch traded for another.
    se._tab = 'vert';
    document.getElementById('se-code').value = 'y = sin(r*3.0)*a;';
    se.compileAndApply();
    assert.match(se.customVS, /gl_PointSize\s*=/);
    assert.match(se.customVS, /uniform float[^;]*uPointSize/);
  });
});

// ── Compile feedback ──────────────────────────────────────────────────────────
// Neither of these could be reached before: the stub renderer above always
// linked cleanly, so every failure path in compileAndApply was unexecuted by the
// whole suite. That is why both defects survived two audits.
//
// 1. The 2 s "✔ Compiled & applied" tidy-up was armed and never cancelled, so a
//    failure arriving within two seconds — including the ordinary case of
//    pressing APPLY twice while fixing a typo — had its red message and its
//    line number wiped by the previous run's timer. Same defect as the camera
//    programmer's status line, in the other editor.
// 2. The error-line highlight was computed against the VERTEX body whatever tab
//    was on screen: _parseErrorLine got `fullFS` as the source and `vertBody` as
//    the user text, so the preamble length was the difference between two
//    unrelated buffers and the gutter marked a line the operator never wrote.
describe('compile feedback survives the run that came before it', () => {
  let render, se, results;

  beforeEach(() => {
    render = makeRender();
    se = new ShaderEditor(render);
    document._els.clear();
    results = [];
    se.cb.onCompileResult = r => results.push(r);
  });

  test('a failure is not blanked by the previous success timer', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    se._tab = 'frag';

    document.getElementById('se-code').value = 'c = vec3(1.0, 0.0, 0.0);';
    se.compileAndApply();                                   // ✔, arms the 2 s timer
    assert.equal(results.at(-1).ok, true);

    render.failWith = { frag: "ERROR: 0:99: 'nope' : undeclared identifier" };
    document.getElementById('se-code').value = 'c = nope;';
    se.compileAndApply();                                   // ⚠ one keystroke later
    assert.equal(results.at(-1).ok, false, 'precondition: the failure was reported');

    t.mock.timers.tick(2000);

    assert.equal(results.at(-1).ok, false,
      'the timer belongs to the message that armed it, not to the status line');
    assert.notEqual(document.getElementById('se-error').textContent, '',
      'the red message is the only thing telling the operator what broke');
  });

  test('control — an uninterrupted success still tidies itself away', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = vec3(1.0, 0.0, 0.0);';
    se.compileAndApply();

    t.mock.timers.tick(2000);

    assert.equal(results.at(-1).ok, true);
    assert.equal(results.at(-1).message, '', '"✔ Compiled & applied" is transient by design');
    assert.equal(document.getElementById('se-error').textContent, '');
  });
});

describe('the error line points at the line the operator wrote', () => {
  let render, se, results;

  beforeEach(() => {
    render = makeRender();
    se = new ShaderEditor(render);
    document._els.clear();
    results = [];
    se.cb.onCompileResult = r => results.push(r);
  });

  /** Where the body starts inside the assembled program, learned from a clean compile. */
  const preambleFor = (se, tab, body) => {
    se._tab = tab;
    document.getElementById('se-code').value = body;
    se.compileAndApply();
    const assembled = tab === 'vert' ? se.customVS : se.customFS;
    return assembled.slice(0, assembled.indexOf(body)).split('\n').length - 1;
  };

  test('on the FRAGMENT tab it counts from the fragment body', () => {
    const body = ['float a = 1.0;', 'float b = 2.0;', 'c = vec3(BAD);'].join('\n');
    const preamble = preambleFor(se, 'frag', body);

    render.failWith = { frag: `ERROR: 0:${preamble + 3}: 'BAD' : undeclared identifier` };
    se.compileAndApply();

    assert.equal(results.at(-1).line, 3,
      'the gutter marks this line in the editor — off by the wrong buffer it marks nothing useful');
  });

  test('on the VERTEX tab it counts from the vertex body', () => {
    const body = ['float k = 1.0;', 'y = BAD;'].join('\n');
    const preamble = preambleFor(se, 'vert', body);

    render.failWith = { vert: `ERROR: 0:${preamble + 2}: 'BAD' : undeclared identifier` };
    se.compileAndApply();

    assert.equal(results.at(-1).line, 2);
  });

  test('control — a log with no line number reports none', () => {
    se._tab = 'frag';
    document.getElementById('se-code').value = 'c = vec3(1.0);';
    render.failWith = { frag: 'Shader failed to link' };
    se.compileAndApply();

    assert.equal(results.at(-1).ok, false);
    assert.equal(results.at(-1).line, null);
  });

  test('a line outside the body reports none rather than a wrong one', () => {
    const body = 'c = vec3(1.0);';
    const preamble = preambleFor(se, 'frag', body);

    render.failWith = { frag: `ERROR: 0:${preamble + 40}: something in the template` };
    se.compileAndApply();

    assert.equal(results.at(-1).line, null,
      'a number the gutter cannot paint is worse than no number at all');
  });
});

// The driver numbers its message against the source IT compiled, and three.js
// prepends a preamble (precision qualifiers, defines, built-in uniforms) to
// everything it hands to the GL. Counting from the editor's own assembled
// string therefore lands short by that preamble's length — in a browser, by
// enough to push every reported line outside the body and paint nothing at all.
describe('the error line survives the preamble three.js adds', () => {
  let render, se, results;

  beforeEach(() => {
    render = makeRender();
    se = new ShaderEditor(render);
    document._els.clear();
    results = [];
    se.cb.onCompileResult = r => results.push(r);
  });

  const DRIVER_PREAMBLE = ['#version 300 es', 'precision highp float;', '#define USE_FOG 1', ''].join('\n');

  test('a line is reported relative to the body, preamble and all', () => {
    const body = ['float a = 1.0;', 'c = vec3(BAD);'].join('\n');
    se._tab = 'frag';
    document.getElementById('se-code').value = body;
    se.compileAndApply();                                  // clean run: learn our own assembly
    const driverSrc = DRIVER_PREAMBLE + se.customFS;
    const before    = driverSrc.slice(0, driverSrc.indexOf(body)).split('\n').length - 1;

    render.failWith = {
      frag: `ERROR: 0:${before + 2}: 'BAD' : undeclared identifier`,
      srcFrag: driverSrc,
    };
    se.compileAndApply();

    assert.equal(results.at(-1).line, 2,
      'counted from the editor\'s own string this lands outside the body and paints nothing');
  });

  test('a failure in the other tab paints no line at all', () => {
    const body = 'c = vec3(1.0);';
    se._tab = 'frag';
    document.getElementById('se-code').value = body;
    se.compileAndApply();
    const driverSrc = DRIVER_PREAMBLE + se.customVS;

    // The vertex stage failed while the operator is looking at FRAGMENT, and
    // the number it reports is deliberately one that WOULD land on line 1 of
    // the fragment body if it were misattributed — so "null" here can only come
    // from noticing the stage, not from the range check downstream.
    const fragPreamble = se.customFS.slice(0, se.customFS.indexOf(body)).split('\n').length - 1;
    render.failWith = {
      vert: `ERROR: 0:${fragPreamble + 1}: something in the vertex program`,
      srcVert: driverSrc,
    };
    se.compileAndApply();

    assert.equal(results.at(-1).ok, false, 'the failure is still reported');
    assert.equal(results.at(-1).line, null,
      'a line number counted through the other buffer marks text the operator did not write');
  });
});

// An editor vertex program replaces the built-in one wholesale, so it also
// inherits the built-in's responsibilities. The template declared
// uMorphProgress and never read it, so with a custom shader live the shape
// morph — which drives that uniform 1 → 0 → 1 and swaps the geometry at the
// flat frame — did nothing visible: no deflate, no inflate, just a hard cut
// mid-animation. Every path that changes shape goes through it: D, R, a preset,
// a clip step.
describe('an editor vertex program still morphs', () => {
  let render, se;

  beforeEach(() => {
    render = makeRender();
    se = new ShaderEditor(render);
    document._els.clear();
  });

  // Statements, not lines; comments out first; and both the statement and the
  // uniform it must name are read as TOKENS rather than matched as text. Each
  // of those is a repair of a measured defect, not tidying:
  //
  //   • LINES. `src.split('\n').filter(l => /pos\.y\s*=/.test(l))` reads a
  //     write reflowed across two lines as a line that has lost
  //     uMorphProgress. Row C1 of the round-10 matrix is exactly that — the VS
  //     write wrapped after `(pos.y + f)`, arithmetic untouched — and it turned
  //     the CONTROL below red. A control that fires on a behaviour-preserving
  //     edit is not measuring what it claims to; this one was measuring source
  //     layout.
  //   • COMMENTS. The same line read prose as code (blind spot D3 of the
  //     round-10 matrix). Its live cost was already paid: the agent that wrote
  //     the FIX note in src/shaders.js reports spelling an example out in
  //     English instead of GLSL to keep this test green — prose shaped to fit a
  //     regexp, which is the habit that produces guards like this one. The
  //     example is back in GLSL in shaders.js and stays green because of the
  //     stripping here; narrowing it puts that file red.
  //   • TOKENS. `assert.match(stmt, /uMorphProgress/)` is a substring search: a
  //     local called `uMorphProgressScale`, or the name inside a string, would
  //     satisfy it. tests/helpers/glsl.js tokenises, so the rule is that the
  //     statement READS that uniform.
  //
  // Verified both ways in wave 2: C1 and a comment carrying an unscaled write
  // (row C7) both leave this file green now, and the defect the file exists for
  // (row A11, the CPU write losing uMorphProgress) still turns it red.
  const yWrites = src =>
    G.splitStatements(src).filter(s => G.assignsTo(s, ['pos', 'y']));
  const names = stmt => new Set(stmt.filter(t => t.t === 'id').map(t => t.v));
  const show = stmt => G.text(stmt);

  test('every pos.y it writes is scaled by uMorphProgress', () => {
    se._tab = 'vert';
    document.getElementById('se-code').value = 'y = sin(r*3.0)*a;';
    se.compileAndApply();

    const writes = yWrites(se.customVS);
    assert.ok(writes.length, 'precondition: the template writes pos.y at all');
    for (const stmt of writes) {
      assert.ok(names(stmt).has('uMorphProgress'),
        `a shape swap deflates through this uniform; unscaled, the morph is a cut: ${show(stmt)}`);
    }
  });

  test('control — the built-in VS it mirrors satisfies the same rule', () => {
    const writes = yWrites(VS);
    assert.ok(writes.length);
    for (const stmt of writes) assert.ok(names(stmt).has('uMorphProgress'), show(stmt));
  });

  test('the reader behind those two: statements, and no prose', () => {
    // Without this the rule above is only as good as a reader nobody measured.
    const reflowed = 'vec3 pos = position;\npos.y = (pos.y + f)\n    * uMorphProgress;';
    assert.deepEqual(yWrites(reflowed).map(show), ['pos.y=(pos.y+f)*uMorphProgress'],
      'a write reflowed across two lines still reads as one write — this is row C1, the ' +
      'behaviour-preserving edit that used to turn the control above red');
    // …and the same write typed six other ways is the same one write. Every
    // one of these turned a guard red in wave 2 while changing nothing.
    for (const src of ['pos.y=(pos.y+f)*uMorphProgress;',
                       'pos.y = ( pos.y + f ) * uMorphProgress ;',
                       'pos.y=(f+pos.y)*uMorphProgress;',
                       'pos.y=uMorphProgress*(pos.y+f);',
                       'pos.y=((pos.y+f))*(uMorphProgress);',
                       'pos.y\n=\n(pos.y\n+\nf)\n*\nuMorphProgress;']) {
      const w = yWrites(src);
      assert.equal(w.length, 1, `${src} read as ${w.length} writes`);
      assert.ok(names(w[0]).has('uMorphProgress'), src);
    }

    const commented = 'void main(){\n  // before round 10 this was pos.y = f;\n' +
      '  /* and once pos.y += f; */\n  pos.y = (pos.y + f) * uMorphProgress;\n}';
    assert.equal(yWrites(commented).length, 1,
      'the reader is counting comments as writes; it would report a defect in a file that ' +
      'only DESCRIBES one, which is what taught an author to reword src/shaders.js');

    // It must still see the thing it is for: an unscaled write is one write,
    // and it is the one that fails the rule.
    const unscaled = 'vec3 pos = position;pos.y = pos.y;';
    assert.deepEqual(yWrites(unscaled).map(show), ['pos.y=pos.y']);
    assert.ok(!names(yWrites(unscaled)[0]).has('uMorphProgress'));

    // …and a READ of pos.y is not a write. `vH = (pos.y - aBaseY) * p` is the
    // CPU branch's colour line and must not be dragged in. Nor is a comparison,
    // nor a member of something else.
    for (const src of ['vH = (uVHField == 1) ? (pos.y - aBaseY) * uMorphProgress : pos.y * uMorphProgress;',
                       'if (pos.y == 0.0) { }',
                       'other.pos.y = 1.0;',
                       'mypos.y = 1.0;']) {
      assert.deepEqual(yWrites(src).map(show), [], src);
    }

    // A write wrapped in a conditional or a bare block is still a write, and
    // this reader must not step over it — that evasion put the pre-round-10
    // defect back past every guard in the repo (wave-2 rows A1, A1b).
    for (const src of ['if(uMathMode==0)pos.y=f;', '{pos.y=f;}']) {
      const w = yWrites(src);
      assert.equal(w.length, 1, src);
      assert.ok(!names(w[0]).has('uMorphProgress'), src);
    }

    // The uniform is read as a NAME, not as a substring of the text.
    const lookalike = 'pos.y = (pos.y + f) * uMorphProgressScale;';
    assert.equal(yWrites(lookalike).length, 1);
    assert.ok(!names(yWrites(lookalike)[0]).has('uMorphProgress'),
      'a longer identifier containing uMorphProgress satisfied the rule');
  });
});

// ── The draft buffers, and the tab that hands them over ──────────────────────
//
// This file reasons at length about _vert/_frag being draft buffers "the
// gallery, switchTab and compileAndApply's own pre-compile write all move
// without anything having been applied" (shaders.js), and presets.js says the
// same thing where it snapshots them. switchTab is named as the writer in two
// places and was executed by nothing: coverage marked its whole body dead, and
// deleting its save-on-leave left the suite green.
//
// What that loses is the operator's typing. Its first two lines are the only
// write-back of the textarea into the buffer before the textarea is repainted
// with the other tab's body, so without them a VERT → FRAG → VERT round trip —
// the ordinary act of checking a uniform name — silently restores the stale
// draft, with no undo. It propagates too: presets.js snapshots `vert: se._vert,
// frag: se._frag`, so the preset saved afterwards stores the stale body as well.
describe('switchTab hands the editor buffer over without losing the draft', () => {
  let render, se, tabs, qsaBefore;

  beforeEach(() => {
    render = makeRender();
    se = new ShaderEditor(render);
    document._els.clear();
    // The two tab buttons modals.js binds the click to, each recording whether
    // switchTab left it marked active.
    tabs = ['vert', 'frag'].map(name => {
      const el = { dataset: { tab: name }, active: null };
      el.classList = { toggle: (_cls, on) => { el.active = on; } };
      return el;
    });
    qsaBefore = document.querySelectorAll;
    document.querySelectorAll = sel => (sel === '#shader-editor-box .se-tab' ? tabs : []);
  });

  afterEach(() => {
    document.querySelectorAll = qsaBefore;
    delete document.createElement;
  });

  const shown = () => document.getElementById('se-code').value;
  const type  = s => { document.getElementById('se-code').value = s; };
  const activeTab = () => tabs.filter(t => t.active).map(t => t.dataset.tab);

  test('a vertex draft survives the trip to FRAG and back', () => {
    const NEW_VERT = 'y = sin(r * 9.0) * a;   // the operator\'s work';
    assert.equal(se._tab, 'vert', 'precondition: the editor opens on the vertex tab');
    type(NEW_VERT);

    se.switchTab('frag');
    assert.equal(se._vert, NEW_VERT,
      'leaving the tab must bank the draft — this is the only place it is written back');
    assert.equal(shown(), se._frag, 'the FRAG tab must show the fragment body');
    assert.notEqual(shown(), NEW_VERT, 'the FRAG tab is showing the vertex draft');

    se.switchTab('vert');
    assert.equal(shown(), NEW_VERT,
      'the vertex draft was repainted from a stale buffer — everything typed is gone');
  });

  test('a fragment draft survives the trip to VERT and back', () => {
    // The mirror case: the save-on-leave has two branches and only one of them
    // is exercised by the round trip above.
    const NEW_FRAG = 'c = vec3(0.2, 0.9, 0.4);   // the operator\'s work';
    se.switchTab('frag');
    type(NEW_FRAG);

    se.switchTab('vert');
    assert.equal(se._frag, NEW_FRAG);
    assert.equal(shown(), se._vert);

    se.switchTab('frag');
    assert.equal(shown(), NEW_FRAG);
  });

  test('the tab it switches to is the one marked active', () => {
    se.switchTab('frag');
    assert.deepEqual(activeTab(), ['frag'], 'the highlight names the tab on screen');
    se.switchTab('vert');
    assert.deepEqual(activeTab(), ['vert']);
  });

  test('the switch announces the tab and the body now on screen', () => {
    // modals.js repaints the editor from this callback; a body that disagrees
    // with the textarea is the same lost-draft bug one layer up.
    const seen = [];
    se.cb.onTabSwitch = (tab, code) => seen.push([tab, code]);
    type('y = 1.0;');
    se.switchTab('frag');

    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], ['frag', shown()]);
    assert.equal(se._tab, 'frag', 'the editor must know which buffer it is on');
  });

  test('compileAndApply reads the buffer switchTab last wrote, not the abandoned one', () => {
    // The consequence the buffers exist for: what APPLY compiles has to be the
    // draft the operator is looking at.
    const NEW_FRAG = 'c = vec3(1.0, 0.0, 1.0);';
    type('y = sin(r) * a;');
    se.switchTab('frag');
    type(NEW_FRAG);
    se.compileAndApply();

    assert.ok(se.customFS, 'precondition: the compile took its success path');
    assert.ok(se.customFS.includes(NEW_FRAG), 'APPLY compiled a body the operator is not looking at');
  });

  test('a gallery preset for the other tab banks the draft before it switches', () => {
    // _buildPresets is switchTab's only other caller and was equally unrun.
    // Each preset is clicked on its own fresh editor, because a preset for the
    // tab you are already on legitimately replaces the draft.
    document.createElement = () => ({ classList: {} });
    const NEW_VERT = 'y = cos(r * 2.0) * a;';
    const gallery = editor => {
      const wrap = { innerHTML: '', children: [], appendChild(c) { this.children.push(c); } };
      wrap.appendChild = c => wrap.children.push(c);
      document._els.set('se-preset-wrap', wrap);
      editor._buildPresets();
      return wrap;
    };

    const count = gallery(se).children.length;
    assert.ok(count, 'precondition: the gallery built buttons at all');

    let crossed = 0;
    for (let i = 0; i < count; i++) {
      const ed = new ShaderEditor(render);
      const wrap = gallery(ed);
      type(NEW_VERT);                       // unsaved work on the VERT tab
      wrap.children[i].onclick();
      if (ed._tab === 'vert') continue;     // a VERT preset is entitled to replace it
      crossed++;
      assert.equal(ed._vert, NEW_VERT,
        `gallery preset #${i} crossed to ${ed._tab} and threw the vertex draft away`);
    }
    assert.ok(crossed, 'precondition: the gallery has at least one preset for the other tab');
  });
});
