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
before(async () => {
  ({ SOLAR_MODEL: { SOLAR, PLANETS, MOON, RINGS, au2u, re2u, orbitR,
                    planeEuler, theta0, spinRate, moonRate, ringProfile } } = await import('../src/render.js'));
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
