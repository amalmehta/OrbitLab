// Trains the docking agent headless in Node and writes the pretrained checkpoint the app ships with.
// Usage: node scripts/train-docking.mjs [iterations] [--out web/assets/pretrained-docking.json]

import { writeFileSync } from 'node:fs';
import { PPOAgent, Trainer, evaluate } from '../web/src/rl/ppo.js';

const args = process.argv.slice(2);
const iterations = Number(args.find((a) => /^\d+$/.test(a)) ?? 150);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : 'web/assets/pretrained-docking.json';

const agent = new PPOAgent();
const trainer = new Trainer(agent);
const t0 = Date.now();
let best = { successRate: -1 };
for (let i = 1; i <= iterations; i++) {
  const s = trainer.iterate();
  if (i % 10 === 0 || i === iterations) {
    const ev = evaluate(agent, 100);
    console.log(
      `iter ${String(i).padStart(4)}  steps ${String(s.totalSteps).padStart(7)}  ` +
      `return ${s.meanReturn.toFixed(2).padStart(6)}  train-success ${(s.successRate * 100).toFixed(0).padStart(3)}%  ` +
      `eval-success ${(ev.successRate * 100).toFixed(0).padStart(3)}%  fuel ${ev.meanFuel.toFixed(2)} m/s  ` +
      `σ ${Array.from(agent.logStd, (x) => Math.exp(x).toFixed(2)).join(',')}  ${((Date.now() - t0) / 1000).toFixed(0)}s`
    );
    if (ev.successRate >= best.successRate) {
      best = { ...ev, iteration: i, json: JSON.stringify({ ...agent.toJSON(), trainedSteps: s.totalSteps, evalSuccess: ev.successRate }) };
    }
  }
}
writeFileSync(out, best.json);
console.log(`saved iteration ${best.iteration} (eval success ${(best.successRate * 100).toFixed(0)}%) → ${out}`);
