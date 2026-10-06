// Paints planet textures off the main thread. Message in: { name }. Out: { name, w, h, data }.
import { PAINTERS } from './textures.js';

self.onmessage = (e) => {
  const tex = PAINTERS[e.data.name]();
  self.postMessage({ name: e.data.name, ...tex }, [tex.data.buffer]);
};
