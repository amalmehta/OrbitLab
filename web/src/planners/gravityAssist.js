// Lunar gravity-assist planner. From a circular parking orbit, a prograde trans-lunar
// injection (TLI) burn sends the craft to the Moon's distance. We search the burn time
// (where in the parking orbit it fires) so the closest approach to the Moon hits the
// requested flyby altitude, passing either behind the Moon (trailing side) or in front of it
// (leading side). Which side gains energy depends on the arrival geometry: arriving near
// apogee the Moon-relative velocity points almost straight backward, so both sides gain;
// a more energetic TLI (apogee beyond the Moon) lets a leading-side pass shed energy.

import { R_EARTH, R_MOON, MU_EARTH, MU_MOON, MOON_ORBIT, MOON_SOI } from '../physics/constants.js';
import { hohmann, circularState, period, sub, cross, dot, norm, elements } from '../physics/orbits.js';
import { Propagator, toState } from '../physics/propagator.js';

export const ASSIST_DEFAULTS = { parkingAlt: 200, flybyAlt: 2000, side: 'trailing', apogeeFactor: 1.0, moonPhase0: 1.9 };

function flybyRun(prop, s0, t0, tBurn, dv, tEnd, accuracy) {
  prop.accuracy = accuracy;
  const s = Float64Array.from(s0);
  let best = { d: Infinity }, impact = null;
  const res = prop.propagate(s, t0, tEnd, {
    burns: [{ t: tBurn, dv: [dv, 0, 0] }],
    onStep: (t, st) => {
      if (t < tBurn) return false;
      const m = prop.moonAt(t);
      const rr = [st[0] - m.r[0], st[1] - m.r[1], st[2] - m.r[2]];
      const d = norm(rr);
      if (d < best.d) {
        const vr = [st[3] - m.v[0], st[4] - m.v[1], st[5] - m.v[2]];
        best = { d, t, side: Math.sign(cross(rr, vr)[2]) || 1, leading: dot(rr, m.v) > 0, state: Float64Array.from(st) };
      } else if (best.d < MOON_SOI && d > MOON_SOI) {
        return true; // left the sphere of influence: closest approach is behind us
      }
      return false;
    },
  });
  impact = res.impact;
  return { ...best, signed: best.side * best.d, impact };
}

export function planGravityAssist({ parkingAlt, flybyAlt, side = 'trailing', apogeeFactor = 1.0, moonPhase0 = 1.9, t0 = 0 }) {
  const r0 = R_EARTH + parkingAlt;
  const P0 = period(r0);
  const tli = hohmann(r0, MOON_ORBIT * apogeeFactor);
  const dv = tli.dv1;
  const s0 = toState(...Object.values(circularState(r0, 0)));
  const prop = new Propagator({ moonPhase0 });
  const tEnd = (tb) => tb + tli.tof * 1.6;
  const rp = R_MOON + flybyAlt;

  // Coarse scan over one parking orbit, starting 10 minutes from now.
  const tStart = t0 + 600;
  const N = 180;
  const samples = [];
  for (let i = 0; i <= N; i++) {
    const tb = tStart + (P0 * i) / N;
    samples.push({ tb, ...flybyRun(prop, s0, t0, tb, dv, tEnd(tb), 0.03) });
  }

  // Find bracketed roots of signed(tb) = ±rp.
  const candidates = [];
  for (const target of [rp, -rp]) {
    for (let i = 0; i < N; i++) {
      const a = samples[i], b = samples[i + 1];
      if (!isFinite(a.d) || !isFinite(b.d) || a.d > MOON_SOI * 1.5 || b.d > MOON_SOI * 1.5) continue;
      const fa = a.signed - target, fb = b.signed - target;
      if (Math.sign(fa) === Math.sign(fb)) continue;
      let lo = a.tb, hi = b.tb, flo = fa, run;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        run = flybyRun(prop, s0, t0, mid, dv, tEnd(mid), 0.01);
        const fm = run.signed - target;
        if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
        if (hi - lo < 0.01) break;
      }
      const tb = (lo + hi) / 2;
      run = flybyRun(prop, s0, t0, tb, dv, tEnd(tb), 0.01);
      if (Math.abs(run.d - rp) < 50 && !run.impact) candidates.push({ tb, run });
    }
  }
  if (!candidates.length) return { ok: false, reason: 'No flyby found for these settings — try a different flyby altitude or Moon phase.' };

  // Evaluate each candidate: energy before and after the flyby.
  for (const c of candidates) Object.assign(c, flybyStats(prop, s0, t0, c.tb, dv, c.run), { side: c.run.leading ? 'leading' : 'trailing' });
  const best = candidates.find((c) => c.side === side);
  if (!best) return { ok: false, reason: `No ${side}-side flyby found — try another altitude or TLI energy.` };
  prop.accuracy = 0.01;
  return {
    ok: true,
    side,
    r0, dv, tof: tli.tof,
    burns: [{ t: best.tb, dv: [dv, 0, 0], label: 'Trans-lunar injection' }],
    initialState: s0,
    moonPhase0,
    flyby: best,
    endTime: best.exitTime + 3 * 86400,
    alternatives: candidates.length,
  };
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
    exitTime: exit.t,
    // Speed change a burn would need at SOI exit to produce the same energy change.
    equivalentDv: Math.abs(vAfter - Math.sqrt(Math.max(0, vAfter * vAfter - 2 * (after.energy - before.energy)))),
  };
}
