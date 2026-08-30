// implicit-surfaces.js — the bodies that are the zero set of a function.
//
// The rule this catalogue admits shapes by is in src/parametric-surfaces.js: a
// body that is the GRAPH of a function over the plane is a formula, not a
// shape, because `plane` plus any of the 192 kernels already draws it. The six
// surfaces of that file earned their slots by having a parametrisation a height
// field cannot be. The five here have no parametrisation at all.
//
// That is the whole of what this file adds. A triply periodic minimal surface
// fills space in three directions and has no fundamental domain you can lay a
// rectangle on; an algebraic surface of degree three or four is not rational in
// general, and even when it is, no polynomial map covers it. What both DO have
// is an equation, and src/marching-cubes.js turns an equation into a mesh.
//
// ── The pose, and what it costs ─────────────────────────────────────────────
// Same convention as the parametric family: the body stands in XZ with its axis
// on Y, sized to sit inside the envelope the rest of the catalogue uses
// (radius ~3.2, half-height ~3) so switching shapes does not re-frame the
// camera. A marching-cubes lattice has no natural "up", so unlike a
// parametrisation this is a decision rather than a consequence — and it is why
// none of these five is in setShape's rotate list either.
//
// The heaviest of them, `gyroid`, carries 40 523 vertices on desktop. That is
// deliberately checked against the catalogue rather than assumed acceptable:
// `box` already carries 39 366, so the new bodies cost what a body already in
// the catalogue costs (measured: 7.7 ms per frame of generate + apply against
// box's 8.9 ms, and a worst-case COLLAPSE near 120 ms against box's 116 ms, at
// the measured 2.96 us/vertex). `sierpinski-tetra` is 196 608 and 583 ms.
//
// ── All five keep the vertical rule, and finding out why fixed a defect ─────
// MathVisualizer._capturePristine decides whether a body may carry the field
// along its own normals. All five of these pass its first two questions — none
// is a thin plate, none has hard edges — and every one of them passed the third
// as well, the medial-radius cap, with room to spare: 0.507, 0.562, 0.587,
// 1.310, 1.485 against a threshold of 0.3.
//
// They fold anyway. Measured with a constant field of -0.4, well inside every
// one of those caps: gyroid 4.81 % of its area turned inside out, Chmutov
// 4.76 %, Cayley 5.25 %, Schwarz P 2.57 %, Clebsch 0.81 %. For comparison the
// bodies already on that path — sphere, torus, icosahedron-smooth, catenoid,
// hyperboloid — invert NOTHING at any amplitude up to 4.
//
// The medial radius asks how far away the nearest sheet FACING BACK is. What
// binds here is the surface's own curvature: push a patch past the centre of
// its own curvature and it turns over with no second sheet in sight. That is a
// cap the catalogue never needed, because a three primitive's curvature radius
// is comfortably larger than its medial radius, and an isosurface's is thirty
// times smaller. It is now computed — see foldRadius in src/math-visualizer.js
// — and it is what puts these five on the vertical rule, where the rest of the
// catalogue already lives. It also caught `helicoid`, which was folding 20 of
// its 19 200 triangles under 33 of the 192 shipped kernels and had been on the
// normal path since round 11.
//
// Two parameters were still decided by the medial radius before that cap was
// found, and they stand for their own reasons: how many periods a periodic body
// shows, and whether a body is left open at the sampling box or closed by a
// clipping shell. On the second, the general finding is worth keeping in one
// place: CLOSING a body with a shell collapses its medial radius, because the
// shell meets the surface at an acute angle along the seam — the gyroid reads
// 1.27 open and 0.09 closed. Bodies here are closed only when the mathematics
// closes them (Chmutov) or when the clip is a formality (Cayley, whose clipping
// ball is 0.2 % of its area).
//
// ── What the labels may claim ───────────────────────────────────────────────
// Round 11's rule is that the picker entry IS the claim, because the caption is
// never rendered — the viewer reads the <option> text and nothing else. Two of
// these five carry a parenthetical for that reason, and they are not modesty:
//   * "Clebsch Cubic (24 of its 27 lines)" — three of the 27 lie in the plane
//     at infinity (the leading form is -2xyz, which factors into x, y and z),
//     and no clipping shows them. "27 lines" would be a claim about something
//     the viewer cannot see.
//   * "Cayley Cubic (clipped before its 4 nodes)" — the nodes are at native
//     radius sqrt(3) and the clip is at 1.6, so what is drawn is the four cones
//     converging on them, not the nodes themselves.
// Neither the gyroid nor Schwarz P may say "minimal surface". The shipped
// fields are the trigonometric NODAL approximations, and the difference was
// measured through the same estimator the catalogue's own catenoid goes
// through: mean |H|.L is 0.040 for the gyroid and 0.207 for Schwarz P, against
// 0.00017 for the catenoid and 1.0 for a unit sphere. The gyroid is close; P is
// not close, and the name says "Schwarz P Surface" without the word.

import { marchingCubes } from './marching-cubes.js';

/**
 * Two periods of a 2*pi-periodic field across a half-width of 3.2.
 *
 * One period was measured too and is geometrically perfect (chi -3, one
 * component, medial cap 1.02) — and rejected, because with a single period in
 * frame there is nothing for the eye to see repeat, and "triply periodic" then
 * becomes a claim the picture cannot support. Three periods was rejected the
 * other way: the medial cap falls to 0.330, ten per cent above the 0.3 gate,
 * decided by an estimator that samples 400 source vertices and moves by that
 * much between resolutions. Two is the only count that is both legible and not
 * a coin toss.
 */
const K_TPMS = Math.PI / 1.6;

/**
 * The box the two periodic bodies are meshed in, and why it is not a cube.
 *
 * y is 0.9375 of x and z. On a cube of half-width 3.2 the gyroid comes out in
 * TWO connected components — stably so, at every resolution tried, because that
 * is where the box happens to cut its labyrinth, not because of any numerical
 * accident. Shortening y by one sixteenth reconnects it: one component, chi
 * -53, identically at res 32 through 96. Schwarz P is one component either way
 * and shares the box only so that switching between the pair reads as a change
 * of surface rather than a change of size.
 */
const TPMS_BOX = [3.2, 3.0, 3.2];

/**
 * Schoen's gyroid — the triply periodic surface with no straight lines and no
 * mirror symmetry at all.
 *
 *   sin x cos y + sin y cos z + sin z cos x = 0
 *
 * It divides space into two interpenetrating labyrinths of equal volume (the
 * fraction of the cell below zero measures 0.500000), and it is CHIRAL: unlike
 * Schwarz P and Schwarz D it has neither a mirror plane nor a centre of
 * inversion, which is why it looks like nothing else in the catalogue. Schoen
 * found it in 1970 at NASA, and it was another fifteen years before Karcher
 * proved it embedded.
 *
 * What ships is the NODAL approximation — the level set of that trigonometric
 * polynomial, not Schoen's minimal surface itself. They are close: measured
 * mean |H| times the half-period is 0.040 here, where a true minimal surface
 * reads 0.00017 through the same estimator and a sphere reads 1.0. Close is not
 * zero, so the label says "Gyroid" and not "gyroid minimal surface".
 *
 * The body is left OPEN at the box, so it has a rim: 2272 boundary edges on
 * desktop and 1704 on mobile, forming seven closed curves. That is not damage
 * — seven catalogue shapes have boundary edges and it is correct for all of
 * them — and tests/implicit-surfaces.test.js pins the exact counts so a hole
 * stays distinguishable from an edge.
 */
export function buildGyroidGeo(res = 64) {
  const k = K_TPMS;
  return marchingCubes((x, y, z) => {
    const a = k * x, b = k * y, c = k * z;
    return Math.sin(a) * Math.cos(b) + Math.sin(b) * Math.cos(c) + Math.sin(c) * Math.cos(a);
  }, { res, bounds: TPMS_BOX });
}

/**
 * Schwarz's P surface — the other classical triply periodic surface, and the
 * one whose equation can be read out loud.
 *
 *   cos x + cos y + cos z = 0
 *
 * Schwarz, 1865. Where the gyroid is chiral and has no straight lines, P has
 * the full symmetry of the cubic lattice, and its two labyrinths are the two
 * simple-cubic networks of tubes that give it its nickname. Paired with the
 * gyroid on purpose, the way the catenoid is paired with the helicoid in
 * src/parametric-surfaces.js: same family, different symmetry, and the pair is
 * what makes either one legible.
 *
 * This field has a property worth having in a catalogue of claims: that it has
 * NO singular point is provable in one line, with no numerical probe at all.
 * The gradient (-sin x, -sin y, -sin z) vanishes only where every coordinate is
 * 0 or pi, and there the field is +-1 +-1 +-1, which is never 0. Compare the
 * gyroid, where the same fact needed a search.
 *
 * The nodal approximation is markedly worse here than for the gyroid — mean
 * |H|.L measures 0.207 against 0.040 — so "minimal" would be a lie by an order
 * of magnitude, and the name does not use the word.
 */
export function buildSchwarzPGeo(res = 64) {
  const k = K_TPMS;
  return marchingCubes(
    (x, y, z) => Math.cos(k * x) + Math.cos(k * y) + Math.cos(k * z),
    { res, bounds: TPMS_BOX },
  );
}

/**
 * The scale that makes the Chmutov surface exactly 3.2 across.
 *
 * On the x axis the other two terms are T_4(0) = 1 each, so the surface is
 * where T_4(x/s) = -2. Outside [-1, 1] the Chebyshev polynomial is
 * cosh(4 arccosh u), so u = cosh(arccosh(2)/4) is the largest |x/s| the body
 * reaches — 1.05447. Dividing 3.2 by it puts the extreme point at exactly 3.2,
 * which is why this body needs no clipping at all: the box only has to be
 * bigger than the body, and 3.3 is.
 */
const CHMUTOV_S = 3.2 / Math.cosh(Math.acosh(2) / 4);

/**
 * The quartic from Chmutov's family, at the level where it is SMOOTH.
 *
 *   T_4(x) + T_4(y) + T_4(z) = 0,   T_4(t) = 8t^4 - 8t^2 + 1
 *
 * Chmutov's construction (1992) answers "how many singular points can a surface
 * of degree d have" with an explicit record-holding family, and the name
 * belongs to its NODAL members. This is not one of them, and the label says so,
 * because the difference is checkable in one line: T_4 has three critical
 * points, t = 0 with value +1 and t = +-1/sqrt2 with value -1, so three of its
 * critical values sum to 3, 1, -1 or -3 and never to 0. The level-0 set
 * therefore has no singular point at all. The twelve nodes of the degree-4
 * Chmutov surface live at level -1, where two -1s and one +1 do sum correctly:
 * 3 choices of which coordinate sits at 0, times 2 x 2 for the other two.
 *
 * Level 0 rather than level -1 was forced by measurement, not preferred. The
 * nodal body cannot be drawn consistently: swept over resolutions 32 to 96 it
 * gives 6, 8, 6, 8, 7, 8, 7 and 7 connected components with Euler
 * characteristics 12, 16, 12, 16, 14, 16, 14 and 14 — so the desktop build (7
 * pieces) and the mobile build (6) would be different surfaces. A node is a
 * point, and marching cubes resolves a point as a neck at one resolution and a
 * gap at the next. The same measurement retired the Barth sextic from this wave
 * altogether, and clipped the Cayley cubic short of its four.
 *
 * What is left is worth the slot on its own terms: at level 0 the eight lobes
 * are JOINED by twelve open necks instead of pinched at twelve points, giving
 * one connected surface of genus 5 — eight vertices and twelve edges of a cube
 * frame, 12 - 8 + 1 = 5 — with the full octahedral symmetry. Measured identical
 * at every resolution from 32 to 96: one component, chi -8, no boundary.
 *
 * Degree 4 and not 6 or 8, decided the same way. At d = 8 the necks between the
 * 64 lobes are 3.6 cells wide on desktop and 2.7 on mobile, so the measured
 * neck radius wanders 28 % across resolutions, and the body costs 61 902
 * vertices and a 188 ms COLLAPSE. At d = 6 the deformation verdict lands 5.7 %
 * from its gate, decided by an estimator with a larger spread than that.
 *
 * This is the only body here whose extent is derived rather than clipped. On
 * the x axis the other two terms are T_4(0) = 1 each, so the surface is where
 * T_4(x/s) = -2; outside [-1, 1] the Chebyshev polynomial is cosh(4 arccosh u),
 * so the largest |x/s| reached is cosh(arccosh(2)/4) = 1.054691 exactly, and
 * dividing 3.2 by it puts the extreme point on 3.2. Measured on the shipped
 * mesh: 3.1999. Hence no clipping shell and no rim.
 */
export function buildChmutovGeo(res = 64) {
  const s = CHMUTOV_S;
  const T4 = (t) => { const u = (t / s) * (t / s); return u * (8 * u - 8) + 1; };
  return marchingCubes((x, y, z) => T4(x) + T4(y) + T4(z), { res, bounds: 3.3 });
}

/**
 * The Clebsch diagonal cubic — the smooth cubic surface all of whose 27 lines
 * are real.
 *
 *   x^2 + y^2 + z^2 - 2xyz - 5 = 0   (native coordinates, x = 0.8 * world)
 *
 * Every smooth cubic surface in P^3 carries exactly 27 lines (Cayley and
 * Salmon, 1849) — that part is a theorem and not a distinction. What singles
 * this one out is that all 27 are REAL, and that it is the unique smooth cubic
 * with exactly ten Eckardt points, the points where three of the lines meet
 * (Segre). Four of the ten are finite and sit at the vertices of a regular
 * tetrahedron of radius sqrt(3); the other six are at infinity.
 *
 * On the equation. The Clebsch is usually written in Sylvester's pentahedral
 * form — five linear forms with sum zero and cubes summing to zero, which in an
 * affine chart is x^3 + y^3 + z^3 + 1 - (x+y+z+1)^3 = 0 — and that is the same
 * surface as the one above: there is an explicit projective change of
 * coordinates T, of determinant -1, with F_pentahedral(Tv) identically
 * -3/2 times this. Both were checked, and this chart is the one that ships for
 * three measured reasons: its tetrahedral symmetry is visible on screen (24
 * orthogonal symmetries in this chart against 6 in the other), it is four
 * monomials against sixteen, and its four finite Eckardt points are the
 * tetrahedron's own vertices rather than a sheared image of them.
 *
 * A claim NOT to make, which a plausible-sounding source will offer: ten
 * Eckardt points is not the maximum. Eighteen is, on the Fermat cubic. What is
 * true is that the Clebsch is the only smooth cubic with exactly ten.
 *
 * Left OPEN in the box rather than closed by a clipping ball, and this was the
 * closer of the two calls. A ball of radius 3.2 closes it into a handsome
 * chi = 2 body — but 38.0 % of that body's surface area is the ball, not the
 * cubic. The box crop shows the cubic alone. The 24 affine lines survive it
 * with room: they lie at native distances sqrt(3) and sqrt(5) = 2.236, and the
 * box reaches 2.56, past the 2.381 at which the shorter chords drop below half
 * the longer ones.
 */
export function buildClebschGeo(res = 64) {
  return marchingCubes((x, y, z) => {
    const u = x * 0.8, v = y * 0.8, w = z * 0.8;
    return u * u + v * v + w * w - 2 * u * v * w - 5;
  }, { res, bounds: 3.2 });
}

/**
 * The Cayley cubic — the same polynomial, with the constant that makes it sing.
 *
 *   x^2 + y^2 + z^2 - 2xyz - 1 = 0   (native coordinates, x = 0.5 * world)
 *
 * Changing the 5 above to a 1 is not a variation on a theme: it is the one
 * member of that family with singular points. It has exactly four, the maximum
 * a cubic surface can have (Cayley, 1869), and they sit at the four points of
 * (+-1, +-1, +-1) with an EVEN number of minus signs — (1,1,1) and the three
 * with two of them. (The Clebsch's four finite Eckardt points are the other
 * four vertices of that same cube, the odd ones: the two bodies divide it
 * between them, which is a fact about the family rather than a coincidence.)
 * That count is provable
 * rather than sampled — the ideal generated by F and its three partials has
 * Groebner basis <x - yz, y^2 - 1, z^2 - 1>, which has exactly four solutions,
 * and tests/implicit-surfaces.test.js checks the four points directly.
 *
 * What ships is CLIPPED BEFORE THOSE NODES, at native radius 1.6 against their
 * sqrt(3) = 1.732, and the label says so. The reason is measured: with the
 * nodes inside, the body does not stand still. A node is a point where the
 * surface is a cone, and no mesh of cubes can represent a point — marching
 * cubes resolves it as a neck at one resolution and a gap at the next. Swept
 * from 1.75 to 3.00 in steps of 0.05 across seven resolutions, not one clip
 * radius gave the same component count everywhere; the count wanders over
 * {5, 6, 8, 9, 11, 12, 15}, and the deformation verdict itself flips between
 * the desktop and mobile builds. Below 1.65 every resolution agrees: one
 * component, chi 2, the normal path. The same argument retired the Barth
 * sextic from this wave altogether — 50 nodes, and no clip radius at which
 * desktop and mobile draw the same surface.
 *
 * So what a viewer gets is the four cones converging on the nodes, stopped just
 * short: the clip removes 8 % of the way to the node and contributes 0.2 % of
 * the body's surface area. It is the cheapest body of the five — 9026 vertices
 * — and it is what the Clebsch would look like if its constant slipped.
 */
export function buildCayleyGeo(res = 64) {
  return marchingCubes((x, y, z) => {
    const u = x * 0.5, v = y * 0.5, w = z * 0.5;
    const F = u * u + v * v + w * w - 2 * u * v * w - 1;
    // max() with the ball is a clip, not a blend: the result is the surface of
    // the intersection of {F < 0} with the ball. It creases where the two meet,
    // which is a genuine edge of the object drawn and not a meshing artefact.
    return Math.max(F, Math.sqrt(x * x + y * y + z * z) - 3.2);
  }, { res, bounds: 3.35 });
}
