// Procedural planet textures, painted as raw RGBA pixels. Pure functions with no DOM access,
// so they run in a Web Worker and never block the first frame.

export function valueNoise(seed) {
  const perm = new Uint8Array(512);
  let s = seed;
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const grad = (h, x, y, z) => {
    const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  return (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(perm[AA] & 15, x, y, z), grad(perm[BA] & 15, x - 1, y, z), u), lerp(grad(perm[AB] & 15, x, y - 1, z), grad(perm[BB] & 15, x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1] & 15, x, y, z - 1), grad(perm[BA + 1] & 15, x - 1, y, z - 1), u), lerp(grad(perm[AB + 1] & 15, x, y - 1, z - 1), grad(perm[BB + 1] & 15, x - 1, y - 1, z - 1), u), v),
      w,
    );
  };
}

// Paint an equirectangular texture by sampling a 3D function on the sphere (no seams).
// Row 0 is the south pole, matching THREE.DataTexture's bottom-up row order.
function paintSphere(w, h, paint) {
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    const lat = -Math.PI / 2 + ((j + 0.5) / h) * Math.PI;
    for (let i = 0; i < w; i++) {
      const lon = (i / w) * 2 * Math.PI;
      const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon);
      const c = paint(x, y, z, lat);
      const k = (j * w + i) * 4;
      data[k] = c[0]; data[k + 1] = c[1]; data[k + 2] = c[2]; data[k + 3] = 255;
    }
  }
  return { w, h, data };
}

const fbm = (n, x, y, z, oct = 5) => {
  let a = 0.5, f = 1, s = 0;
  for (let o = 0; o < oct; o++) { s += a * n(x * f, y * f, z * f); a *= 0.5; f *= 2; }
  return s;
};

const earthNoise = valueNoise(42), cloudNoise = valueNoise(7);

export const PAINTERS = {
  earth: () => paintSphere(1024, 512, (x, y, z, lat) => {
    const n = earthNoise, c = cloudNoise;
    const h = fbm(n, x * 1.6 + 3, y * 1.6, z * 1.6, 5);
    const ice = Math.abs(lat) > 1.22 + 0.08 * n(x * 4, y * 4, z * 4);
    if (ice) return [235, 240, 245];
    if (h > 0.04) {
      const dry = fbm(c, x * 3, y * 3, z * 3, 3);
      const t = Math.min(1, (h - 0.04) * 6);
      return dry > 0.05 ? [168 - 30 * t, 150 - 25 * t, 105 - 20 * t] : [62 + 30 * dry, 112 - 20 * t, 58];
    }
    const depth = Math.min(1, -h * 4 + 0.3);
    return [14 + 20 * (1 - depth), 52 + 50 * (1 - depth), 110 + 50 * (1 - depth)];
  }),
  clouds: () => paintSphere(512, 256, (x, y, z) => {
    const v = fbm(cloudNoise, x * 2.5 + 11, y * 5, z * 2.5, 5);
    const a = Math.max(0, Math.min(1, (v - 0.02) * 4));
    return [255 * a, 255 * a, 255 * a];
  }),
  moon: () => {
    const n = valueNoise(3);
    const craters = Array.from({ length: 90 }, (_, i) => {
      const u = Math.sin(i * 12.9898) * 43758.5453, v = Math.sin(i * 78.233) * 12543.123;
      const th = (u - Math.floor(u)) * 2 * Math.PI, ph = Math.acos(2 * (v - Math.floor(v)) - 1);
      return { p: [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)], r: 0.03 + 0.08 * Math.abs((u * 7) % 1) };
    }).map((c) => ({ ...c, r2: c.r * c.r, rim2: 0.64 * c.r * c.r }));
    return paintSphere(512, 256, (x, y, z) => {
      let g = 150 + 50 * fbm(n, x * 3, y * 3, z * 3, 5);
      const mare = fbm(n, x * 1.2 + 5, y * 1.2, z * 1.2, 3);
      if (mare > 0.08) g -= 45;
      for (const cr of craters) {
        const dx = x - cr.p[0], dy = y - cr.p[1], dz = z - cr.p[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < cr.r2) g += d2 > cr.rim2 ? 25 : -20;
      }
      return [g, g, g * 0.98];
    });
  },
};
