// Lunar gravity-assist planner. From a circular parking orbit, a prograde trans-lunar
// injection (TLI) burn sends the craft to the Moon's distance. The Moon's orbit is tilted to the
// equator, so the parking orbit's node (RAAN) is chosen so its plane contains the Moon's position
// at arrival. Then two numbers are searched together: the burn time (where in the parking orbit
// it fires) and the node, so the closest approach hits the requested altitude on the requested
// side of the Moon, in the plane of the trajectory.
//   1. Coarse scan of burn time using the impact parameter (B-vector) at sphere-of-influence
//      entry, which is smooth even for trajectories that would hit the Moon.
//   2. Bisection on the in-plane B component to the target impact parameter.
//   3. Newton on (burn time, node) using the true closest approach, in-plane and out-of-plane.
// Which side gains energy depends on the arrival geometry: arriving near apogee the
// Moon-relative velocity points almost straight backward, so both sides gain; a more energetic
// TLI (apogee beyond the Moon) lets a leading-side pass shed energy.

import { R_EARTH, R_MOON, MU_EARTH, MU_MOON, MOON_ORBIT, MOON_SOI, DEG, MOON_INC_DEFAULT } from '../physics/constants.js';
import { hohmann, circularState, planeAxes, period, sub, cross, dot, norm, unit, scale, elements } from '../physics/orbits.js';
import { Propagator, toState } from '../physics/propagator.js';

export const ASSIST_DEFAULTS = { parkingAlt: 200, parkingInc: 28.5, flybyAlt: 2000, side: 'trailing', apogeeFactor: 1.0, moonPhase0: 1.9 };

// In-plane (y) and out-of-plane (z) parts of a Moon-relative position, perpendicular to the
// Moon-relative velocity. W is the parking orbit normal.
function planeCoords(rr, vr, W) {
  const u = unit(cross(W, unit(vr)));
  return { y: dot(rr, u), z: dot(rr, W) };
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

export function planGravityAssist({ parkingAlt, parkingInc = 28.5, flybyAlt, side = 'trailing', apogeeFactor = 1.0, moonPhase0 = 1.9, moonInc = MOON_INC_DEFAULT, t0 = 0 }) {
  const r0 = R_EARTH + parkingAlt;
  const P0 = period(r0);
  const inc = parkingInc * DEG;
  const tli = hohmann(r0, MOON_ORBIT * apogeeFactor);
  const dv = tli.dv1;
  const prop = new Propagator({ moonPhase0, moonInc });
  const tEnd = (tb) => tb + tli.tof * 1.4;
  const rp = R_MOON + flybyAlt;
  const tStart = t0 + 600;

  // Where the Moon will be when we arrive; the parking plane must contain it.
  const m = prop.moonAt(tStart + P0 / 2 + tli.tof).r;
  const declination = Math.asin(Math.abs(m[2]) / norm(m)) / DEG;
  const nodes = nodesContaining(m, inc);
  if (!nodes.length) {
    return { ok: false, reason: `The Moon will be ${declination.toFixed(1)}° from the equator when you arrive. Raise the parking orbit's inclination above that to reach it.` };
  }

  const candidates = [];
  for (const raan0 of nodes) {
    const stateFor = (raan) => {
      const c = circularState(r0, 0, MU_EARTH, inc, raan);
      return { s0: toState(c.r, c.v), W: planeAxes(inc, raan).W };
    };
    const base = stateFor(raan0);
    // 1. coarse scan over one parking orbit
    const N = 90;
    const samples = [];
    for (let i = 0; i <= N; i++) {
      const tb = tStart + (P0 * i) / N;
      samples.push({ tb, run: flybyRun(prop, base.s0, base.W, t0, tb, dv, tEnd(tb), 0.05) });
    }
    const bTarget = (vinf) => rp * Math.sqrt(1 + (2 * MU_MOON) / (rp * vinf * vinf)); // impact parameter giving rp
    const evalAt = ([tb, raan], accuracy = 0.01) => {
      const st = stateFor(raan);
      return flybyRun(prop, st.s0, st.W, t0, tb, dv, tEnd(tb), accuracy);
    };
    // Starting points: the scan samples whose impact parameter is nearest each target, per side of the
    // in-plane minimum (timing mostly moves the arrival out of plane, so y(tb) is U-shaped).
    const withEntry = samples.filter((q) => q.run.entry);
    const starts = [];
    for (const sign of [1, -1]) {
      const score = (q) => Math.hypot(q.run.entry.y - sign * bTarget(q.run.entry.vinf), q.run.entry.z);
      const sorted = [...withEntry].sort((p1, p2) => score(p1) - score(p2));
      for (const q of sorted.slice(0, 1)) starts.push({ sign, tb: q.tb });
    }
    for (const { sign, tb } of starts) {
      let x = [tb, raan0];
      // 3a. Newton on the impact parameter at SOI entry (nearly linear in tb and node)
      x = newton(x, (r) => (r.entry ? [r.entry.y - sign * bTarget(r.entry.vinf), r.entry.z] : null), (xx) => evalAt(xx, 0.04), 20);
      // 3b. Newton on the true closest approach
      x = newton(x, (r) => [r.y - sign * rp, r.z], (xx) => evalAt(xx, 0.01), 0.5);
      const run = evalAt(x);
      if (!run.impact && Math.abs(run.d - rp) < 50 && Math.abs(run.z) < 100 && !candidates.some((c) => Math.abs(c.tb - x[0]) < 1)) {
        candidates.push({ tb: x[0], raan: x[1], s0: stateFor(x[1]).s0, run });
      }
    }
    if (candidates.some((c) => (c.run.leading ? 'leading' : 'trailing') === side)) break;
  }
  if (!candidates.length) return { ok: false, reason: 'No flyby found for these settings. Try a different flyby altitude or burn energy.' };

  // Evaluate each candidate: energy and tilt before and after the flyby.
  for (const c of candidates) Object.assign(c, flybyStats(prop, c.s0, t0, c.tb, dv, c.run), { side: c.run.leading ? 'leading' : 'trailing' });
  const best = candidates.find((c) => c.side === side);
  if (!best) return { ok: false, reason: `No ${side === 'leading' ? 'in-front-of-the-Moon' : 'behind-the-Moon'} flyby found. Try another altitude or burn energy.` };
  prop.accuracy = 0.01;
  return {
    ok: true,
    side,
    r0, dv, tof: tli.tof,
    parkingInc, raanDeg: ((best.raan / DEG) % 360 + 360) % 360,
    moonDeclination: declination,
    burns: [{ t: best.tb, dv: [dv, 0, 0], label: 'Trans-lunar injection' }],
    initialState: best.s0,
    moonPhase0, moonInc,
    flyby: best,
    endTime: best.exitTime + 3 * 86400,
    alternatives: candidates.length,
  };
}

// Damped Newton on two unknowns [burn time (s), node (rad)] driving err(run) to [0, 0] (km).
function newton(x, err, evalAt, tolKm) {
  let run = evalAt(x), e = err(run);
  if (!e) return x;
  for (let it = 0; it < 12; it++) {
    const n0 = Math.hypot(e[0], e[1]);
    if (n0 < tolKm) break;
    const h = [0.2, 2e-5];
    const ea = err(evalAt([x[0] + h[0], x[1]])), eb = err(evalAt([x[0], x[1] + h[1]]));
    if (!ea || !eb) break;
    const J = [[(ea[0] - e[0]) / h[0], (eb[0] - e[0]) / h[1]], [(ea[1] - e[1]) / h[0], (eb[1] - e[1]) / h[1]]];
    const D = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    if (!isFinite(D) || D === 0) break;
    let step = [(J[1][1] * e[0] - J[0][1] * e[1]) / D, (-J[1][0] * e[0] + J[0][0] * e[1]) / D];
    const limit = Math.max(1, Math.abs(step[0]) / 600, Math.abs(step[1]) / 0.5);
    step = [step[0] / limit, step[1] / limit];
    // backtrack until the error shrinks
    let k = 1, improved = false;
    for (let b = 0; b < 6; b++, k /= 2) {
      const xn = [x[0] - k * step[0], x[1] - k * step[1]];
      const rn = evalAt(xn), en = err(rn);
      if (en && Math.hypot(en[0], en[1]) < n0) { x = xn; run = rn; e = en; improved = true; break; }
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
