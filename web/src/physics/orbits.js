// Two-body orbital mechanics helpers. Vectors are plain [x, y, z] arrays in km and km/s.

import { MU_EARTH, MOON_ORBIT, MOON_RATE } from './constants.js';

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

// The Moon on a circular orbit in the reference (x–y) plane. phase0 = angle at t = 0.
export function moonState(t, phase0 = 0) {
  const th = phase0 + MOON_RATE * t;
  const c = Math.cos(th), s = Math.sin(th), v = MOON_ORBIT * MOON_RATE;
  return { r: [MOON_ORBIT * c, MOON_ORBIT * s, 0], v: [-v * s, v * c, 0], angle: th };
}

// State on a circular orbit in the reference plane at angle theta (counter-clockwise).
export function circularState(radius, theta, mu = MU_EARTH) {
  const v = circularSpeed(radius, mu);
  return { r: [radius * Math.cos(theta), radius * Math.sin(theta), 0], v: [-v * Math.sin(theta), v * Math.cos(theta), 0] };
}

// Local orbital frame unit vectors: prograde (along v), normal (along h), radial-out.
export function localFrame(r, v) {
  const pro = unit(v);
  const nrm = unit(cross(r, v));
  const rad = cross(pro, nrm); // in-plane, perpendicular to v, pointing away from the body
  return { pro, nrm, rad };
}
