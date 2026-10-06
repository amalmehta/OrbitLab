import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planHohmann } from '../web/src/planners/hohmann.js';
import { planGravityAssist } from '../web/src/planners/gravityAssist.js';
import { planRendezvous, relativeLVLH } from '../web/src/planners/rendezvous.js';
import { Propagator } from '../web/src/physics/propagator.js';
import { elements } from '../web/src/physics/orbits.js';
import { R_EARTH } from '../web/src/physics/constants.js';

test('Hohmann plan, flown in the full Earth–Moon model, ends near the target orbit', () => {
  const plan = planHohmann({ startAlt: 400, targetAlt: 35786 });
  const s = Float64Array.from(plan.initialState);
  new Propagator({ moonPhase0: 1.9 }).propagate(s, 0, plan.burns[1].t + 60, { burns: plan.burns });
  const el = elements([s[0], s[1], s[2]], [s[3], s[4], s[5]]);
  assert.ok(Math.abs(el.a - (R_EARTH + 35786)) < 50, `a = ${el.a}`); // Moon perturbs slightly
  assert.ok(el.e < 0.005, `e = ${el.e}`);
});

test('gravity assist: trailing-side flyby hits the requested altitude and gains energy', () => {
  const plan = planGravityAssist({ parkingAlt: 200, flybyAlt: 2000, side: 'trailing' });
  assert.ok(plan.ok, plan.reason);
  assert.ok(Math.abs(plan.flyby.periapsisAlt - 2000) < 50, `alt ${plan.flyby.periapsisAlt}`);
  assert.ok(plan.flyby.dEnergy > 0);
  assert.ok(plan.flyby.turnDeg > 10 && plan.flyby.turnDeg < 180);
});

test('gravity assist: leading-side flyby with a hotter TLI loses energy', () => {
  const plan = planGravityAssist({ parkingAlt: 200, flybyAlt: 2000, side: 'leading', apogeeFactor: 1.3 });
  assert.ok(plan.ok, plan.reason);
  assert.ok(plan.flyby.dEnergy < 0, `dE ${plan.flyby.dEnergy}`);
});

test('rendezvous plan delivers the chaser ~40 m behind the station, nearly at rest', () => {
  const plan = planRendezvous({ chaserAlt: 300, stationAlt: 420, phaseDeg: 40, aimBehind: 40 });
  assert.ok(plan.ok);
  const prop = new Propagator({ moonPhase0: plan.moonPhase0 });
  const c = Float64Array.from(plan.chaser0), st = Float64Array.from(plan.station0);
  // Fly it the way the app does: in uneven frame-sized chunks.
  let t = 0;
  const end = plan.arriveTime + 1;
  while (t < end) {
    const t1 = Math.min(end, t + 41.7);
    prop.propagate(c, t, t1, { burns: plan.burns });
    prop.propagate(st, t, t1);
    t = t1;
  }
  const rel = relativeLVLH(c, st);
  assert.ok(Math.abs(rel.pos[1] + 40) < 2, `along-track ${rel.pos[1]} m`);
  assert.ok(Math.hypot(...rel.vel) < 0.1, `rel speed ${Math.hypot(...rel.vel)} m/s`);
});
