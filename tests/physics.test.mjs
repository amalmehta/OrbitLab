import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MU_EARTH, R_EARTH, MOON_SOI, MOON_ORBIT, DEG } from '../web/src/physics/constants.js';
import { hohmann, hohmannPlaneChange, elements, circularState, moonState, period, localFrame } from '../web/src/physics/orbits.js';
import { Propagator, toState } from '../web/src/physics/propagator.js';

test('Hohmann LEO→GEO matches textbook Δv (≈3.9 km/s)', () => {
  const h = hohmann(R_EARTH + 300, 42164);
  assert.ok(Math.abs(h.total - 3.89) < 0.02, `total ${h.total}`);
  assert.ok(Math.abs(h.tof / 3600 - 5.27) < 0.05, `tof ${h.tof / 3600} h`);
});

test('Moon sphere of influence ≈ 66,000 km', () => {
  assert.ok(Math.abs(MOON_SOI - 66100) < 300);
});

test('two-body circular orbit conserves energy and returns after one period', () => {
  const r = R_EARTH + 500;
  const { r: r0, v: v0 } = circularState(r, 0.3);
  const s = toState(r0, v0);
  const prop = new Propagator({ moon: false });
  const e0 = elements(r0, v0).energy;
  prop.propagate(s, 0, period(r));
  const e1 = elements([s[0], s[1], s[2]], [s[3], s[4], s[5]]).energy;
  assert.ok(Math.abs((e1 - e0) / e0) < 1e-7, `energy drift ${(e1 - e0) / e0}`);
  assert.ok(Math.hypot(s[0] - r0[0], s[1] - r0[1]) < 0.5, 'returns within 0.5 km');
});

test('executing a Hohmann transfer numerically reaches the target circular orbit', () => {
  const r1 = R_EARTH + 400, r2 = R_EARTH + 2000;
  const h = hohmann(r1, r2);
  const s = toState(...Object.values(circularState(r1, 0)));
  const prop = new Propagator({ moon: false });
  prop.propagate(s, 0, 100 + h.tof + 10, { burns: [{ t: 100, dv: [h.dv1, 0, 0] }, { t: 100 + h.tof, dv: [h.dv2, 0, 0] }] });
  const el = elements([s[0], s[1], s[2]], [s[3], s[4], s[5]]);
  assert.ok(Math.abs(el.a - r2) < 1, `a = ${el.a}`);
  assert.ok(el.e < 1e-4, `e = ${el.e}`);
});

test('local frame: prograde ⟂ radial, radial points away from Earth', () => {
  const { r, v } = circularState(7000, 1.0);
  const f = localFrame(r, v);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(dot(f.pro, f.rad)) < 1e-12);
  assert.ok(dot(f.rad, r) > 0);
});

test('propagator detects an Earth impact', () => {
  const s = toState([R_EARTH + 200, 0, 0], [0, 1, 0]);
  const res = new Propagator({ moon: false }).propagate(s, 0, 20000);
  assert.equal(res.impact, 'Earth');
  assert.ok(MU_EARTH > 0);
});

test('inclined circular states have the requested inclination', () => {
  for (const inc of [0, 28.5, 51.6, 90]) {
    const { r, v } = circularState(7000, 1.234, undefined, inc * DEG, 0.7);
    assert.ok(Math.abs(elements(r, v).inc / DEG - inc) < 1e-9);
  }
});

test("the Moon's orbit is tilted to the equator by the chosen inclination", () => {
  const top = moonState(0, Math.PI / 2, 28 * DEG); // 90° past the ascending node
  assert.ok(Math.abs(top.r[2] - MOON_ORBIT * Math.sin(28 * DEG)) < 1e-6);
  assert.ok(Math.abs(Math.hypot(...top.v) - Math.hypot(...moonState(1000, 0, 28 * DEG).v)) < 1e-12, 'constant speed');
});

test('Hohmann with plane change: Florida LEO → GEO matches the textbook (~4.2 km/s, ~2° at perigee)', () => {
  const h = hohmannPlaneChange(R_EARTH + 300, 42164, -28.5 * DEG);
  assert.ok(h.total > 4.2 && h.total < 4.27, `total ${h.total}`);
  assert.ok(Math.abs(h.di1 / DEG) > 1.5 && Math.abs(h.di1 / DEG) < 3, `first-burn tilt ${h.di1 / DEG}`);
  assert.ok(h.separateTotal - h.total > 1, 'splitting saves over a separate plane change');
});
