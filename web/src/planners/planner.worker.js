// Runs the slower planners off the main thread so the app stays responsive while they work.
import { planGravityAssist } from './gravityAssist.js';
import { planRendezvous } from './rendezvous.js';

const PLANNERS = { assist: planGravityAssist, rendezvous: planRendezvous };

self.onmessage = (e) => {
  const { id, kind, params } = e.data;
  self.postMessage({ id, plan: PLANNERS[kind](params) });
};
