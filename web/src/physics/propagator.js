// Numerical propagation in an Earth-centred frame with the Moon on a circular orbit
// (restricted three-body problem, including the indirect term because Earth itself
// accelerates toward the Moon). Fixed-step RK4 with a step size that adapts to the
// distance from whichever body is closest in "dynamical time".

import { MU_EARTH, MU_MOON, MOON_ORBIT, R_EARTH, R_MOON } from './constants.js';
import { moonState, localFrame, add, scale } from './orbits.js';

export class Propagator {
  constructor({ moonPhase0 = 0, moon = true, accuracy = 0.01 } = {}) {
    this.moonPhase0 = moonPhase0;
    this.moon = moon;
    this.accuracy = accuracy; // fraction of the local dynamical time per step
  }

  moonAt(t) {
    return moonState(t, this.moonPhase0);
  }

  accel(t, s, out) {
    const x = s[0], y = s[1], z = s[2];
    const r2 = x * x + y * y + z * z;
    const r3 = r2 * Math.sqrt(r2);
    let ax = (-MU_EARTH * x) / r3, ay = (-MU_EARTH * y) / r3, az = (-MU_EARTH * z) / r3;
    if (this.moon) {
      const m = this.moonAt(t).r;
      const dx = x - m[0], dy = y - m[1], dz = z - m[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      const d3 = d2 * Math.sqrt(d2);
      const M3 = MOON_ORBIT ** 3;
      ax += -MU_MOON * (dx / d3 + m[0] / M3);
      ay += -MU_MOON * (dy / d3 + m[1] / M3);
      az += -MU_MOON * (dz / d3 + m[2] / M3);
    }
    out[0] = s[3]; out[1] = s[4]; out[2] = s[5];
    out[3] = ax; out[4] = ay; out[5] = az;
  }

  // Suggested step size at this state.
  stepSize(t, s) {
    const rE = Math.hypot(s[0], s[1], s[2]);
    let dt = Math.sqrt(rE ** 3 / MU_EARTH);
    if (this.moon) {
      const m = this.moonAt(t).r;
      const rM = Math.hypot(s[0] - m[0], s[1] - m[1], s[2] - m[2]);
      dt = Math.min(dt, Math.sqrt(rM ** 3 / MU_MOON));
    }
    return Math.max(0.05, this.accuracy * dt);
  }

  // One RK4 step in place.
  step(s, t, h) {
    const k1 = this._k1 ??= new Float64Array(6), k2 = this._k2 ??= new Float64Array(6);
    const k3 = this._k3 ??= new Float64Array(6), k4 = this._k4 ??= new Float64Array(6);
    const tmp = this._tmp ??= new Float64Array(6);
    this.accel(t, s, k1);
    for (let i = 0; i < 6; i++) tmp[i] = s[i] + 0.5 * h * k1[i];
    this.accel(t + 0.5 * h, tmp, k2);
    for (let i = 0; i < 6; i++) tmp[i] = s[i] + 0.5 * h * k2[i];
    this.accel(t + 0.5 * h, tmp, k3);
    for (let i = 0; i < 6; i++) tmp[i] = s[i] + h * k3[i];
    this.accel(t + h, tmp, k4);
    for (let i = 0; i < 6; i++) s[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }

  // Which body (if any) the state is inside of.
  impact(t, s) {
    if (Math.hypot(s[0], s[1], s[2]) < R_EARTH) return 'Earth';
    if (this.moon) {
      const m = this.moonAt(t).r;
      if (Math.hypot(s[0] - m[0], s[1] - m[1], s[2] - m[2]) < R_MOON) return 'Moon';
    }
    return null;
  }

  // Propagate state s (modified in place) from t0 to t1, applying impulsive burns that fall in
  // the window. onStep(t, s) is called after each step; return true from it to stop early.
  // Returns { t, impact }.
  propagate(s, t0, t1, { burns = [], onStep, maxStep = Infinity } = {}) {
    let t = t0;
    const pending = burns.filter((b) => b.t >= t0 && b.t < t1).sort((a, b) => a.t - b.t);
    let bi = 0;
    while (t < t1) {
      while (bi < pending.length && pending[bi].t <= t + 1e-9) applyBurn(s, pending[bi++]);
      let h = Math.min(this.stepSize(t, s), maxStep, t1 - t);
      if (bi < pending.length) h = Math.min(h, pending[bi].t - t);
      if (h <= 1e-9) { t = bi < pending.length ? pending[bi].t : t1; continue; }
      this.step(s, t, h);
      t += h;
      const hit = this.impact(t, s);
      if (hit) return { t, impact: hit };
      if (onStep && onStep(t, s)) return { t, impact: null, stopped: true };
    }
    while (bi < pending.length && pending[bi].t <= t1 + 1e-9) applyBurn(s, pending[bi++]);
    return { t, impact: null };
  }
}

// A burn is { t, dv: [prograde, normal, radial] } in km/s in the local orbital frame,
// or { t, dvInertial: [x, y, z] } in km/s in the inertial frame.
export function applyBurn(s, burn) {
  if (burn.dvInertial) {
    s[3] += burn.dvInertial[0]; s[4] += burn.dvInertial[1]; s[5] += burn.dvInertial[2];
    return;
  }
  const r = [s[0], s[1], s[2]], v = [s[3], s[4], s[5]];
  const f = localFrame(r, v);
  const [p, n, q] = burn.dv;
  const dv = add(add(scale(f.pro, p), scale(f.nrm, n)), scale(f.rad, q));
  s[3] += dv[0]; s[4] += dv[1]; s[5] += dv[2];
}

export const toState = (r, v) => Float64Array.from([...r, ...v]);
