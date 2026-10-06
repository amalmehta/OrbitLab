// A flight in progress: the spacecraft (and optionally a station) advancing in simulated time,
// executing planned burns, keeping a trail and a predicted path for drawing.

import { Propagator } from './propagator.js';
import { elements } from './orbits.js';

export class Flight {
  constructor({ craft, station = null, burns = [], moonPhase0 = 1.9, t0 = 0 }) {
    this.prop = new Propagator({ moonPhase0 });
    this.t = t0;
    this.craft = Float64Array.from(craft);
    this.station = station ? Float64Array.from(station) : null;
    this.burns = burns.map((b, i) => ({ ...b, id: i, done: false }));
    this.trail = [[this.craft[0], this.craft[1], this.craft[2]]];
    this.events = [];
    this.impact = null;
    this.prediction = [];
    this.predict();
  }

  get nextBurn() {
    return this.burns.find((b) => !b.done) ?? null;
  }

  moon() {
    return this.prop.moonAt(this.t);
  }

  // Advance by dt seconds of simulated time. Returns burns executed during this call.
  advance(dt) {
    if (this.impact || dt <= 0) return [];
    const t1 = this.t + dt;
    const executed = this.burns.filter((b) => !b.done && b.t >= this.t && b.t < t1);
    const c = this.craft;
    const res = this.prop.propagate(c, this.t, t1, {
      burns: executed,
      onStep: () => {
        const last = this.trail[this.trail.length - 1];
        if (Math.hypot(c[0] - last[0], c[1] - last[1], c[2] - last[2]) > Math.max(15, Math.hypot(c[0], c[1], c[2]) * 0.003)) {
          this.trail.push([c[0], c[1], c[2]]);
          if (this.trail.length > 6000) this.trail.splice(0, 1000);
        }
        return false;
      },
    });
    if (this.station) this.prop.propagate(this.station, this.t, res.t);
    executed.forEach((b) => { if (b.t <= res.t) { b.done = true; this.events.push({ t: b.t, text: b.label }); } });
    this.t = res.t;
    if (res.impact) {
      this.impact = res.impact;
      this.events.push({ t: this.t, text: `Impact with the ${res.impact}` });
    }
    if (executed.length) this.predict();
    return executed.filter((b) => b.done);
  }

  // Predicted path from now: through the remaining burns, then about one orbit of the result.
  predict() {
    const remaining = this.burns.filter((b) => !b.done);
    const lastBurn = remaining.length ? remaining[remaining.length - 1].t : this.t;
    const s = Float64Array.from(this.craft);
    const pts = [[s[0], s[1], s[2]]];
    let lastPt = pts[0];
    this.burnPositions = {};
    const onStep = (t) => {
      for (const b of remaining) if (Math.abs(t - b.t) < 1e-6) this.burnPositions[b.id] = [s[0], s[1], s[2]];
      const p = [s[0], s[1], s[2]];
      if (Math.hypot(p[0] - lastPt[0], p[1] - lastPt[1], p[2] - lastPt[2]) > Math.max(15, Math.hypot(...p) * 0.003)) {
        pts.push(p);
        lastPt = p;
      }
      return pts.length > 9000;
    };
    let res = this.prop.propagate(s, this.t, lastBurn + 1e-3, { burns: remaining, onStep });
    if (!res.impact) {
      const el = elements([s[0], s[1], s[2]], [s[3], s[4], s[5]]);
      const span = Math.min(isFinite(el.period) ? el.period * 1.02 : Infinity, 10 * 86400);
      res = this.prop.propagate(s, res.t, res.t + span, { onStep });
    }
    pts.push([s[0], s[1], s[2]]);
    this.prediction = pts;
    this.predictedImpact = res.impact;
    return pts;
  }
}
