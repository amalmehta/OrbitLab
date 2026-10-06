// Rendezvous planner: a chaser in a lower circular orbit catches a station in a higher one.
//   0. If the two orbits are in different planes (inclination or node), a plane-change burn
//      where the planes cross rotates the chaser's velocity into the station's plane.
//   1. Wait in the parking orbit until the station leads by the right phase angle.
//   2. Transfer burn (Hohmann), refined by Newton's method on the full numerical model so the
//      chaser arrives at an aim point a few tens of metres behind the station's docking port.
//   3. Matching burn at arrival that zeroes the velocity relative to the station.
// After step 3 the chaser sits at the start of the docking corridor, ready for the RL agent.

import { R_EARTH, MU_EARTH, DEG, MOON_INC_DEFAULT } from '../physics/constants.js';
import { hohmann, circularState, circularSpeed, planeAxes, wrapAngle, localFrame, sub, norm, add, scale, unit, cross, dot } from '../physics/orbits.js';
import { Propagator, toState } from '../physics/propagator.js';

export const RENDEZVOUS_DEFAULTS = { chaserAlt: 300, stationAlt: 420, phaseDeg: 40, chaserInc: 51.0, stationInc: 51.6, nodeOffset: 0.4, aimBehind: 40 };

// Station local frame (LVLH): x radial out, y along-track, z orbit normal. Returns m and m/s.
export function relativeLVLH(chaser, station) {
  const r = [station[0], station[1], station[2]], v = [station[3], station[4], station[5]];
  const ex = unit(r), ez = unit(cross(r, v)), ey = cross(ez, ex);
  const dr = sub([chaser[0], chaser[1], chaser[2]], r);
  // velocity relative to the rotating frame: subtract ω × dr
  const w = scale(ez, norm(cross(r, v)) / dot(r, r));
  const dv = sub(sub([chaser[3], chaser[4], chaser[5]], v), cross(w, dr));
  return {
    pos: [dot(dr, ex) * 1000, dot(dr, ey) * 1000, dot(dr, ez) * 1000],
    vel: [dot(dv, ex) * 1000, dot(dv, ey) * 1000, dot(dv, ez) * 1000],
  };
}

function aimPoint(station, behindKm) {
  const r = [station[0], station[1], station[2]], v = [station[3], station[4], station[5]];
  return add(r, scale(unit(v), -behindKm));
}

export function planRendezvous({ chaserAlt, stationAlt, phaseDeg, chaserInc = 51.6, stationInc = 51.6, nodeOffset = 0, aimBehind = 40, t0 = 0, moonPhase0 = 1.9, moonInc = MOON_INC_DEFAULT }) {
  const r1 = R_EARTH + chaserAlt, r2 = R_EARTH + stationAlt;
  const iC = chaserInc * DEG, iS = stationInc * DEG, dO = nodeOffset * DEG;
  // The station starts phaseDeg ahead, measured from its own ascending node.
  const c0 = circularState(r1, 0, MU_EARTH, iC, 0), s0 = circularState(r2, phaseDeg * DEG, MU_EARTH, iS, dO);
  const chaser0 = toState(c0.r, c0.v), station0 = toState(s0.r, s0.v);
  const prop = new Propagator({ moonPhase0, moonInc });
  const burns = [];

  // 0. Plane change at the first crossing of the two planes, at least 10 minutes from now.
  const C = planeAxes(iC, 0), S = planeAxes(iS, dO);
  const planeDiff = Math.acos(Math.max(-1, Math.min(1, dot(C.W, S.W))));
  let tStart = t0, planeChangeDv = 0;
  const chaser = Float64Array.from(chaser0), station = Float64Array.from(station0);
  if (planeDiff > 1e-7) {
    const line = unit(cross(C.W, S.W));
    const uNode = Math.atan2(dot(line, C.Q), dot(line, C.P));
    const n1 = circularSpeed(r1) / r1;
    let tNode = Infinity;
    for (let k = -2; k < 6; k++) {
      // the chaser starts at u = 0; the planes cross at uNode and uNode + π (repeating each orbit)
      const t = t0 + (wrapAngle(uNode + (k % 2) * Math.PI) + Math.floor(k / 2) * 2 * Math.PI) / n1;
      if (t >= t0 + 600 && t < tNode) tNode = t;
    }
    if (!isFinite(tNode)) tNode = t0 + 600 + Math.PI / n1;
    prop.propagate(chaser, t0, tNode);
    prop.propagate(station, t0, tNode);
    const r = [chaser[0], chaser[1], chaser[2]], v = [chaser[3], chaser[4], chaser[5]];
    // Same speed, now heading along the station's plane.
    const vNew = scale(unit(cross(S.W, unit(r))), norm(v));
    const dvPlane = sub(vNew, v);
    planeChangeDv = norm(dvPlane);
    burns.push({ t: tNode, dvInertial: dvPlane, label: 'Plane change' });
    chaser[3] = vNew[0]; chaser[4] = vNew[1]; chaser[5] = vNew[2];
    tStart = tNode;
  }

  const h = hohmann(r1, r2);
  const n1 = circularSpeed(r1) / r1, n2 = circularSpeed(r2) / r2;
  const phiReq = wrapAngle(Math.PI - n2 * h.tof);
  // Current lead of the station over the chaser, measured around the station's orbit normal.
  const rc = [chaser[0], chaser[1], chaser[2]], rs = [station[0], station[1], station[2]];
  const phi0 = wrapAngle(Math.atan2(dot(S.W, cross(rc, rs)), dot(rc, rs)));
  const rate = n2 - n1;
  if (Math.abs(rate) < 1e-9) return { ok: false, reason: 'Orbits are the same height — phasing would take forever.' };
  const wait = rate < 0 ? wrapAngle(phi0 - phiReq) / -rate : wrapAngle(phiReq - phi0) / rate;
  const tBurn = tStart + Math.max(wait, 60);
  const tArrive = tBurn + h.tof;

  // Where the station and chaser are at the burn and at arrival.
  const sAtBurn = Float64Array.from(chaser);
  prop.propagate(sAtBurn, tStart, tBurn);
  const stAtArrive = Float64Array.from(station);
  prop.propagate(stAtArrive, tStart, tArrive);
  const target = aimPoint(stAtArrive, aimBehind / 1000);

  // Newton iteration on the in-plane Δv (prograde, radial) at the burn so the arrival position
  // hits the aim point. (Out-of-plane Δv barely moves the arrival point half an orbit later,
  // so it is left at zero.)
  const f = localFrame([sAtBurn[0], sAtBurn[1], sAtBurn[2]], [sAtBurn[3], sAtBurn[4], sAtBurn[5]]);
  const toDv = (p) => add(scale(f.pro, p[0]), scale(f.rad, p[1]));
  const arrive = (p) => {
    const s = Float64Array.from(sAtBurn);
    const d = toDv(p);
    s[3] += d[0]; s[4] += d[1]; s[5] += d[2];
    prop.propagate(s, tBurn, tArrive);
    return s;
  };
  // Errors measured along the station's along-track and radial directions at arrival.
  const ey = unit([stAtArrive[3], stAtArrive[4], stAtArrive[5]]), ex = unit([stAtArrive[0], stAtArrive[1], stAtArrive[2]]);
  const errOf = (s) => { const e = sub([s[0], s[1], s[2]], target); return [dot(e, ey), dot(e, ex), norm(e)]; };
  let p = [h.dv1, 0], miss = Infinity, sArr;
  for (let it = 0; it < 10; it++) {
    sArr = arrive(p);
    const e = errOf(sArr);
    miss = e[2];
    if (miss < 1e-4) break; // 10 cm
    const eps = 1e-6;
    const ea = errOf(arrive([p[0] + eps, p[1]])), eb = errOf(arrive([p[0], p[1] + eps]));
    const J = [[(ea[0] - e[0]) / eps, (eb[0] - e[0]) / eps], [(ea[1] - e[1]) / eps, (eb[1] - e[1]) / eps]];
    const D = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    p = [p[0] - (J[1][1] * e[0] - J[0][1] * e[1]) / D, p[1] - (-J[1][0] * e[0] + J[0][0] * e[1]) / D];
  }
  const dv = toDv(p);
  sArr = arrive(p);
  miss = errOf(sArr)[2];
  const dvMatch = sub([stAtArrive[3], stAtArrive[4], stAtArrive[5]], [sArr[3], sArr[4], sArr[5]]);
  return {
    ok: true,
    r1, r2, wait: tBurn - tStart, tof: h.tof, phiReqDeg: (phiReq * 180) / Math.PI,
    hohmannDv: h.total,
    planeDiffDeg: planeDiff / DEG,
    planeChangeDv,
    planeChangeTime: burns.length ? burns[0].t : null,
    stationInc, stationNode: nodeOffset,
    totalDv: planeChangeDv + norm(dv) + norm(dvMatch),
    missMeters: miss * 1000,
    chaser0, station0, moonPhase0, moonInc,
    burns: [
      ...burns,
      { t: tBurn, dvInertial: dv, label: 'Transfer burn' },
      { t: tArrive, dvInertial: dvMatch, label: 'Match velocity' },
    ],
    arriveTime: tArrive,
  };
}
