// Lunar gravity-assist planner. From a circular parking orbit, a prograde trans-lunar
// injection (TLI) burn sends the craft to the Moon's distance. The Moon's orbit is tilted to the
// equator, so the parking orbit's node (RAAN) is chosen so its plane contains the Moon's position
// at arrival. Then two numbers are searched together: the burn time (where in the parking orbit
// it fires) and the node, so the closest approach hits the requested altitude on the requested
// side of the Moon: behind it, in front of it, or over its north or south pole (which tilts the
// orbit out of plane).
//   1. Coarse scan of burn time using the impact parameter (B-vector) at sphere-of-influence
//      entry, which is smooth even for trajectories that would hit the Moon.
//   2. Newton on (burn time, node, TLI Δv) toward the target impact parameter, then toward the
//      target closest-approach point. Three unknowns, two equations: each step is the smallest
//      (scaled) change that fixes the error. Burn timing and the node mostly move the arrival out
//      of plane; the burn size moves it in plane (how far out the transfer reaches).
// Which side gains energy depends on the arrival geometry: arriving near apogee the
// Moon-relative velocity points almost straight backward, so both sides gain; a more energetic
// TLI (apogee beyond the Moon) lets a leading-side pass shed energy.

import { R_EARTH, R_MOON, MU_EARTH, MU_MOON, MOON_ORBIT, MOON_SOI, DEG, DEFAULT_EPOCH } from '../physics/constants.js';
import { hohmann, circularState, planeAxes, period, sub, cross, dot, norm, unit, scale, elements } from '../physics/orbits.js';
import { Propagator, toState } from '../physics/propagator.js';

export const ASSIST_DEFAULTS = { parkingAlt: 200, parkingInc: 28.5, flybyAlt: 2000, side: 'trailing', apogeeFactor: 1.0 };

// Where the closest approach should be, as (in-plane, out-of-plane) unit offsets from the Moon.
// 'trailing' and 'leading' are both in-plane; which sign is which depends on the geometry.
const SIDE_TARGETS = { trailing: [[1, 0], [-1, 0]], leading: [[1, 0], [-1, 0]], north: [[0, 1]], south: [[0, -1]] };
const sideOf = (run) => (Math.abs(run.z) > Math.abs(run.y) ? (run.z > 0 ? 'north' : 'south') : run.leading ? 'leading' : 'trailing');

// In-plane (y) and out-of-plane (z) parts of a Moon-relative position, perpendicular to the
// Moon-relative velocity. W is the parking orbit normal; the axes are made orthogonal to the
// velocity, which tilts out of plane during a pass over a pole.
function planeCoords(rr, vr, W) {
  const vh = unit(vr);
  const Wp = unit(sub(W, scale(vh, dot(W, vh))));
  const u = cross(Wp, vh);
  return { y: dot(rr, u), z: dot(rr, Wp) };
}

function flybyRun(prop, s0, W, t0, tBurn, dv, tEnd, accuracy) {
  prop.accuracy = accuracy;
  const s = Float64Array.from(s0);
  let best = { d: Infinity }, entry = null;
  const res = prop.propagate(s, t0, tEnd, {
    burns: [{ t: tBurn, dv: [dv, 0, 0] }],
    onStep: (t, st) => {
      if (t < tBurn) return false;
      const m = prop.moonAt(t);
      const rr = [st[0] - m.r[0], st[1] - m.r[1], st[2] - m.r[2]];
      const d = norm(rr);
      const vr = [st[3] - m.v[0], st[4] - m.v[1], st[5] - m.v[2]];
      if (!entry && d < MOON_SOI) {
        // straight-line impact parameter at entry
        const vh = unit(vr);
        const B = sub(rr, scale(vh, dot(rr, vh)));
        const v2 = dot(vr, vr) - (2 * MU_MOON) / d;
        entry = { ...planeCoords(B, vr, W), vinf: Math.sqrt(Math.max(v2, 1e-6)) };
      }
      if (d < best.d) {
        best = { d, t, leading: dot(rr, m.v) > 0, ...planeCoords(rr, vr, W) };
      } else if (best.d < MOON_SOI && d > MOON_SOI) {
        return true; // left the sphere of influence: closest approach is behind us
      }
      return false;
    },
  });
  return { ...best, entry, impact: res.impact };
}

// Node (RAAN) for a plane of inclination inc that contains direction m. Two solutions, or none.
function nodesContaining(m, inc) {
  const rho = Math.hypot(m[0], m[1]), phi = Math.atan2(m[1], m[0]);
  const k = (-m[2] / rho) / Math.tan(inc);
  if (!isFinite(k) || Math.abs(k) > 1) return [];
  const a = Math.asin(k);
  return [phi + a, phi + Math.PI - a];
}

export function planGravityAssist({ parkingAlt, parkingInc = 28.5, flybyAlt, side = 'trailing', apogeeFactor = 1.0, epoch = DEFAULT_EPOCH, t0 = 0 }) {
  const r0 = R_EARTH + parkingAlt;
  const P0 = period(r0);
  const inc = parkingInc * DEG;
  const prop = new Propagator({ epoch });
  const tStart = t0 + 600;
  // Aim the transfer at the Moon's actual distance on arrival (it varies 363,000–405,000 km).
  let tli = hohmann(r0, MOON_ORBIT * apogeeFactor);
  for (let k = 0; k < 2; k++) tli = hohmann(r0, norm(prop.moonAt(tStart + P0 / 2 + tli.tof).r) * apogeeFactor);
  const dv0 = tli.dv1;
  const tEnd = (tb) => tb + tli.tof * 1.4;
  const rp = R_MOON + flybyAlt;

  // Where the Moon will be when we arrive; the parking plane must contain it.
  const arrival = prop.moonAt(tStart + P0 / 2 + tli.tof);
  const m = arrival.r;
  const declination = Math.asin(Math.abs(m[2]) / norm(m)) / DEG;
  const nodes = nodesContaining(m, inc);
  if (!nodes.length) {
    return { ok: false, reason: `The Moon will be ${declination.toFixed(1)}° from the equator when you arrive. Raise the parking orbit's inclination above that to reach it.` };
  }

  const stateFor = (raan) => {
    const c = circularState(r0, 0, MU_EARTH, inc, raan);
    return { s0: toState(c.r, c.v), W: planeAxes(inc, raan).W };
  };
  const evalAt = ([tb, raan, dv], accuracy = 0.01) => {
    const st = stateFor(raan);
    return flybyRun(prop, st.s0, st.W, t0, tb, dv, tEnd(tb), accuracy);
  };
  const bOf = (vinf) => rp * Math.sqrt(1 + (2 * MU_MOON) / (rp * vinf * vinf)); // impact parameter giving rp

  const candidates = [];
  for (const raan0 of nodes) {
    // 1. coarse scan over one parking orbit
    const N = 90;
    const samples = [];
    for (let i = 0; i <= N; i++) {
      const tb = tStart + (P0 * i) / N;
      samples.push({ tb, run: evalAt([tb, raan0, dv0], 0.05) });
    }
    const withEntry = samples.filter((q) => q.run.entry);
    for (const [ty, tz] of SIDE_TARGETS[side]) {
      // start from the scan sample whose impact parameter is nearest the target
      const score = (q) => { const b = bOf(q.run.entry.vinf); return Math.hypot(q.run.entry.y - ty * b, q.run.entry.z - tz * b); };
      const start = [...withEntry].sort((p1, p2) => score(p1) - score(p2))[0];
      if (!start) continue;
      let x = [start.tb, raan0, dv0];
      // 2a. Newton on the impact parameter at SOI entry (nearly linear)
      x = newton(x, (r) => (r.entry ? [r.entry.y - ty * bOf(r.entry.vinf), r.entry.z - tz * bOf(r.entry.vinf)] : null), (xx) => evalAt(xx, 0.04), 20);
      // 2b. Newton on the true closest approach
      x = newton(x, (r) => [r.y - ty * rp, r.z - tz * rp], (xx) => evalAt(xx, 0.01), 0.5);
      const run = evalAt(x);
      const offTarget = Math.hypot(run.y - ty * rp, run.z - tz * rp);
      if (!run.impact && Math.abs(run.d - rp) < 50 && offTarget < 100 && !candidates.some((c) => Math.abs(c.tb - x[0]) < 1)) {
        candidates.push({ tb: x[0], raan: x[1], dv: x[2], s0: stateFor(x[1]).s0, run });
      }
    }
    if (candidates.some((c) => sideOf(c.run) === side)) break;
  }
  const sideName = { trailing: 'behind-the-Moon', leading: 'in-front-of-the-Moon', north: 'over-the-north-pole', south: 'under-the-south-pole' }[side];
  if (!candidates.length) return { ok: false, reason: `No ${sideName} flyby found for these settings. Try a different flyby altitude or burn energy.` };

  // Evaluate each candidate: energy and tilt before and after the flyby.
  for (const c of candidates) Object.assign(c, flybyStats(prop, c.s0, t0, c.tb, c.dv, c.run), { side: sideOf(c.run) });
  const best = candidates.find((c) => c.side === side);
  if (!best) return { ok: false, reason: `No ${sideName} flyby found. Try another altitude or burn energy.` };
  prop.accuracy = 0.01;
  return {
    ok: true,
    side,
    r0, dv: best.dv, tof: tli.tof,
    parkingInc, raanDeg: ((best.raan / DEG) % 360 + 360) % 360,
    moonDeclination: declination,
    moonDistance: norm(m),
    burns: [{ t: best.tb, dv: [best.dv, 0, 0], label: 'Trans-lunar injection' }],
    initialState: best.s0,
    epoch,
    flyby: best,
    endTime: best.exitTime + 3 * 86400,
    alternatives: candidates.length,
  };
}

// Damped Newton on three unknowns [burn time (s), node (rad), TLI Δv (km/s)] driving the two
// errors err(run) to zero (km). With more unknowns than equations, each step is the smallest
// change in scaled units (300 s, 0.05 rad, 10 m/s) that removes the linearised error.
const SCALE = [300, 0.05, 0.01];
const H = [0.2, 2e-5, 1e-5];
function newton(x, err, evalAt, tolKm) {
  let e = err(evalAt(x));
  if (!e) return x;
  for (let it = 0; it < 14; it++) {
    const n0 = Math.hypot(e[0], e[1]);
    if (n0 < tolKm) break;
    // scaled Jacobian, 2 × 3
    const J = [[], []];
    let ok = true;
    for (let k = 0; k < 3; k++) {
      const xk = [...x];
      xk[k] += H[k];
      const ek = err(evalAt(xk));
      if (!ek) { ok = false; break; }
      J[0][k] = ((ek[0] - e[0]) / H[k]) * SCALE[k];
      J[1][k] = ((ek[1] - e[1]) / H[k]) * SCALE[k];
    }
    if (!ok) break;
    // minimum-norm step: Jᵀ (J Jᵀ)⁻¹ e
    const a = J[0][0] ** 2 + J[0][1] ** 2 + J[0][2] ** 2;
    const b = J[0][0] * J[1][0] + J[0][1] * J[1][1] + J[0][2] * J[1][2];
    const c = J[1][0] ** 2 + J[1][1] ** 2 + J[1][2] ** 2;
    const D = a * c - b * b;
    if (!isFinite(D) || D <= 0) break;
    const w0 = (c * e[0] - b * e[1]) / D, w1 = (-b * e[0] + a * e[1]) / D;
    let step = [0, 1, 2].map((k) => J[0][k] * w0 + J[1][k] * w1); // scaled units
    const limit = Math.max(1, ...step.map((v) => Math.abs(v) / 3));
    step = step.map((v, k) => (v / limit) * SCALE[k]);
    // backtrack until the error shrinks
    let f = 1, improved = false;
    for (let t = 0; t < 6; t++, f /= 2) {
      const xn = x.map((v, k) => v - f * step[k]);
      const en = err(evalAt(xn));
      if (en && Math.hypot(en[0], en[1]) < n0) { x = xn; e = en; improved = true; break; }
    }
    if (!improved) break;
  }
  return x;
}

function flybyStats(prop, s0, t0, tb, dv, run) {
  prop.accuracy = 0.01;
  // State at SOI entry and exit (Earth-relative energy before and after).
  const s = Float64Array.from(s0);
  let entry = null, exit = null;
  prop.propagate(s, t0, run.t + 4 * 86400, {
    burns: [{ t: tb, dv: [dv, 0, 0] }],
    onStep: (t, st) => {
      if (t < tb) return false;
      const m = prop.moonAt(t);
      const d = Math.hypot(st[0] - m.r[0], st[1] - m.r[1], st[2] - m.r[2]);
      if (!entry && d < MOON_SOI) entry = { t, s: Float64Array.from(st), m };
      if (entry && !exit && t > run.t && d > MOON_SOI) { exit = { t, s: Float64Array.from(st), m }; return true; }
      return false;
    },
  });
  if (!entry || !exit) return { dEnergy: 0, exitTime: run.t + 86400 };
  const eps = (x) => elements([x.s[0], x.s[1], x.s[2]], [x.s[3], x.s[4], x.s[5]], MU_EARTH);
  const before = eps(entry), after = eps(exit);
  const vinfVec = sub([entry.s[3], entry.s[4], entry.s[5]], entry.m.v);
  const vinf = norm(vinfVec);
  const turn = 2 * Math.asin(1 / (1 + (run.d * vinf * vinf) / MU_MOON));
  const vBefore = norm([entry.s[3], entry.s[4], entry.s[5]]);
  const vAfter = norm([exit.s[3], exit.s[4], exit.s[5]]);
  return {
    vinf,
    turnDeg: (turn * 180) / Math.PI,
    periapsisAlt: run.d - R_MOON,
    closestTime: run.t,
    energyBefore: before.energy,
    energyAfter: after.energy,
    dEnergy: after.energy - before.energy,
    speedBefore: vBefore,
    speedAfter: vAfter,
    escapes: after.energy > 0,
    after,
    incBeforeDeg: before.inc / DEG,
    incAfterDeg: after.inc / DEG,
    exitTime: exit.t,
    // Speed change a burn would need at SOI exit to produce the same energy change.
    equivalentDv: Math.abs(vAfter - Math.sqrt(Math.max(0, vAfter * vAfter - 2 * (after.energy - before.energy)))),
  };
}
