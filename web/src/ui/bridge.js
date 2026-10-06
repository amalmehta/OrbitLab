// Talks to the Mac app when running inside it (WKWebView message handler), and falls back to
// browser storage when running as a plain web page.

const native = () => window.webkit?.messageHandlers?.orbitLab;

export const isMacApp = () => Boolean(native());

export function postNative(message) {
  const h = native();
  if (h) h.postMessage(message);
  return Boolean(h);
}

export function loadStored(key) {
  // The Mac app injects saved values before the page loads.
  const injected = window.__ORBIT_LAB_STORE__?.[key];
  if (injected !== undefined) return injected;
  try {
    const raw = localStorage.getItem(`orbitLab.${key}`);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function saveStored(key, value) {
  if (postNative({ type: 'store', key, value })) return;
  try { localStorage.setItem(`orbitLab.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function openExternal(url) {
  if (!postNative({ type: 'openURL', url })) window.open(url, '_blank', 'noopener');
}
