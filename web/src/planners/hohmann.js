// Hohmann transfer planner: two prograde (or retrograde) burns between circular orbits.

import { R_EARTH, MU_EARTH } from '../physics/constants.js';
import { hohmann, circularState, period } from '../physics/orbits.js';
import { toState } from '../physics/propagator.js';

export const HOHMANN_DEFAULTS = { startAlt: 400, targetAlt: 35786, leadTime: 600 };

export function planHohmann({ startAlt, targetAlt, leadTime = 600, t0 = 0 }) {
  const r1 = R_EARTH + startAlt, r2 = R_EARTH + targetAlt;
  const h = hohmann(r1, r2);
  const tBurn1 = t0 + leadTime;
  const tBurn2 = tBurn1 + h.tof;
  return {
    r1, r2, ...h,
    burns: [
      { t: tBurn1, dv: [h.dv1, 0, 0], label: 'Transfer burn' },
      { t: tBurn2, dv: [h.dv2, 0, 0], label: 'Circularize' },
    ],
    initialState: toState(...Object.values(circularState(r1, 0))),
    startPeriod: period(r1, MU_EARTH),
    endTime: tBurn2 + period(r2, MU_EARTH),
  };
}
