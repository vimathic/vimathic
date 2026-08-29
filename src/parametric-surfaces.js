// parametric-surfaces.js — the surfaces that cannot be a formula.
//
// Why this file exists at all. A formula in this app returns ONE number per
// (x, z) and that number becomes a height: `plane` plus a kernel draws any
// graph of two variables, and drawing one as a shape would only take a slot
// away from something a graph cannot be. What a graph cannot be is what lives
// here — one-sided surfaces, surfaces that close on themselves, surfaces that
// pass through themselves, and surfaces with two sheets over the same (x, z).
// The catalogue already carries `mobiusStrip` ("Möbius Strip Height"),
// `catenoid` ("Catenoid Profile") and `pseudosphere` ("Tractrix Profile
// Revolved") as kernels, and those names are careful on purpose: a height
// field can draw the PROFILE of a catenoid, not a catenoid.
//
// Everything here is a regular parametrisation r(u, v) on a rectangle, meshed
// by three's ParametricGeometry — already a dependency of this app (render.js
// imports OrbitControls and the postprocessing stack from the same place), so
// no package is added. ParametricGeometry calls back with u, v in [0, 1]; each
// function below maps that unit square onto its own domain and says which.
//
// Poses follow the app's convention: the body stands in XZ with its axis on Y,
// because Surface mode displaces along +Y on a plate and along the normal on a
// closed body. Sizes are chosen to sit inside the same envelope the rest of the
// catalogue uses (radius ≈ 3.2, half-height ≈ 3), so switching shapes does not
// re-frame the camera.
//
// Normals are computed with computeVertexNormals rather than kept from
// ParametricGeometry's finite differences, so these bodies answer the
// hard-edge/weld machinery in math-visualizer.js the same way every other shape
// does. On a one-sided surface that machinery cannot make the normal field
// globally consistent — nothing can, that is what non-orientable means — and
// the seam is where it shows. See the note on `mobius`.

import * as THREE from 'three';
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js';

const TAU = Math.PI * 2;

/**
 * Mesh a parametrisation and hand back a geometry posed like the rest of the
 * catalogue.
 *
 * @param {(u:number, v:number, t:THREE.Vector3)=>void} fn  u, v in [0, 1]
 * @param {number} uSegs  divisions along u
 * @param {number} vSegs  divisions along v
 */
function parametric(fn, uSegs, vSegs) {
  const geo = new ParametricGeometry(fn, uSegs, vSegs);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Möbius strip — the one-sided surface, with one boundary curve.
 *
 *   r(u, v) = ((R + w·v·cos(u/2))·cos u,  w·v·sin(u/2),  (R + w·v·cos(u/2))·sin u)
 *   u ∈ [0, 2π)   v ∈ [−1, 1]
 *
 * The half-angle is the whole point: after one trip round u the frame has
 * turned by π, so the strip closes onto itself with a reversal. Two
 * consequences a viewer meets immediately, and neither is a bug:
 *
 *   * the surface has ONE boundary component, not two — the edge is a single
 *     closed curve of twice the length you expect;
 *   * no continuous choice of normal exists, so the shading has a seam. The
 *     seam is at u = 0 because that is where the parametrisation closes; it is
 *     not an artefact of the meshing and moving the seam only moves it.
 *
 * Meshed with the u-seam duplicated rather than welded shut. Welding it would
 * ask two vertices at one point to carry one normal, which is exactly the
 * choice that does not exist.
 */
export function buildMobiusGeo(uSegs = 240, vSegs = 24, R = 2.7, w = 1.1) {
  return parametric((uu, vv, target) => {
    const u = uu * TAU;
    const v = vv * 2 - 1;
    const rad = R + w * v * Math.cos(u / 2);
    target.set(rad * Math.cos(u), w * v * Math.sin(u / 2), rad * Math.sin(u));
  }, uSegs, vSegs);
}

/**
 * Klein bottle — closed, with no boundary at all, and still one-sided.
 *
 * The FIGURE-8 immersion, not the "bottle" one:
 *
 *   x = (a + cos(u/2)·sin v − sin(u/2)·sin 2v)·cos u
 *   z = (a + cos(u/2)·sin v − sin(u/2)·sin 2v)·sin u
 *   y =      sin(u/2)·sin v + cos(u/2)·sin 2v
 *   u, v ∈ [0, 2π)
 *
 * three ships the bottle immersion in ParametricGeometries.klein and it is the
 * silhouette people recognise, but it is defined piecewise on u < π and u ≥ π
 * and the two halves meet with a crease. This app moves vertices along their
 * normals, and a crease is where a normal is not defined; the figure-8
 * immersion is smooth on the whole torus, which is why it is the one here. The
 * label says "figure-8" so the picker does not promise the other picture.
 *
 * It is a genuine Klein bottle either way: the surface is the same, only the
 * immersion into R³ differs, and no immersion of it into R³ is injective.
 */
export function buildKleinGeo(uSegs = 220, vSegs = 110, a = 2.4) {
  return parametric((uu, vv, target) => {
    const u = uu * TAU;
    const v = vv * TAU;
    const h = Math.cos(u / 2) * Math.sin(v) - Math.sin(u / 2) * Math.sin(2 * v);
    const rad = a + h;
    target.set(rad * Math.cos(u),
               Math.sin(u / 2) * Math.sin(v) + Math.cos(u / 2) * Math.sin(2 * v),
               rad * Math.sin(u));
  }, uSegs, vSegs);
}

/**
 * Catenoid — the only minimal surface of revolution other than the plane.
 *
 *   r(u, v) = (c·cosh(v/c)·cos u,  v,  c·cosh(v/c)·sin u)
 *   u ∈ [0, 2π)   v ∈ [−h, h]
 *
 * Minimal means mean curvature zero everywhere: the two principal curvatures
 * are equal and opposite at every point, so the surface is a saddle at every
 * point and has no bulge anywhere. It is the shape a soap film takes between
 * two rings, and it is the only non-planar one that is also a surface of
 * revolution — Euler, 1744.
 *
 * Paired with the helicoid below on purpose: the two are locally isometric, and
 * the family that carries one into the other bends without stretching. That
 * deformation is the one morph in this app that would mean something
 * mathematically; it is not built yet.
 */
export function buildCatenoidGeo(uSegs = 200, vSegs = 60, c = 1.5, h = 2.2) {
  return parametric((uu, vv, target) => {
    const u = uu * TAU;
    const v = (vv * 2 - 1) * h;
    const rad = c * Math.cosh(v / c);
    target.set(rad * Math.cos(u), v, rad * Math.sin(u));
  }, uSegs, vSegs);
}

/**
 * Helicoid — the ruled minimal surface.
 *
 *   r(u, v) = (v·cos u,  c·u − centre,  v·sin u)
 *   u ∈ [0, 4π]   v ∈ [−R, R]
 *
 * Two facts worth having in the same body: it is minimal (mean curvature zero,
 * like the catenoid) and it is RULED — every v-line at fixed u is a straight
 * segment lying entirely in the surface. Meusnier, 1776. Wireframe mode shows
 * the rulings directly; they are the radial lines, not an artefact of the grid.
 *
 * Two full turns rather than one, because a single turn reads as a bent plate.
 * The height is re-centred on y = 0 so the body sits in the same envelope as
 * its neighbours.
 */
export function buildHelicoidGeo(uSegs = 240, vSegs = 40, c = 0.42, turns = 2, R = 3.2) {
  const uMax = turns * TAU;
  const centre = c * uMax / 2;
  return parametric((uu, vv, target) => {
    const u = uu * uMax;
    const v = (vv * 2 - 1) * R;
    target.set(v * Math.cos(u), c * u - centre, v * Math.sin(u));
  }, uSegs, vSegs);
}

/**
 * Hyperboloid of one sheet — the doubly ruled quadric.
 *
 *   r(u, v) = (a·cosh v·cos u,  c·sinh v,  a·cosh v·sin u)
 *   u ∈ [0, 2π)   v ∈ [−V, V]
 *
 * Through EVERY point of this surface pass two distinct straight lines that lie
 * wholly inside it. That is what "doubly ruled" means, and there are exactly
 * three doubly ruled surfaces in R³: the plane, the hyperbolic paraboloid, and
 * this one. The plane is already in the catalogue and the hyperbolic paraboloid
 * is a graph, so it belongs to the formula catalogue — this is the only one of
 * the three that had to be a shape.
 *
 * The rulings are not drawn by the mesh, which follows u and v; they run
 * diagonally across it. tests/parametric-surfaces.test.js checks they are
 * really there by taking the two ruling directions at sampled points and
 * verifying that the implicit equation x²/a² + z²/a² − y²/c² = 1 stays
 * satisfied all along them.
 */
export function buildHyperboloidGeo(uSegs = 200, vSegs = 60, a = 1.6, c = 2.0, V = 1.25) {
  return parametric((uu, vv, target) => {
    const u = uu * TAU;
    const v = (vv * 2 - 1) * V;
    const rad = a * Math.cosh(v);
    target.set(rad * Math.cos(u), c * Math.sinh(v), rad * Math.sin(u));
  }, uSegs, vSegs);
}

/**
 * Pseudosphere (tractricoid) — constant NEGATIVE curvature.
 *
 *   r(u, v) = (a·sech u·cos v,  a·(u − tanh u),  a·sech u·sin v)
 *   u ∈ [−U, U]   v ∈ [0, 2π)
 *
 * The catalogue covers the two easy signs of Gaussian curvature and stops:
 * `sphere` is K = +1/r² everywhere, `plane` is K = 0 everywhere, and nothing
 * was K < 0 everywhere. This is, with K = −1/a² at every point — the surface
 * Beltrami used in 1868 to give hyperbolic geometry a model you can hold, which
 * is why it is worth a slot rather than being left to a height field. (The
 * kernel named `pseudosphere` draws the tractrix profile revolved; it is
 * honest about that in its own name, "Tractrix Profile Revolved".)
 *
 * Both trumpets, meeting at the cusp circle u = 0 where the surface is not
 * smooth — that circle is a genuine edge of the object, not a meshing failure.
 * Hilbert, 1901: no surface of constant negative curvature can be embedded in
 * R³ completely and smoothly, so the cusp is unavoidable in any model of this
 * kind.
 */
export function buildPseudosphereGeo(uSegs = 120, vSegs = 160, a = 2.4, U = 2.6) {
  return parametric((uu, vv, target) => {
    const u = (uu * 2 - 1) * U;
    const v = vv * TAU;
    const sech = 1 / Math.cosh(u);
    const rad = a * sech;
    target.set(rad * Math.cos(v), a * (u - Math.tanh(u)), rad * Math.sin(v));
  }, uSegs, vSegs);
}

// Re-exported for the tests, which mesh the same parametrisations at their own
// resolutions rather than trusting the app's.
export { TAU as _TAU };
