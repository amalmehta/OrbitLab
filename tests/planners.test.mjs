import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planHohmann } from '../web/src/planners/hohmann.js';
import { planGravityAssist } from '../web/src/planners/gravityAssist.js';
import { planRendezvous, relativeLVLH } from '../web/src/planners/rendezvous.js';
import { Propagator } from '../web/src/physics/propagator.js';
import { elements } from '../web/src/physics/orbits.js';
import { R_EARTH, DEG, epochFromDate } from '../web/src/physics/constants.js';

test('Hohmann plan, flown in the full Earth–Moon model, ends near the target orbit', () => {
  const plan = planHohmann({ startAlt: 400, targetAlt: 35786 });
  const s = Float64Array.from(plan.initialState);
  new Propagator().propagate(s, 0, plan.burns[1].t + 60, { burns: plan.burns });
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
  const prop = new Propagator({ epoch: plan.epoch });
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

test('Hohmann with plane change, flown in the full model, ends equatorial at GEO', () => {
  const plan = planHohmann({ startAlt: 300, targetAlt: 35786, startInc: 28.5, targetInc: 0 });
  const s = Float64Array.from(plan.initialState);
  new Propagator().propagate(s, 0, plan.burns[1].t + 60, { burns: plan.burns });
  const el = elements([s[0], s[1], s[2]], [s[3], s[4], s[5]]);
  assert.ok(el.inc / DEG < 0.05, `inc ${el.inc / DEG}°`);
  assert.ok(Math.abs(el.a - (R_EARTH + 35786)) < 50 && el.e < 0.005);
});

test('gravity assist from a steep parking orbit, with the Moon near its least tilt (2034), still hits the target', () => {
  const plan = planGravityAssist({ parkingAlt: 200, parkingInc: 51.6, flybyAlt: 2000, side: 'trailing', epoch: epochFromDate(new Date(Date.UTC(2034, 11, 20))) });
  assert.ok(plan.ok, plan.reason);
  assert.ok(Math.abs(plan.flyby.periapsisAlt - 2000) < 50);
});

test('gravity assist explains when the parking orbit cannot reach the Moon’s plane', () => {
  const plan = planGravityAssist({ parkingAlt: 200, parkingInc: 0, flybyAlt: 2000 });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /inclination/);
});

for (const [name, args] of [
  ['small mismatch (combined is cheaper)', { chaserInc: 51.0, stationInc: 51.6, nodeOffset: 0.4, phaseDeg: 40 }],
  ['Florida orbit to a 51.6° station', { chaserInc: 28.5, stationInc: 51.6, nodeOffset: 3, phaseDeg: 40 }],
  ['node offset only, long wait', { chaserInc: 51.6, stationInc: 51.6, nodeOffset: -2, phaseDeg: 200 }],
]) test(`rendezvous across different planes, ${name}: ~40 m behind the port, in plane`, () => {
  const plan = planRendezvous({ chaserAlt: 300, stationAlt: 420, ...args });
  assert.equal(plan.strategy, 'combined');
  assert.ok(plan.combinedTotalDv < plan.separateTotalDv, 'folding the plane change into the burns saves Δv');
  const prop = new Propagator({ epoch: plan.epoch });
  const c = Float64Array.from(plan.chaser0), st = Float64Array.from(plan.station0);
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
  assert.ok(Math.abs(rel.pos[2]) < 2, `cross-track ${rel.pos[2]} m`);
  assert.ok(Math.hypot(...rel.vel) < 0.1);
});

test('gravity assist over the Moon\'s north pole tilts the orbit a lot', () => {
  const plan = planGravityAssist({ parkingAlt: 200, parkingInc: 28.5, flybyAlt: 2000, side: 'north' });
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.flyby.side, 'north');
  assert.ok(Math.abs(plan.flyby.periapsisAlt - 2000) < 50);
  assert.ok(plan.flyby.incAfterDeg - plan.flyby.incBeforeDeg > 15, `tilt ${plan.flyby.incBeforeDeg} → ${plan.flyby.incAfterDeg}`);
});

test('gravity assist under the Moon\'s south pole', () => {
  const plan = planGravityAssist({ parkingAlt: 200, parkingInc: 28.5, flybyAlt: 2000, side: 'south', epoch: epochFromDate(new Date(Date.UTC(2034, 11, 20))) });
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.flyby.side, 'south');
  assert.ok(Math.abs(plan.flyby.periapsisAlt - 2000) < 50);
});

test('separate plane change still works and is what a combined plan is compared against', () => {
  const plan = planRendezvous({ chaserAlt: 300, stationAlt: 420, phaseDeg: 40, chaserInc: 51.0, stationInc: 51.6, nodeOffset: 0.4 });
  assert.ok(plan.separateTotalDv > 0.15 && plan.separateTotalDv < 0.17, `separate ${plan.separateTotalDv}`);
});
