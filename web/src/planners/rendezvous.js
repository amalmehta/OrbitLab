// Rendezvous planner: a chaser in a lower circular orbit catches a station in a higher one.
//   0. If the two orbits are in different planes (inclination or node), the plane has to change
//      too. Two strategies are planned and the cheaper one is used:
//        separate: a plane-change burn where the planes cross, then a coplanar rendezvous;
//        combined: time the transfer burn for a plane crossing, so the station arrives at the
//        opposite crossing, and split the tilt between the transfer and matching burns.
//   1. Wait in the parking orbit until the station leads by the right phase angle.
//   2. Transfer burn (Hohmann), refined by Newton's method on the full numerical model so the
//      chaser arrives at an aim point a few tens of metres behind the station's docking port.
//   3. Matching burn at arrival that zeroes the velocity relative to the station.
// After step 3 the chaser sits at the start of the docking corridor, ready for the RL agent.

import { R_EARTH, MU_EARTH, DEG, DEFAULT_EPOCH } from '../physics/constants.js';
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

export function planRendezvous({ chaserAlt, stationAlt, phaseDeg, chaserInc = 51.6, stationInc = 51.6, nodeOffset = 0, aimBehind = 40, t0 = 0, epoch = DEFAULT_EPOCH }) {
  const r1 = R_EARTH + chaserAlt, r2 = R_EARTH + stationAlt;
  if (Math.abs(r1 - r2) < 1e-6) return { ok: false, reason: 'Orbits are the same height — phasing would take forever.' };
  const iC = chaserInc * DEG, iS = stationInc * DEG, dO = nodeOffset * DEG;
  // The station starts phaseDeg ahead, measured from its own ascending node.
  const c0 = circularState(r1, 0, MU_EARTH, iC, 0), s0 = circularState(r2, phaseDeg * DEG, MU_EARTH, iS, dO);
  const chaser0 = toState(c0.r, c0.v), station0 = toState(s0.r, s0.v);
  const C = planeAxes(iC, 0), S = planeAxes(iS, dO);
  const planeDiff = Math.acos(Math.max(-1, Math.min(1, dot(C.W, S.W))));
  const ctx = { r1, r2, phaseDeg, C, S, chaser0, station0, aimBehind, t0, prop: new Propagator({ epoch }) };

  const separate = planSeparate(ctx, planeDiff);
  const combined = planeDiff > 1e-7 ? planCombined(ctx, planeDiff) : null;
  const best = combined && combined.totalDv < separate.totalDv ? combined : separate;
  return {
    ok: true,
    ...best,
    r1, r2,
    planeDiffDeg: planeDiff / DEG,
    stationInc, stationNode: nodeOffset,
    separateTotalDv: separate.totalDv,
    combinedTotalDv: combined?.totalDv ?? null,
    chaser0, station0, epoch,
  };
}

// Plane change (if any) at the first crossing ≥ 10 min away, then a coplanar Hohmann rendezvous.
function planSeparate(ctx, planeDiff) {
  const { r1, r2, C, S, prop, t0 } = ctx;
  const chaser = Float64Array.from(ctx.chaser0), station = Float64Array.from(ctx.station0);
  const burns = [];
  let tStart = t0, planeChangeDv = 0;
  if (planeDiff > 1e-7) {
    const tNode = crossingTimes(ctx, t0 + 600, 1)[0];
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
  const wait = rate < 0 ? wrapAngle(phi0 - phiReq) / -rate : wrapAngle(phiReq - phi0) / rate;
  const tBurn = tStart + Math.max(wait, 60);
  const tArrive = tBurn + h.tof;

  const sAtBurn = Float64Array.from(chaser);
  prop.propagate(sAtBurn, tStart, tBurn);
  const stAtArrive = Float64Array.from(station);
  prop.propagate(stAtArrive, tStart, tArrive);
  const tr = targetTransfer(prop, sAtBurn, tBurn, stAtArrive, tArrive, ctx.aimBehind, 0, [h.dv1, 0]);
  return {
    strategy: planeDiff > 1e-7 ? 'separate' : 'coplanar',
    wait: tBurn - tStart, tof: h.tof, phiReqDeg: phiReq / DEG,
    planeChangeDv,
    planeChangeTime: burns.length ? burns[0].t : null,
    totalDv: planeChangeDv + norm(tr.dv) + norm(tr.dvMatch),
    missMeters: tr.miss * 1000,
    burns: [
      ...burns,
      { t: tBurn, dvInertial: tr.dv, label: 'Transfer burn' },
      { t: tArrive, dvInertial: tr.dvMatch, label: 'Match velocity' },
    ],
    arriveTime: tArrive,
  };
}

// Transfer burn at a plane crossing, timed so the station reaches the opposite crossing when we
// do. Both burn points then lie in both planes, so the tilt can be split between the transfer
// burn and the matching burn; a golden-section search finds the cheapest split.
function planCombined(ctx, planeDiff) {
  const { r1, r2, S, prop, t0 } = ctx;
  const h = hohmann(r1, r2);
  const n2 = circularSpeed(r2) / r2;
  const P2 = (2 * Math.PI) / n2;
  // Two-body guess: of the crossings in the next 48 h, the one where the station's travel time to
  // the opposite crossing is closest to the Hohmann transfer time.
  let pick = null;
  for (const tB of crossingTimes(ctx, t0 + 600, 128)) {
    if (tB > t0 + 48 * 3600) break;
    const rB = circularAt(ctx, 'chaser', tB).r;
    const anti = scale(unit(rB), -1);
    const uTarget = Math.atan2(dot(anti, S.Q), dot(anti, S.P));
    const uNow = ctx.phaseDeg * DEG + n2 * (tB - t0);
    const T = h.tof + wrapPi(uTarget - uNow - n2 * h.tof) / n2;
    if (!pick || Math.abs(T - h.tof) < Math.abs(pick.T - h.tof) - 1) pick = { tB, T };
  }
  if (!pick || pick.T < 0.5 * h.tof || pick.T > h.tof + P2 / 2) return null;

  // Refine on the numerical model: burn exactly where the chaser crosses the station's plane, and
  // arrive exactly when the station reaches the opposite side.
  // Corrections can go either way in time, so states are re-propagated from checkpoints a few
  // minutes before the guessed burn and arrival times (corrections are much smaller than that).
  const checkpoint = (initial, t) => { const st = Float64Array.from(initial); prop.propagate(st, t0, t); return { t, st }; };
  const cps = new Map();
  const at = (initial, t) => {
    let cp = cps.get(initial);
    if (!cp || t < cp.t) { cp = checkpoint(initial, Math.max(t0, t - 600)); cps.set(initial, cp); }
    const st = Float64Array.from(cp.st);
    prop.propagate(st, cp.t, t);
    return st;
  };
  let { tB, T } = pick;
  let chaser = at(ctx.chaser0, tB), station = at(ctx.station0, tB);
  for (let k = 0; k < 4; k++) {
    const W = unit(cross([station[0], station[1], station[2]], [station[3], station[4], station[5]]));
    const dt = -dot([chaser[0], chaser[1], chaser[2]], W) / dot([chaser[3], chaser[4], chaser[5]], W);
    if (Math.abs(dt) < 1e-4) break;
    tB += dt;
    chaser = at(ctx.chaser0, tB);
    station = at(ctx.station0, tB);
  }
  const anti = scale(unit([chaser[0], chaser[1], chaser[2]]), -1);
  let tA = tB + T;
  const stationKey = Float64Array.from(ctx.station0); // its own checkpoint, near arrival
  let stAtArrive = at(stationKey, tA);
  for (let k = 0; k < 4; k++) {
    // Put the aim point (not the station) on the crossing, so it lies in both planes.
    const rs = aimPoint(stAtArrive, ctx.aimBehind / 1000), vs = [stAtArrive[3], stAtArrive[4], stAtArrive[5]];
    const W = unit(cross(rs, vs));
    const lag = Math.atan2(dot(W, cross(unit(rs), anti)), dot(unit(rs), anti)); // how far it still has to go
    const dt = lag / n2;
    if (Math.abs(dt) < 1e-4) break;
    tA += dt;
    stAtArrive = at(stationKey, tA);
  }

  // Which way to rotate the velocity about the radius to head into the station's plane.
  const rB = [chaser[0], chaser[1], chaser[2]], vB = [chaser[3], chaser[4], chaser[5]];
  const Wst = unit(cross([stAtArrive[0], stAtArrive[1], stAtArrive[2]], [stAtArrive[3], stAtArrive[4], stAtArrive[5]]));
  const towards = (th) => dot(unit(cross(rB, rotateAbout(vB, unit(rB), th))), Wst);
  const sign = towards(planeDiff) >= towards(-planeDiff) ? 1 : -1;

  let warm = [h.dv1, 0]; // each solve starts from the last one's answer
  const cost = (th) => {
    const tr = targetTransfer(prop, chaser, tB, stAtArrive, tA, ctx.aimBehind, sign * th, warm);
    warm = tr.p;
    return { tr, total: norm(tr.dv) + norm(tr.dvMatch) };
  };
  const g = (Math.sqrt(5) - 1) / 2;
  let lo = 0, hi = planeDiff;
  let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = cost(x1).total, f2 = cost(x2).total;
  for (let i = 0; i < 20 && hi - lo > 1e-5; i++) {
    if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = cost(x1).total; }
    else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = cost(x2).total; }
  }
  const tilt = (lo + hi) / 2;
  const { tr, total } = cost(tilt);
  return {
    strategy: 'combined',
    wait: tB - t0, tof: tA - tB, phiReqDeg: null,
    tiltAtTransferDeg: tilt / DEG,
    planeChangeDv: 0,
    planeChangeTime: null,
    totalDv: total,
    missMeters: tr.miss * 1000,
    burns: [
      { t: tB, dvInertial: tr.dv, label: 'Transfer burn' },
      { t: tA, dvInertial: tr.dvMatch, label: 'Match velocity' },
    ],
    arriveTime: tA,
  };
}

// Times (two-body) when the chaser crosses the station's plane, from tFrom on.
function crossingTimes(ctx, tFrom, count) {
  const { r1, C, S, t0 } = ctx;
  const line = unit(cross(C.W, S.W));
  const uNode = Math.atan2(dot(line, C.Q), dot(line, C.P));
  const n1 = circularSpeed(r1) / r1;
  const times = [];
  // the chaser starts at u = 0; the planes cross at uNode and uNode + π, every orbit
  for (let k = 0; times.length < count; k++) {
    const t = t0 + (wrapAngle(uNode) + k * Math.PI) / n1;
    if (t >= tFrom) times.push(t);
  }
  return times;
}

function circularAt(ctx, which, t) {
  return which === 'chaser'
    ? circularState(ctx.r1, (circularSpeed(ctx.r1) / ctx.r1) * (t - ctx.t0), MU_EARTH, Math.acos(ctx.C.W[2]), Math.atan2(ctx.C.P[1], ctx.C.P[0]))
    : null;
}

const wrapPi = (a) => wrapAngle(a + Math.PI) - Math.PI;

// Rodrigues rotation of v about unit axis k by angle th.
function rotateAbout(v, k, th) {
  const c = Math.cos(th), s = Math.sin(th);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

// Transfer burn at tBurn that reaches the aim point behind the station at tArrive. The velocity is
// first tilted by `tilt` about the radius (a plane change folded into the burn); Newton's method
// then finds the in-plane Δv (prograde, radial). Out-of-plane Δv barely moves the arrival point
// half an orbit later, so it is not used for targeting. Returns the burn, the matching burn and
// the miss (km).
function targetTransfer(prop, chaserAtBurn, tBurn, stationAtArrive, tArrive, aimBehind, tilt, guess) {
  const target = aimPoint(stationAtArrive, aimBehind / 1000);
  const r = [chaserAtBurn[0], chaserAtBurn[1], chaserAtBurn[2]], v = [chaserAtBurn[3], chaserAtBurn[4], chaserAtBurn[5]];
  const vTilt = rotateAbout(v, unit(r), tilt);
  const f = localFrame(r, vTilt);
  const toDv = (p) => add(sub(vTilt, v), add(scale(f.pro, p[0]), scale(f.rad, p[1])));
  const arrive = (p) => {
    const s = Float64Array.from(chaserAtBurn);
    const d = toDv(p);
    s[3] += d[0]; s[4] += d[1]; s[5] += d[2];
    prop.propagate(s, tBurn, tArrive);
    return s;
  };
  // Errors measured along the station's along-track and radial directions at arrival.
  const ey = unit([stationAtArrive[3], stationAtArrive[4], stationAtArrive[5]]), ex = unit([stationAtArrive[0], stationAtArrive[1], stationAtArrive[2]]);
  const errOf = (s) => { const e = sub([s[0], s[1], s[2]], target); return [dot(e, ey), dot(e, ex), norm(e)]; };
  let p = [...guess], sArr;
  for (let it = 0; it < 10; it++) {
    sArr = arrive(p);
    const e = errOf(sArr);
    if (Math.hypot(e[0], e[1]) < 1e-4) break; // 10 cm
    const eps = 1e-6;
    const ea = errOf(arrive([p[0] + eps, p[1]])), eb = errOf(arrive([p[0], p[1] + eps]));
    const J = [[(ea[0] - e[0]) / eps, (eb[0] - e[0]) / eps], [(ea[1] - e[1]) / eps, (eb[1] - e[1]) / eps]];
    const D = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    p = [p[0] - (J[1][1] * e[0] - J[0][1] * e[1]) / D, p[1] - (-J[1][0] * e[0] + J[0][0] * e[1]) / D];
  }
  sArr = arrive(p);
  return {
    dv: toDv(p),
    dvMatch: sub([stationAtArrive[3], stationAtArrive[4], stationAtArrive[5]], [sArr[3], sArr[4], sArr[5]]),
    miss: errOf(sArr)[2],
    p,
  };
}
