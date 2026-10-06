// Captures the README screenshots by driving the app in headless Chrome.
// Needs the dev server running (npm run dev) and Google Chrome installed.
// Usage: node scripts/screenshots.mjs

import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL ?? 'http://localhost:8123';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,900'],
  protocolTimeout: 600000,
  defaultViewport: { width: 1440, height: 860, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await wait(6000); // textures

const shot = async (name) => {
  await page.screenshot({ path: `docs/images/${name}.png` });
  console.log(`docs/images/${name}.png`);
};
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);

// Hohmann: fly partway along the transfer ellipse.
await page.evaluate(() => window.orbitLab.setMode('hohmann'));
await click('[data-panel=hohmann] [data-action=fly]');
await page.evaluate(() => { window.__orbitLab.app.warp = 10000; });
await page.waitForFunction(() => window.__orbitLab.app.flight.t > 9000, { timeout: 120000 });
await page.evaluate(() => { window.__orbitLab.app.paused = true; });
await wait(500);
await shot('hohmann');

// Gravity assist: plan, then fly past the Moon.
await page.evaluate(() => window.orbitLab.setMode('assist'));
await click('[data-action=find-flyby]');
await page.waitForFunction(() => !document.querySelector('[data-panel=assist] [data-action=fly]').disabled, { timeout: 60000 });
await click('[data-panel=assist] [data-action=fly]');
await page.evaluate(() => { window.__orbitLab.app.warp = 100000; });
await page.waitForFunction(() => window.__orbitLab.app.flight.t > window.__orbitLab.app.plan.flyby.closestTime + 86400, { timeout: 180000 });
await page.evaluate(() => { window.__orbitLab.app.paused = true; });
await wait(500);
await shot('gravity-assist');

// Rendezvous: show the plan close to Earth.
await page.evaluate(() => window.orbitLab.setMode('rendezvous'));
await wait(1500);
await shot('rendezvous');

// Docking: train from scratch for a while so the chart has a curve, then show a replay.
await page.evaluate(() => window.orbitLab.setMode('docking'));
await click('[data-action=scratch]');
await page.waitForFunction(() => window.__orbitLab.docking.stats.successRate > 0.6, { timeout: 600000, polling: 2000 });
await page.evaluate(() => window.__orbitLab.docking.stopTraining());
await page.waitForFunction(() => window.__orbitLab.docking.env.steps > 40 && window.__orbitLab.docking.env.distance() < 12 && !window.__orbitLab.docking.env.done, { timeout: 120000, polling: 100 });
await shot('docking');

await browser.close();
