// Docking environment: a chaser near a station in a circular orbit, using the
// Clohessy–Wiltshire (Hill) equations in the station's local frame.
//   x = radial (away from Earth), y = along-track (direction of motion), z = cross-track
// The docking port sits at the origin and faces -y, so the agent approaches along the
// "V-bar" from behind the station. Units: metres, seconds.

import { gaussian } from './mlp.js';

export const DOCKING = {
  dt: 1.0,              // s per agent step
  maxSteps: 300,
  maxAccel: 0.04,       // m/s² per axis at full throttle
  dockRadius: 0.5,      // m: contact distance
  dockSpeed: 0.25,      // m/s: max closing speed for a soft dock
  outOfBounds: 120,     // m
  startMin: 15,         // m
  startMax: 50,         // m
  startConeDeg: 35,     // start positions lie in a cone around -y
  stationBox: { x: 6, y: 28, z: 6 }, // the station hull occupies 0 < y < 28, |x|,|z| < 6
};

export const OBS_SIZE = 6;
export const ACT_SIZE = 3;

export class DockingEnv {
  constructor(rand = Math.random, orbitAltitudeKm = 420) {
    this.rand = rand;
    const mu = 398600.4418, r = 6371 + orbitAltitudeKm;
    this.n = Math.sqrt(mu / (r * r * r)); // rad/s
    this.state = new Float64Array(6);
    this.reset();
  }

  reset(initial) {
    const c = DOCKING;
    if (initial) {
      this.state.set(initial);
    } else {
      const d = c.startMin + this.rand() * (c.startMax - c.startMin);
      const cone = (c.startConeDeg * Math.PI) / 180;
      const th = Math.acos(1 - this.rand() * (1 - Math.cos(cone)));
      const ph = this.rand() * 2 * Math.PI;
      const s = this.state;
      s[0] = d * Math.sin(th) * Math.cos(ph);
      s[1] = -d * Math.cos(th);
      s[2] = d * Math.sin(th) * Math.sin(ph);
      for (let i = 3; i < 6; i++) s[i] = gaussian(this.rand) * 0.08;
    }
    this.steps = 0;
    this.fuel = 0; // accumulated Δv, m/s
    this.dist = this.distance();
    this.done = false;
    this.outcome = null;
    return this.observe();
  }

  distance() {
    const s = this.state;
    return Math.hypot(s[0], s[1], s[2]);
  }

  speed() {
    const s = this.state;
    return Math.hypot(s[3], s[4], s[5]);
  }

  observe(out = new Float64Array(OBS_SIZE)) {
    const s = this.state;
    out[0] = s[0] / 30; out[1] = s[1] / 30; out[2] = s[2] / 30;
    out[3] = s[3] * 2; out[4] = s[4] * 2; out[5] = s[5] * 2;
    return out;
  }

  derivs(s, a, out) {
    const n = this.n;
    out[0] = s[3]; out[1] = s[4]; out[2] = s[5];
    out[3] = 3 * n * n * s[0] + 2 * n * s[4] + a[0];
    out[4] = -2 * n * s[3] + a[1];
    out[5] = -n * n * s[2] + a[2];
  }

  // action: 3 numbers, clipped to [-1, 1]. Returns { obs, reward, done }.
  step(action) {
    const c = DOCKING;
    const a = [0, 0, 0];
    let effort = 0;
    for (let i = 0; i < 3; i++) {
      const u = Math.max(-1, Math.min(1, action[i]));
      a[i] = u * c.maxAccel;
      effort += u * u;
    }
    this.lastAccel = a;
    // RK4 over one step
    const s = this.state, h = c.dt;
    const k1 = new Float64Array(6), k2 = new Float64Array(6), k3 = new Float64Array(6), k4 = new Float64Array(6), t = new Float64Array(6);
    this.derivs(s, a, k1);
    for (let i = 0; i < 6; i++) t[i] = s[i] + 0.5 * h * k1[i];
    this.derivs(t, a, k2);
    for (let i = 0; i < 6; i++) t[i] = s[i] + 0.5 * h * k2[i];
    this.derivs(t, a, k3);
    for (let i = 0; i < 6; i++) t[i] = s[i] + h * k3[i];
    this.derivs(t, a, k4);
    for (let i = 0; i < 6; i++) s[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    this.fuel += Math.hypot(a[0], a[1], a[2]) * h;
    this.steps++;

    const d = this.distance(), v = this.speed();
    let reward = 1.0 * (this.dist - d) - 0.02 * effort;
    if (d < 6) reward -= 0.05 * Math.max(0, v - 0.15 - 0.05 * d); // slow down near the port
    this.dist = d;

    const box = c.stationBox;
    const inHull = s[1] > 0 && s[1] < box.y && Math.abs(s[0]) < box.x && Math.abs(s[2]) < box.z;
    if (d < c.dockRadius) {
      this.done = true;
      if (v < c.dockSpeed) { this.outcome = 'docked'; reward += 10; }
      else { this.outcome = 'crashed'; reward -= 5; }
    } else if (inHull) {
      this.done = true; this.outcome = 'crashed'; reward -= 5;
    } else if (d > c.outOfBounds) {
      this.done = true; this.outcome = 'drifted'; reward -= 5;
    } else if (this.steps >= c.maxSteps) {
      this.done = true; this.outcome = 'timeout';
    }
    return { obs: this.observe(), reward, done: this.done };
  }
}
