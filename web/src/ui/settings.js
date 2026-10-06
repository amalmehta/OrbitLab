// Every preference in one place, with the Settings sheet that edits them.

import { loadStored, saveStored } from './bridge.js';

export const SETTING_DEFS = [
  { group: 'Simulation' },
  { key: 'defaultWarp', label: 'Time warp when flying a plan', type: 'select', options: [[100, '100×'], [1000, '1,000×'], [10000, '10,000×'], [100000, '100,000×']], default: 1000 },
  { key: 'slowForBurns', label: 'Slow down for burns', type: 'bool', default: true, hint: 'Drops time warp just before each burn so you can see it happen.' },
  { group: 'Display' },
  { key: 'showLabels', label: 'Show labels', type: 'bool', default: true },
  { key: 'showSOI', label: "Show the Moon's sphere of influence", type: 'bool', default: true },
  { key: 'showGrid', label: 'Show reference grid', type: 'bool', default: false },
  { key: 'quality', label: 'Graphics quality', type: 'select', options: [['high', 'High (sharp, uses more power)'], ['balanced', 'Balanced']], default: 'high' },
  { group: 'Docking agent' },
  { key: 'startPretrained', label: 'Start with the pretrained agent', type: 'bool', default: true, hint: 'Used when there is no saved agent of yours. Off: start untrained and watch it learn from scratch.' },
  { key: 'rememberAgent', label: 'Remember my trained agent between launches', type: 'bool', default: true, hint: 'Saved automatically while it trains. Load pretrained or Start from scratch replaces it.' },
  { key: 'learningRate', label: 'Learning rate', type: 'select', options: [[0.0003, '0.0003 (slow, steady)'], [0.001, '0.001 (default)'], [0.003, '0.003 (fast, can be unstable)']], default: 0.001 },
  { key: 'playbackSpeed', label: 'Episode playback speed', type: 'select', options: [[1, 'Real time'], [5, '5×'], [20, '20×'], [60, '60×']], default: 20 },
];

const listeners = new Set();
const values = {};
for (const d of SETTING_DEFS) if (d.key) values[d.key] = d.default;
Object.assign(values, loadStored('settings') ?? {});

export const settings = {
  get: (k) => values[k],
  all: () => ({ ...values }),
  set(k, v) {
    values[k] = v;
    saveStored('settings', values);
    listeners.forEach((fn) => fn(k, v));
  },
  reset() {
    for (const d of SETTING_DEFS) if (d.key) values[d.key] = d.default;
    saveStored('settings', values);
    listeners.forEach((fn) => fn('*'));
  },
  onChange: (fn) => listeners.add(fn),
};

export function buildSettingsSheet(root) {
  const body = root.querySelector('.sheet-body');
  const render = () => {
    body.innerHTML = '';
    for (const d of SETTING_DEFS) {
      if (d.group) {
        const h = document.createElement('h3');
        h.textContent = d.group;
        body.append(h);
        continue;
      }
      const row = document.createElement('label');
      row.className = 'setting-row';
      const text = document.createElement('span');
      text.className = 'setting-label';
      text.textContent = d.label;
      if (d.hint) {
        const hint = document.createElement('small');
        hint.textContent = d.hint;
        text.append(hint);
      }
      let input;
      if (d.type === 'bool') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(values[d.key]);
        input.addEventListener('change', () => settings.set(d.key, input.checked));
      } else {
        input = document.createElement('select');
        for (const [v, t] of d.options) {
          const o = document.createElement('option');
          o.value = String(v);
          o.textContent = t;
          if (String(values[d.key]) === String(v)) o.selected = true;
          input.append(o);
        }
        input.addEventListener('change', () => {
          const opt = d.options.find(([v]) => String(v) === input.value);
          settings.set(d.key, opt[0]);
        });
      }
      row.append(text, input);
      body.append(row);
    }
  };
  render();
  root.querySelector('[data-action=reset-settings]').addEventListener('click', () => { settings.reset(); render(); });
  return { render };
}
