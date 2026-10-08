// Bundles the app into web/dist/app.js. The workers (PPO training, texture painting, flyby search) are bundled
// first and inlined as strings so they can start from Blob URLs (works from file:// inside the Mac app's web view).
// Usage: node scripts/build-web.mjs [--serve]

import * as esbuild from 'esbuild';

const bundleWorker = async (entry) =>
  (await esbuild.build({ entryPoints: [entry], bundle: true, format: 'iife', minify: true, write: false })).outputFiles[0].text;
const trainerWorker = await bundleWorker('web/src/rl/trainer.worker.js');
const textureWorker = await bundleWorker('web/src/scene/textures.worker.js');
const plannerWorker = await bundleWorker('web/src/planners/planner.worker.js');

const options = {
  entryPoints: ['web/src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  sourcemap: true,
  target: ['safari16', 'chrome110'],
  outfile: 'web/dist/app.js',
  define: {
    __WORKER_SOURCE__: JSON.stringify(trainerWorker),
    __TEXTURE_WORKER_SOURCE__: JSON.stringify(textureWorker),
    __PLANNER_WORKER_SOURCE__: JSON.stringify(plannerWorker),
  },
  logLevel: 'info',
};

if (process.argv.includes('--serve')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'web', port: 8123 });
  console.log(`Orbit Lab running at http://localhost:${port}`);
} else {
  await esbuild.build(options);
}
