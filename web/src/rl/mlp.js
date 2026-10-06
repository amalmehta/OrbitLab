// A tiny fully connected network with tanh hidden layers, manual backprop and Adam.
// Plain Float64Arrays so it runs the same in the browser, a Web Worker and Node.

export function seededRandom(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export class MLP {
  // sizes: [in, h1, ..., out]; outScale shrinks the last layer's init (small initial policy outputs).
  constructor(sizes, rand = Math.random, outScale = 1) {
    this.sizes = sizes;
    this.W = [];
    this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const nIn = sizes[l], nOut = sizes[l + 1];
      const scale = Math.sqrt(1 / nIn) * (l === sizes.length - 2 ? outScale : 1);
      const w = new Float64Array(nIn * nOut);
      for (let i = 0; i < w.length; i++) w[i] = gaussian(rand) * scale;
      this.W.push(w);
      this.b.push(new Float64Array(nOut));
    }
    this.gW = this.W.map((w) => new Float64Array(w.length));
    this.gb = this.b.map((b) => new Float64Array(b.length));
    this.mW = this.W.map((w) => new Float64Array(w.length));
    this.vW = this.W.map((w) => new Float64Array(w.length));
    this.mb = this.b.map((b) => new Float64Array(b.length));
    this.vb = this.b.map((b) => new Float64Array(b.length));
    this.t = 0;
    // activations cache for backprop
    this.acts = sizes.map((n) => new Float64Array(n));
    this.deltas = sizes.map((n) => new Float64Array(n));
  }

  forward(x) {
    const A = this.acts;
    A[0].set(x);
    const L = this.W.length;
    for (let l = 0; l < L; l++) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1];
      const w = this.W[l], b = this.b[l], a = A[l], out = A[l + 1];
      for (let j = 0; j < nOut; j++) {
        let s = b[j];
        const row = j * nIn;
        for (let i = 0; i < nIn; i++) s += w[row + i] * a[i];
        out[j] = l < L - 1 ? Math.tanh(s) : s;
      }
    }
    return A[L];
  }

  // Accumulate gradients for dLoss/dOutput = gOut (call right after forward on the same input).
  backward(gOut) {
    const A = this.acts, D = this.deltas;
    const L = this.W.length;
    D[L].set(gOut);
    for (let l = L - 1; l >= 0; l--) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1];
      const w = this.W[l], gw = this.gW[l], gb = this.gb[l], a = A[l], d = D[l + 1], dPrev = D[l];
      if (l > 0) dPrev.fill(0);
      for (let j = 0; j < nOut; j++) {
        const dj = d[j];
        if (dj === 0) continue;
        gb[j] += dj;
        const row = j * nIn;
        for (let i = 0; i < nIn; i++) {
          gw[row + i] += dj * a[i];
          if (l > 0) dPrev[i] += dj * w[row + i];
        }
      }
      if (l > 0) for (let i = 0; i < nIn; i++) dPrev[i] *= 1 - a[i] * a[i]; // tanh'
    }
  }

  zeroGrad() {
    this.gW.forEach((g) => g.fill(0));
    this.gb.forEach((g) => g.fill(0));
  }

  gradNormSq() {
    let s = 0;
    for (const g of [...this.gW, ...this.gb]) for (let i = 0; i < g.length; i++) s += g[i] * g[i];
    return s;
  }

  scaleGrad(k) {
    for (const g of [...this.gW, ...this.gb]) for (let i = 0; i < g.length; i++) g[i] *= k;
  }

  adamStep(lr, b1 = 0.9, b2 = 0.999, eps = 1e-8) {
    this.t++;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    const upd = (p, g, m, v) => {
      for (let i = 0; i < p.length; i++) {
        m[i] = b1 * m[i] + (1 - b1) * g[i];
        v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
        p[i] -= (lr * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + eps);
      }
    };
    for (let l = 0; l < this.W.length; l++) {
      upd(this.W[l], this.gW[l], this.mW[l], this.vW[l]);
      upd(this.b[l], this.gb[l], this.mb[l], this.vb[l]);
    }
  }

  toJSON() {
    return { sizes: this.sizes, W: this.W.map((w) => Array.from(w)), b: this.b.map((b) => Array.from(b)) };
  }

  load(json) {
    json.W.forEach((w, l) => this.W[l].set(w));
    json.b.forEach((b, l) => this.b[l].set(b));
  }
}
