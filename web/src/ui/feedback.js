// The small Feedback tab on the right edge. Feedback is saved locally (in the Mac app:
// ~/Library/Application Support/Orbit Lab/feedback.jsonl) and can be opened as a GitHub issue.

import { postNative, loadStored, saveStored, openExternal, isMacApp } from './bridge.js';

export const REPO_URL = 'https://github.com/amalmehta/OrbitLab';

export function setupFeedback({ tab, panel, getContext }) {
  const text = panel.querySelector('textarea');
  const status = panel.querySelector('.feedback-status');
  const open = () => { panel.hidden = false; tab.hidden = true; text.focus(); };
  const close = () => { panel.hidden = true; tab.hidden = false; status.textContent = ''; };
  tab.addEventListener('click', open);
  panel.querySelector('[data-action=close-feedback]').addEventListener('click', close);

  const entry = () => ({ text: text.value.trim(), at: new Date().toISOString(), ...getContext() });

  panel.querySelector('[data-action=save-feedback]').addEventListener('click', () => {
    const e = entry();
    if (!e.text) { status.textContent = 'Write something first.'; return; }
    if (!postNative({ type: 'feedback', entry: e })) {
      const list = loadStored('feedback') ?? [];
      list.push(e);
      saveStored('feedback', list);
    }
    status.textContent = isMacApp() ? 'Saved to ~/Library/Application Support/Orbit Lab/feedback.jsonl — thanks!' : 'Saved in this browser — thanks!';
    text.value = '';
  });

  panel.querySelector('[data-action=issue-feedback]').addEventListener('click', () => {
    const e = entry();
    const title = encodeURIComponent(`Feedback: ${e.text.split('\n')[0].slice(0, 60) || 'Orbit Lab'}`);
    const body = encodeURIComponent(`${e.text}\n\n---\nMode: ${e.mode}\nApp: ${e.app}`);
    openExternal(`${REPO_URL}/issues/new?title=${title}&body=${body}`);
  });

  return { open, close };
}
