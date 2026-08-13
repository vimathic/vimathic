// tests/solar-system.test.js
//
// Contract test for the Solar System shape: its data table, and the handful of
// pure functions that decide where each planet goes and which way it turns.
//
// Run:
//   node --test tests/solar-system.test.js
//
// ── What this pins, and why it needs pinning ──────────────────────────────────
// The eight planets are built from published orbital and physical elements and
// then squeezed through two power laws, because at true scale Neptune is 78×
// Mercury's distance and Jupiter is 29× Mercury's width — a frame that holds
// one end of that renders the other as a pixel. The compression is allowed to
// change the NUMBERS. It is not allowed to change what the numbers mean:
//
//   • the running order — anything that reorders the planets is a defect that
//     no screenshot catches, because eight lit spheres look right in any order;
//   • the direction of every ratio (farther stays farther, bigger stays bigger,
//     farther stays slower);
//   • the fact that the compression actually compresses — a power law with the
//     wrong exponent silently reverts to true scale, and true scale is the
//     unrenderable case this whole scheme exists to avoid;
//   • perihelion clearance, so nothing dives into the sun's geometry. This one
//     is invisible in a still and obvious in motion, four minutes in;
//   • WHERE each planet is put and WHICH WAY it spins. The first version of
//     render.js got both wrong by a sign — every orbit was mirrored about the
//     line of nodes, and Venus and Uranus turned the wrong way — and the first
//     version of THIS file passed 12/12 while it happened, because every
//     assertion read the table and none of them read the arithmetic. So the
//     placement conventions are now functions (planeEuler, theta0, spinRate,
//     moonRate) and this file drives them.
//
// The ring tables get the same treatment: they are real band radii in planet
// radii, and the profile that composites them is exported, so "a gap is darker
// than the ring it cuts through" is asserted against the code that paints it
// rather than against a model of that code re-derived here. Re-deriving is how
// the first version managed to pass while Saturn's Encke gap painted brighter
// than the A ring around it.
//
// Still NOT covered here, and known: anything that needs a canvas or a GPU —
// the surface painters, the crater pass, the atmosphere shader, the light rig.
// What those LOOK like was checked against the GPU, not asserted in this file.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

let SOLAR, PLANETS, MOON, RINGS, au2u, re2u, orbitR, planeEuler, theta0, spinRate, moonRate, ringProfile;
let RenderEngine;
before(async () => {
  const mod = await import('../src/render.js');
  ({ SOLAR_MODEL: { SOLAR, PLANETS, MOON, RINGS, au2u, re2u, orbitR,
                    planeEuler, theta0, spinRate, moonRate, ringProfile } } = mod);
  ({ RenderEngine } = mod);
});

const NAMES = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
const rad = d => d * Math.PI / 180;
const deg = r => ((r * 180 / Math.PI) % 360 + 360) % 360;
const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;   // to (−180, 180]

describe('the planets', () => {
  test('all eight are present, in orbital order, and no more', () => {
    assert.deepEqual(PLANETS.map(p => p.name), NAMES);
  });

  test('every field the builder reads is a finite number', () => {
    for (const p of PLANETS) {
      for (const k of ['au', 're', 'ecc', 'incl', 'node', 'peri', 'L0', 'tilt', 'day']) {
        assert.ok(Number.isFinite(p[k]), `${p.name}.${k} is ${p[k]}`);
      }
      // tex sizes the canvas. Left out of this list at first, which is the one
      // omission that can throw rather than merely look wrong: a missing tex
      // makes the canvas NaN wide and _paint dies inside the morph's flat frame,
      // leaving the central surface collapsed and the planets lit by the studio
      // rig, because the light swap never runs.
      assert.ok(Number.isInteger(p.tex) && p.tex > 0, `${p.name}.tex is ${p.tex}`);
      assert.notEqual(p.day, 0, `${p.name} would divide by zero computing its spin`);
      assert.ok(p.ecc >= 0 && p.ecc < 1, `${p.name} eccentricity ${p.ecc} is not an ellipse`);
    }
  });

  test('albedo is present and sane, though only the exposure argument reads it', () => {
    // No code path consumes p.albedo — it is the input to the hand-done exposure
    // calculation recorded in _solarLighting's docblock. Checked anyway, and
    // deliberately not in the list above: that list is named after the builder.
    for (const p of PLANETS) assert.ok(p.albedo > 0 && p.albedo <= 1, `${p.name} albedo ${p.albedo}`);
  });

  test('distance and radius both keep their running order after compression', () => {
    for (let i = 1; i < PLANETS.length; i++) {
      assert.ok(au2u(PLANETS[i].au) > au2u(PLANETS[i - 1].au),
        `${PLANETS[i].name} is not outside ${PLANETS[i - 1].name}`);
    }
    // Radius order is not the orbital order — Uranus and Neptune are smaller
    // than Saturn — so this compares against the real radii directly.
    const byReal = [...PLANETS].sort((a, b) => a.re - b.re);
    const byScene = [...PLANETS].sort((a, b) => re2u(a.re) - re2u(b.re));
    assert.deepEqual(byScene.map(p => p.name), byReal.map(p => p.name));
  });

  test('the compression compresses — both spreads shrink by a large factor', () => {
    const realD = PLANETS.at(-1).au / PLANETS[0].au;          // ≈ 78
    const sceneD = au2u(PLANETS.at(-1).au) / au2u(PLANETS[0].au);
    assert.ok(sceneD > 1 && sceneD < realD / 8,
      `distance spread ${sceneD.toFixed(1)}× is not a compression of ${realD.toFixed(0)}×`);

    const big = PLANETS.reduce((m, p) => p.re > m.re ? p : m);
    const small = PLANETS.reduce((m, p) => p.re < m.re ? p : m);
    const realR = big.re / small.re;                          // ≈ 29
    const sceneR = re2u(big.re) / re2u(small.re);
    assert.ok(sceneR > 1 && sceneR < realR / 5,
      `radius spread ${sceneR.toFixed(1)}× is not a compression of ${realR.toFixed(0)}×`);
  });

  test('Kepler III on the compressed radii still slows every planet down in turn', () => {
    const dEarth = au2u(1);
    const rate = p => SOLAR.speed * Math.pow(dEarth / au2u(p.au), 1.5) * Math.sqrt(1 - p.ecc * p.ecc);
    for (let i = 1; i < PLANETS.length; i++) {
      assert.ok(rate(PLANETS[i]) < rate(PLANETS[i - 1]),
        `${PLANETS[i].name} does not orbit slower than ${PLANETS[i - 1].name}`);
    }
    // And the slowest still moves: a planet that takes an hour to cross a
    // degree is indistinguishable from a bug that froze it.
    const frames = 2 * Math.PI / rate(PLANETS.at(-1));
    assert.ok(frames < 60 * 60 * 5, `Neptune needs ${(frames / 60 / 60).toFixed(1)} min per orbit`);
  });

  test('no perihelion reaches the sun, whose geometry is 1.2 units in RADIUS', () => {
    // 1.2 is the radius of the sphere the math surface deforms, not its width.
    // The margin this protects is 1.465 − 1.2 = 0.265 units, not 0.85; getting
    // that wrong is how someone talks themselves into lowering distK.
    for (const p of PLANETS) {
      const peri = au2u(p.au) * (1 - p.ecc) - re2u(p.re);
      assert.ok(peri > 1.45, `${p.name} closes to ${peri.toFixed(2)} at perihelion`);
    }
  });

  test('the two retrograde rotators are the two that really are', () => {
    assert.deepEqual(PLANETS.filter(p => p.day < 0).map(p => p.name), ['Venus', 'Uranus']);
    // And Uranus is the one lying on its side.
    assert.ok(PLANETS.find(p => p.name === 'Uranus').tilt > 90);
  });

  test('every planet names a painter that exists, and the Moon comes with one', () => {
    const known = new Set(['rock', 'venus', 'earth', 'giant']);
    for (const p of [...PLANETS, MOON]) assert.ok(known.has(p.paint), `${p.name} paints as "${p.paint}"`);
    // Each painter reads a different set of fields, so each set is checked.
    for (const p of [...PLANETS, MOON].filter(p => p.paint === 'rock')) {
      for (const k of ['base', 'dark', 'light', 'maria', 'craters', 'craterInk']) {
        assert.ok(p[k] !== undefined, `${p.name} is missing ${k}`);
      }
    }
    for (const p of PLANETS.filter(p => p.paint === 'venus')) {
      for (const k of ['base', 'dark', 'light']) assert.ok(p[k] !== undefined, `${p.name} is missing ${k}`);
    }
    for (const p of PLANETS.filter(p => p.paint === 'giant')) {
      for (const k of ['zone', 'belt', 'polar', 'bands', 'warp', 'grain', 'polarFrom']) {
        assert.ok(p[k] !== undefined, `${p.name} is missing ${k}`);
      }
      assert.ok(p.bands.length > 0 && p.bands.every(b => b.length === 3));
    }
  });
});

// ── Placement ────────────────────────────────────────────────────────────────
// _buildSolarSystem needs a canvas and a GPU, so what is rebuilt here is the
// node chain it builds — plane → pivot → holder → tilt — out of the same
// functions it calls. Only the two lines that cannot be exported are repeated:
// pivot.rotation.y = +theta, and an orbit point written as (cos θ, 0, −sin θ).
describe('where the planets are put, and which way they turn', () => {
  const chain = (p, theta) => {
    const plane = new THREE.Object3D(); plane.rotation.copy(planeEuler(p));
    const pivot = new THREE.Object3D(); plane.add(pivot); pivot.rotation.y = theta;
    const holder = new THREE.Object3D(); pivot.add(holder);
    holder.position.x = orbitR(au2u(p.au), p.ecc, theta - rad(p.peri - p.node));
    const tilt = new THREE.Object3D(); tilt.rotation.order = 'YXZ';
    tilt.rotation.z = rad(p.tilt); tilt.rotation.y = -theta; holder.add(tilt);
    plane.updateMatrixWorld(true);
    return { plane, holder, tilt };
  };
  const worldPos = (p, theta) => new THREE.Vector3().setFromMatrixPosition(chain(p, theta).holder.matrixWorld);
  const longitude = v => deg(Math.atan2(-v.z, v.x));

  test('each planet starts at its published J2000 mean longitude', () => {
    // The sign that was wrong: with Ry(−Ω) instead of Ry(+Ω) every planet lands
    // at L0 − 2Ω. Mercury was 97° from where the table says, Venus 153°, and
    // Earth was right — because its node is 0, which is exactly why nothing
    // looked wrong. Tolerance is 0.5°: the residual is the reduction to the
    // ecliptic, which is real (0.16° for Mercury's 7° inclination).
    for (const p of PLANETS) {
      const err = wrap(longitude(worldPos(p, theta0(p))) - p.L0);
      assert.ok(Math.abs(err) < 0.5,
        `${p.name} starts at ${longitude(worldPos(p, theta0(p))).toFixed(2)}°, table says ${p.L0}° (off by ${err.toFixed(2)}°)`);
    }
  });

  test('θ = 0 is the ASCENDING node: on the ecliptic, at Ω, heading north', () => {
    for (const p of PLANETS) {
      const at0 = worldPos(p, 0), after = worldPos(p, 0.1);
      assert.ok(Math.abs(at0.y) < 1e-9, `${p.name} is ${at0.y} off the ecliptic at θ=0`);
      assert.ok(Math.abs(wrap(longitude(at0) - p.node)) < 1e-6,
        `${p.name}'s node is at ${longitude(at0).toFixed(3)}°, table says ${p.node}°`);
      if (p.incl > 0) assert.ok(after.y > 0, `${p.name} DESCENDS through its ascending node`);
    }
  });

  test('the sense each planet turns matches the sign of its rotation period', () => {
    // The obliquity already carries the direction — Venus's 177° and Uranus's
    // 98° put the positive pole under the orbit — so multiplying the rate by
    // sign(day) as well turned both of them back to prograde. Measured on the
    // real chain: the spin axis in world space, against the orbit normal.
    for (const p of PLANETS) {
      const { plane, tilt } = chain(p, 0.7);
      const axis = new THREE.Vector3(0, 1, 0).transformDirection(tilt.matrixWorld);
      const normal = new THREE.Vector3(0, 1, 0).transformDirection(plane.matrixWorld);
      assert.equal(Math.sign(spinRate(p) * axis.dot(normal)), Math.sign(p.day),
        `${p.name} turns the wrong way on screen`);
    }
  });

  test('the spin axis holds still in the sky as the planet goes round', () => {
    for (const p of PLANETS) {
      const at = th => new THREE.Vector3(0, 1, 0).transformDirection(chain(p, th).tilt.matrixWorld);
      const ref = at(0);
      for (const th of [0.4, 1.9, 3.3, 5.7]) {
        assert.ok(at(th).distanceTo(ref) < 1e-9, `${p.name}'s axis swings with its orbit`);
      }
    }
  });

  test('the Moon rate is a phase cycle, because its frame is dragged along', () => {
    // moonPivot hangs off `holder`, whose +X points away from the sun, so what
    // this rate advances is the Moon's angle from the sun: a phase cycle. The
    // sidereal month belongs in that slot only if the frame is NOT dragged, and
    // it is. Against Earth's own day, 29.5 real days compress to ~3.9.
    //
    // Honest about its own reach: this cannot tell the synodic month from the
    // sidereal one. Through the 0.4 power, 27.32 gives 3.76 and 29.53 gives 3.88
    // — both inside any tolerance a test could defend. Which month belongs in
    // that slot is an argument, made in the comment on _moonRate; what is checked
    // here is the order of magnitude (a moon that took a scene-year to go round
    // would be a bug you could see) and the sign of the drag.
    const earth = PLANETS.find(p => p.name === 'Earth');
    const daysPerCycle = spinRate(earth) / moonRate;
    assert.ok(daysPerCycle > 3.4 && daysPerCycle < 4.4,
      `${daysPerCycle.toFixed(2)} apparent Earth days per lunar phase cycle`);
    // And the drag is real and has the right sign: against the stars the Moon
    // comes round sooner than its phases repeat.
    const n = SOLAR.speed * Math.pow(au2u(1) / au2u(earth.au), 1.5) * Math.sqrt(1 - earth.ecc ** 2);
    assert.ok(2 * Math.PI / (moonRate + n) < 2 * Math.PI / moonRate);
  });
});

describe('the rings', () => {
  const alphaAt = (bands, r) => { const out = [0, 0, 0, 0]; ringProfile(bands)(r, out); return out[3]; };

  test('every planet that claims rings has a table, and every table is used', () => {
    const claimed = PLANETS.filter(p => p.rings).map(p => p.rings);
    assert.deepEqual([...claimed].sort(), Object.keys(RINGS).sort());
    for (const p of PLANETS.filter(p => p.rings)) assert.equal(p.rings, p.name);
  });

  test('bands run outward, sit outside the planet, and stay inside its neighbourhood', () => {
    for (const [name, bands] of Object.entries(RINGS)) {
      for (const [r0, r1, alpha, colour] of bands) {
        assert.ok(r1 > r0, `${name}: band ${r0}–${r1} is inside out`);
        assert.ok(r0 >= 1.0, `${name}: band starts at ${r0}, inside the planet`);
        assert.ok(r1 <= 3.2, `${name}: band reaches ${r1} planet radii`);
        assert.ok(alpha > 0 && alpha <= 1, `${name}: opacity ${alpha}`);
        assert.ok(Number.isInteger(colour) && colour >= 0 && colour <= 0xffffff, `${name}: colour ${colour}`);
      }
    }
  });

  test('a nested faint band paints as a GAP, not as a bright line', () => {
    // Saturn's Encke gap is the case that matters: a 0.06 band inside the 0.64
    // A ring. While the profile summed coverage instead of overriding it, that
    // came out as the most opaque line in the ring system — 0.64 + 0.06 — i.e.
    // the one feature meant to be a hole was the one thing you could see.
    let checked = 0;
    for (const [name, bands] of Object.entries(RINGS)) {
      for (const [r0, r1, ba] of bands) {
        const host = bands.find(([h0, h1, ha]) => h0 < r0 && h1 > r1 && ha > ba);
        if (!host) continue;
        checked++;
        const inside = alphaAt(bands, (r0 + r1) / 2);
        // Reference point: inside the host, clear of the gap, on the roomier side.
        const ref = (r0 - host[0]) > (host[1] - r1)
          ? alphaAt(bands, (host[0] + r0) / 2)
          : alphaAt(bands, (r1 + host[1]) / 2);
        assert.ok(inside < ref * 0.9,
          `${name}: the ${r0}–${r1} band paints at ${inside.toFixed(3)} against ${ref.toFixed(3)} around it`);
      }
    }
    assert.ok(checked > 0, 'no nested band in any table — this test stopped testing anything');
  });

  test('no junction between abutting bands opens a transparent seam', () => {
    // Edge ramps held inside each span made both neighbours reach zero at the
    // radius they share: the B ring came out cut in half by a see-through line.
    let checked = 0;
    for (const [name, bands] of Object.entries(RINGS)) {
      for (const [, r1, ba] of bands) {
        const next = bands.find(([s0]) => Math.abs(s0 - r1) < 1e-9);
        if (!next) continue;
        checked++;
        const a = alphaAt(bands, r1), floor = Math.min(ba, next[2]) * 0.4;
        assert.ok(a >= floor, `${name}: alpha falls to ${a.toFixed(3)} at the ${r1} junction`);
      }
    }
    assert.ok(checked > 0, 'no abutting bands in any table — this test stopped testing anything');
  });

  test('Saturn keeps the Cassini division darker than the rings either side of it', () => {
    const b = RINGS.Saturn;
    assert.ok(alphaAt(b, 1.99) < alphaAt(b, 1.85) * 0.5, 'the division is not a gap');
    assert.ok(alphaAt(b, 1.99) < alphaAt(b, 2.10) * 0.5, 'the division is not a gap');
  });

  test("Uranus keeps ε — the one ring you can actually see — and puts it outermost", () => {
    // The first table's brightest band sat at λ's radius (1.957–1.975) and ε
    // (51,149 km / 25,559 = 2.001) was absent altogether, so the ring the
    // comment singled out was the one ring not drawn.
    const eps = RINGS.Uranus.filter(([r0, r1]) => r0 < 2.001 && r1 > 2.001);
    assert.equal(eps.length, 1, 'no single band covers ε at 2.001 planet radii');
    const brightest = RINGS.Uranus.reduce((m, b) => b[2] > m[2] ? b : m);
    assert.equal(brightest[2], eps[0][2], 'ε is not the brightest band Uranus has');
    assert.ok(alphaAt(RINGS.Uranus, 2.001) > alphaAt(RINGS.Uranus, 1.957),
      'ε paints no brighter than the dust ring inside it');
  });

  test('the rings are a thin sheet, not the inflated torus they replaced', () => {
    // The complaint that started this: a TorusGeometry with a tube radius of
    // 0.28 planet radii read as a pool float. A flat annulus has no thickness
    // at all, so what is checked instead is that its RADIAL extent is a band
    // rather than a slab — Saturn's widest is ~1.1 radii, and nothing here is
    // allowed to be wider than the planet it circles by more than that.
    for (const [name, bands] of Object.entries(RINGS)) {
      const inner = Math.min(...bands.map(b => b[0]));
      const outer = Math.max(...bands.map(b => b[1]));
      assert.ok(outer - inner <= 1.3, `${name}: ring spans ${(outer - inner).toFixed(2)} radii`);
    }
  });
});

// ── The animator ─────────────────────────────────────────────────────────────
// Everything above drives the exported placement functions, which is what the
// header's rationale asks for: "the first version of render.js got both wrong by
// a sign … so the placement conventions are now functions and this file drives
// them". But two of those conventions are NOT among the exported functions —
// `pivot.rotation.y = +theta` and `tilt.rotation.y = -theta` exist in three
// hand-written copies: the builder, the animator, and the chain() helper above.
// The tests above pin their own copy; updateSolarSystem's copy was driven by
// nothing, so the exact sign error the header is named after was still reachable
// there with the whole suite green, along with a zeroed orbit radius (all eight
// planets inside the sun), a dropped Kepler-II sweep, and `if (true) return`.
//
// updateSolarSystem needs no canvas — it touches only this.solarPlanets and
// this.solarBelt — so it is called here for real, on a host whose planets are
// plain node chains. What is asserted is what only the animator can answer.
describe('the animator — updateSolarSystem', () => {

  const node = () => ({ rotation: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 } });

  /** One solarPlanets entry, built with the same numbers _buildSolarSystem uses. */
  function entry(p, { moon = true, clouds = true } = {}) {
    const dEarth = au2u(1);
    const a = au2u(p.au);
    return {
      pivot: node(), holder: node(), tilt: node(), mesh: node(),
      clouds: clouds ? node() : null,
      moon:   moon   ? node() : null,
      a, ecc: p.ecc, peri: rad(p.peri - p.node),
      theta: theta0(p),
      n: SOLAR.speed * Math.pow(dEarth / a, 1.5) * Math.sqrt(1 - p.ecc * p.ecc),
      spin: spinRate(p),
      moonRate,
    };
  }

  /** A RenderEngine-shaped host carrying the given planets and a belt. */
  function host(planets, over = {}) {
    return {
      currentShape: 'solar',
      solarGroup: {},
      solarPlanets: planets,
      solarBelt: node(),
      solarBeltRate: 0.003,
      ...over,
    };
  }

  const tick = (h, bass = 0) => RenderEngine.prototype.updateSolarSystem.call(h, bass);
  const byName = name => PLANETS.find(p => p.name === name);

  test('every planet stays on its own orbit ellipse, frame after frame', () => {
    // holder.position.x IS the orbital radius and it is written from the angle
    // the frame started at — the two have to keep agreeing, or the planet leaves
    // the ellipse the orbit line draws, and is parked at the sun in the limit
    // where the radius stops being written at all.
    const planets = PLANETS.map(p => entry(p));
    const h = host(planets);
    for (let f = 0; f < 39; f++) tick(h, 0);
    const angleThisFrame = planets.map(e => e.theta);
    tick(h, 0);

    for (let i = 0; i < PLANETS.length; i++) {
      const e = planets[i], name = PLANETS[i].name;
      const expected = orbitR(e.a, e.ecc, angleThisFrame[i] - e.peri);
      assert.ok(Math.abs(e.holder.position.x - expected) < 1e-12,
        `${name} sits at r=${e.holder.position.x} while its angle says ${expected}`);
      // And the radius really is on the ellipse, not merely self-consistent.
      assert.ok(e.holder.position.x >= e.a * (1 - e.ecc) - 1e-12
             && e.holder.position.x <= e.a * (1 + e.ecc) + 1e-12,
        `${name} is at r=${e.holder.position.x}, off an ellipse spanning ` +
        `${e.a * (1 - e.ecc)}…${e.a * (1 + e.ecc)}`);
    }
  });

  test('the animator holds the spin axis still too, not just the placement chain', () => {
    // tilt.rotation.y = −theta is what cancels the pivot's rotation, so the
    // obliquity keeps pointing the same way in world space all year. Flip the
    // sign and every axis swings round with its orbit — the defect the
    // placement tests above are named for, in the copy they do not read.
    const planets = PLANETS.map(p => entry(p));
    const h = host(planets);
    for (let f = 0; f < 25; f++) tick(h, 0.3);

    for (let i = 0; i < PLANETS.length; i++) {
      const e = planets[i];
      assert.equal(e.tilt.rotation.y, -e.pivot.rotation.y,
        `${PLANETS[i].name}'s axis is not cancelling its orbit`);
      assert.notEqual(e.pivot.rotation.y, 0, 'precondition: the planet actually moved');
    }
  });

  test('every orbit runs the same way round, and forwards', () => {
    // A mirrored orbit is a sign flip on the pivot alone, which leaves the
    // radius and the period untouched. Compared frame to frame, not against the
    // node's zero: theta0 is negative for half the table.
    const planets = PLANETS.map(p => entry(p));
    const h = host(planets);
    tick(h, 0);
    const before = planets.map(e => e.pivot.rotation.y);
    tick(h, 0);
    for (let i = 0; i < planets.length; i++) {
      assert.ok(planets[i].pivot.rotation.y > before[i],
        `${PLANETS[i].name} is orbiting backwards`);
      assert.equal(planets[i].pivot.rotation.y, planets[i].theta,
        `${PLANETS[i].name}'s pivot does not carry its own true anomaly`);
    }
  });

  test("Kepler's second law: the sweep is faster at perihelion than at aphelion", () => {
    // The rate goes as 1/r², so the ratio between the two apses is
    // ((1+e)/(1−e))². Mercury's e = 0.2056 makes that a factor of 2.3 — a
    // dropped sweep makes it exactly 1.
    const p = byName('Mercury');
    const at = trueAnomaly => {
      const e = entry(p);
      e.theta = e.peri + trueAnomaly;      // ν measured from perihelion
      const h = host([e]);
      const before = e.theta;
      tick(h, 0);
      return e.theta - before;
    };
    const peri = at(0), aph = at(Math.PI);
    const expected = Math.pow((1 + p.ecc) / (1 - p.ecc), 2);
    assert.ok(Math.abs(peri / aph - expected) < 1e-9,
      `perihelion/aphelion sweep ratio is ${(peri / aph).toFixed(4)}, Kepler II says ${expected.toFixed(4)}`);
  });

  test('control — the sweep still averages out to about the published mean motion', () => {
    // The √(1−e²) in `n` exists so the 1/r² sweep integrates to one mean motion
    // per frame over a full orbit. The tolerance is 5% rather than exact because
    // the sweep is stepped by Euler integration, which on Mercury's e = 0.2056
    // runs the year ~2% short; anything looser than a few percent would stop
    // being a statement about the year at all.
    const p = byName('Mercury');
    const e = entry(p);
    const h = host([e]);
    let frames = 0;
    const start = e.theta;
    while (e.theta - start < 2 * Math.PI && frames < 100000) { tick(h, 0); frames++; }
    const expected = 2 * Math.PI / e.n;
    assert.ok(Math.abs(frames - expected) / expected < 0.05,
      `one orbit took ${frames} frames, mean motion says ${expected.toFixed(1)}`);
  });

  test('bass drives everything on the same clock', () => {
    // k = 1 + bass·1.5 multiplies the orbit, the spin, the moon and the belt
    // alike; a partial application makes the scene come apart under a loud
    // track rather than speed up.
    const p = byName('Earth');
    const step = bass => {
      const e = entry(p);
      const h = host([e]);
      const t0 = e.theta;
      tick(h, bass);
      return {
        orbit: e.theta - t0,
        spin:  e.mesh.rotation.y,
        moon:  e.moon.rotation.y,
        cloud: e.clouds.rotation.y,
        belt:  h.solarBelt.rotation.y,
      };
    };
    const quiet = step(0), loud = step(1);
    const k = 1 + 1 * 1.5;

    for (const key of ['orbit', 'spin', 'moon', 'cloud', 'belt']) {
      assert.ok(Math.abs(loud[key] / quiet[key] - k) < 1e-9,
        `${key} sped up ×${(loud[key] / quiet[key]).toFixed(4)} on a beat, not ×${k}`);
    }
  });

  test('a planet turns on its own axis, its clouds slip ahead, its moon goes round', () => {
    const p = byName('Earth');
    const e = entry(p);
    const h = host([e]);
    tick(h, 0);

    assert.ok(Math.abs(e.mesh.rotation.y - e.spin) < 1e-15, 'the planet is not turning');
    assert.ok(Math.abs(e.clouds.rotation.y - e.spin * 1.09) < 1e-15,
      'the weather is welded to the ground');
    assert.ok(Math.abs(e.moon.rotation.y - moonRate) < 1e-15, 'the Moon is parked');
    assert.ok(e.clouds.rotation.y > e.mesh.rotation.y, 'the clouds must lead, not lag');
  });

  test('control — a planet with no moon and no clouds is not a crash', () => {
    const e = entry(byName('Mars'), { moon: false, clouds: false });
    const h = host([e]);
    tick(h, 0.5);
    assert.ok(e.mesh.rotation.y > 0);
  });

  test('nothing moves while another shape is on screen', () => {
    // The animation loop calls this every frame regardless of shape; the guard
    // is what stops a torn-down system from being stepped.
    const e = entry(byName('Earth'));
    const before = { ...e.pivot.rotation };
    const h = host([e], { currentShape: 'torus' });
    tick(h, 1);
    assert.deepEqual({ ...e.pivot.rotation }, before);

    const h2 = host([e], { solarGroup: null });
    tick(h2, 1);
    assert.deepEqual({ ...e.pivot.rotation }, before);
  });

  test('control — a system with no belt still animates its planets', () => {
    const e = entry(byName('Earth'));
    const h = host([e], { solarBelt: null });
    tick(h, 0);
    assert.ok(e.pivot.rotation.y !== 0);
  });
});
