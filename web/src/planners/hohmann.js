// Hohmann transfer planner: two burns between circular orbits, optionally changing inclination.
// The burns sit on the line of nodes (where the start and target planes cross), and the plane
// change is split between them to minimise total Δv. Most of it goes at the far, slower burn.

import { R_EARTH, MU_EARTH, DEG } from '../physics/constants.js';
import { hohmannPlaneChange, circularState, period, unit, scale, localComponents } from '../physics/orbits.js';
import { toState } from '../physics/propagator.js';

export const HOHMANN_DEFAULTS = { startAlt: 400, targetAlt: 35786, startInc: 28.5, targetInc: 0, leadTime: 600 };

// Direction of travel on a circular orbit of inclination inc at argument of latitude u.
const direction = (u, inc) => unit(circularState(1, u, MU_EARTH, inc).v);

export function planHohmann({ startAlt, targetAlt, startInc = 0, targetInc = 0, leadTime = 600, t0 = 0, epoch }) {
  const r1 = R_EARTH + startAlt, r2 = R_EARTH + targetAlt;
  const i0 = startInc * DEG, iT = targetInc * DEG;
  const h = hohmannPlaneChange(r1, r2, iT - i0);
  const iMid = i0 + h.di1;
  const n1 = Math.sqrt(MU_EARTH / r1 ** 3);
  const tBurn1 = t0 + leadTime;
  const tBurn2 = tBurn1 + h.tof;

  // Burn 1 at the ascending node (u = 0), burn 2 at the descending node (u = π).
  const rB1 = [r1, 0, 0], rB2 = [-r2, 0, 0];
  const dv1 = localComponents(rB1, scale(direction(0, i0), h.v1), scale(direction(0, iMid), h.vp));
  const dv2 = localComponents(rB2, scale(direction(Math.PI, iMid), h.va), scale(direction(Math.PI, iT), h.v2));

  // Start leadTime before the ascending node.
  const start = circularState(r1, -n1 * leadTime, MU_EARTH, i0);
  return {
    r1, r2, startInc, targetInc, epoch,
    tof: h.tof, a: h.a,
    dv1: h.dv1, dv2: h.dv2, total: h.total,
    di1Deg: h.di1 / DEG, di2Deg: h.di2 / DEG,
    planeChange: Math.abs(iT - i0) > 1e-9,
    separateTotal: h.separateTotal,
    burns: [
      { t: tBurn1, dv: dv1, label: 'Transfer burn' },
      { t: tBurn2, dv: dv2, label: 'Circularize' },
    ],
    initialState: toState(start.r, start.v),
    startPeriod: period(r1, MU_EARTH),
    endTime: tBurn2 + period(r2, MU_EARTH),
  };
}
