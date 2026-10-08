// Two-body orbital mechanics helpers. Vectors are plain [x, y, z] arrays in km and km/s.

import { MU_EARTH, MOON_ORBIT, DEG, OBLIQUITY } from './constants.js';

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => scale(a, 1 / norm(a));

export const circularSpeed = (r, mu = MU_EARTH) => Math.sqrt(mu / r);
export const period = (a, mu = MU_EARTH) => 2 * Math.PI * Math.sqrt(a ** 3 / mu);
export const visViva = (r, a, mu = MU_EARTH) => Math.sqrt(mu * (2 / r - 1 / a));
export const wrapAngle = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

// Hohmann transfer between circular coplanar orbits of radius r1 → r2.
export function hohmann(r1, r2, mu = MU_EARTH) {
  const a = (r1 + r2) / 2;
  const v1 = circularSpeed(r1, mu), v2 = circularSpeed(r2, mu);
  const vp = visViva(r1, a, mu), va = visViva(r2, a, mu);
  const dv1 = vp - v1;  // signed: + prograde
  const dv2 = v2 - va;
  return { a, e: Math.abs(r2 - r1) / (r1 + r2), dv1, dv2, total: Math.abs(dv1) + Math.abs(dv2), tof: period(a, mu) / 2 };
}

// Classical orbital elements from a state vector.
export function elements(r, v, mu = MU_EARTH) {
  const rn = norm(r), vn = norm(v);
  const h = cross(r, v);
  const energy = (vn * vn) / 2 - mu / rn;
  const a = -mu / (2 * energy);
  const evec = sub(scale(cross(v, h), 1 / mu), scale(r, 1 / rn));
  const e = norm(evec);
  const p = dot(h, h) / mu;
  const rp = p / (1 + e);
  const ra = e < 1 ? p / (1 - e) : Infinity;
  const inc = Math.acos(Math.max(-1, Math.min(1, h[2] / norm(h))));
  return { a, e, energy, rp, ra, inc, h, evec, period: e < 1 ? period(a, mu) : Infinity };
}

// Points along a conic (in the orbital plane given by h, periapsis direction evec) for drawing.
export function conicPoints(r, v, mu = MU_EARTH, n = 256, maxR = Infinity) {
  const el = elements(r, v, mu);
  const p = dot(el.h, el.h) / mu;
  const P = el.e > 1e-8 ? unit(el.evec) : unit(r);
  const W = unit(el.h);
  const Q = cross(W, P);
  const pts = [];
  const nuMax = el.e < 1 ? Math.PI : Math.acos(-1 / el.e) - 1e-3;
  for (let i = 0; i <= n; i++) {
    const nu = -nuMax + (2 * nuMax * i) / n;
    const rr = p / (1 + el.e * Math.cos(nu));
    if (rr > maxR || rr < 0) continue;
    pts.push(add(scale(P, rr * Math.cos(nu)), scale(Q, rr * Math.sin(nu))));
  }
  return pts;
}

// Unit vectors of a circular orbit's plane. P points to the ascending node, Q is 90° ahead in the
// direction of motion, W is the orbit normal. inc and raan in radians; the reference plane is the
// equator (x–y) and the node line sits at angle raan from +x.
export function planeAxes(inc = 0, raan = 0) {
  const cO = Math.cos(raan), sO = Math.sin(raan), ci = Math.cos(inc), si = Math.sin(inc);
  return { P: [cO, sO, 0], Q: [-sO * ci, cO * ci, si], W: [sO * si, -cO * si, ci] };
}

// State on a circular orbit at argument of latitude u (angle from the ascending node).
export function circularState(radius, u, mu = MU_EARTH, inc = 0, raan = 0) {
  const v = circularSpeed(radius, mu);
  const { P, Q } = planeAxes(inc, raan);
  const c = Math.cos(u), s = Math.sin(u);
  return {
    r: [radius * (P[0] * c + Q[0] * s), radius * (P[1] * c + Q[1] * s), radius * (P[2] * c + Q[2] * s)],
    v: [v * (-P[0] * s + Q[0] * c), v * (-P[1] * s + Q[1] * c), v * (-P[2] * s + Q[2] * c)],
  };
}

// The Moon's geocentric orbit from mean orbital elements (Schlyter's low-precision lunar theory):
// an ellipse (e = 0.0549) inclined 5.145° to the ecliptic, whose node regresses once every 18.6
// years and whose perigee advances once every 8.85 years. Accurate to about a degree (the big
// periodic terms such as evection are left out, so positions can be a few degrees off). Returns equatorial position (km) and velocity
// (km/s) for an epoch in days since J2000, plus the orbit normal.
const MOON_E = 0.0549, MOON_I = 5.1454 * DEG;
const NODE_RATE = -0.0529538083 * DEG, PERI_RATE = 0.1643573223 * DEG, MEAN_RATE = 13.0649929509 * DEG; // rad/day
export function moonEphemeris(days) {
  const N = 125.1228 * DEG + NODE_RATE * days;
  const w = 318.0634 * DEG + PERI_RATE * days;
  const M = 115.3654 * DEG + MEAN_RATE * days;
  let E = M;
  for (let k = 0; k < 5; k++) E -= (E - MOON_E * Math.sin(E) - M) / (1 - MOON_E * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + MOON_E) * Math.sin(E / 2), Math.sqrt(1 - MOON_E) * Math.cos(E / 2));
  const r = MOON_ORBIT * (1 - MOON_E * Math.cos(E));
  const u = nu + w; // argument of latitude
  const cN = Math.cos(N), sN = Math.sin(N), ci = Math.cos(MOON_I), si = Math.sin(MOON_I);
  // unit vectors in the ecliptic frame: radial, transverse, normal
  const cu = Math.cos(u), su = Math.sin(u);
  const ur = [cN * cu - sN * su * ci, sN * cu + cN * su * ci, su * si];
  const ut = [-cN * su - sN * cu * ci, -sN * su + cN * cu * ci, cu * si];
  const un = [sN * si, -cN * si, ci];
  // Kepler speeds at the Moon's observed mean motion (the Sun slows it slightly from pure
  // two-body), plus the slow turning of the ellipse itself, so velocity matches the positions.
  const k = (MEAN_RATE / 86400) * MOON_ORBIT / Math.sqrt(1 - MOON_E * MOON_E);
  const vr = k * MOON_E * Math.sin(nu);
  const vt = k * (1 + MOON_E * Math.cos(nu)) + (r * (PERI_RATE + NODE_RATE * ci)) / 86400;
  const toEq = (x) => [x[0], x[1] * Math.cos(OBLIQUITY) - x[2] * Math.sin(OBLIQUITY), x[1] * Math.sin(OBLIQUITY) + x[2] * Math.cos(OBLIQUITY)];
  return {
    r: toEq(scale(ur, r)),
    v: toEq(add(scale(ur, vr), scale(ut, vt))),
    normal: toEq(un),
    angle: u,
  };
}

// Moon state at t seconds after the epoch (days since J2000).
export const moonState = (t, epoch) => moonEphemeris(epoch + t / 86400);

// Tilt of the Moon's orbit to the equator on a given day, in degrees (18.3°–28.6° over 18.6 years).
export const moonInclinationDeg = (epoch) => Math.acos(moonEphemeris(epoch).normal[2]) / DEG;

// Δv for a two-burn Hohmann transfer that also changes inclination by di (radians), with the
// plane change split between the burns to minimise the total. Burns happen at the nodes.
export function hohmannPlaneChange(r1, r2, di, mu = MU_EARTH) {
  const h = hohmann(r1, r2, mu);
  const v1 = circularSpeed(r1, mu), v2 = circularSpeed(r2, mu);
  const vp = visViva(r1, h.a, mu), va = visViva(r2, h.a, mu);
  const cost = (s) => {
    const d1 = Math.sqrt(v1 * v1 + vp * vp - 2 * v1 * vp * Math.cos(s));
    const d2 = Math.sqrt(va * va + v2 * v2 - 2 * va * v2 * Math.cos(di - s));
    return { d1, d2, total: d1 + d2 };
  };
  // golden-section search for the share of the plane change done at the first burn
  const g = (Math.sqrt(5) - 1) / 2;
  let lo = Math.min(0, di), hi = Math.max(0, di);
  let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo);
  for (let i = 0; i < 80; i++) {
    if (cost(x1).total < cost(x2).total) { hi = x2; x2 = x1; x1 = hi - g * (hi - lo); }
    else { lo = x1; x1 = x2; x2 = lo + g * (hi - lo); }
  }
  const s1 = (lo + hi) / 2;
  const best = cost(s1);
  return {
    ...h, v1, v2, vp, va,
    di1: s1, di2: di - s1,
    dv1: best.d1, dv2: best.d2, total: best.total,
    // for comparison: a plain Hohmann, then a separate plane change once circular at r2
    separateTotal: h.total + 2 * v2 * Math.sin(Math.abs(di) / 2),
  };
}

// Angle between two orbit planes.
export function planeAngle(inc1, raan1, inc2, raan2) {
  const a = planeAxes(inc1, raan1).W, b = planeAxes(inc2, raan2).W;
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

// A burn that changes velocity vBefore → vAfter at position r, as [prograde, normal, radial]
// components in the local frame before the burn.
export function localComponents(r, vBefore, vAfter) {
  const f = localFrame(r, vBefore);
  const d = sub(vAfter, vBefore);
  return [dot(d, f.pro), dot(d, f.nrm), dot(d, f.rad)];
}

// Local orbital frame unit vectors: prograde (along v), normal (along h), radial-out.
export function localFrame(r, v) {
  const pro = unit(v);
  const nrm = unit(cross(r, v));
  const rad = cross(pro, nrm); // in-plane, perpendicular to v, pointing away from the body
  return { pro, nrm, rad };
}
