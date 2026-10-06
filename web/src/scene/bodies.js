// Procedural Earth, Moon, atmosphere glow and starfield — no texture files needed.

import * as THREE from 'three';

/* global __TEXTURE_WORKER_SOURCE__ */

// Textures are painted in a worker; meshes start with a plain colour and the texture
// fades in when ready (a few hundred ms), so the first frame is never blocked.
// One short-lived worker per texture, so the three paint in parallel.
function requestTexture(name) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(new Blob([__TEXTURE_WORKER_SOURCE__], { type: 'text/javascript' }));
      const worker = new Worker(url);
      worker.onmessage = (e) => { resolve(e.data); worker.terminate(); URL.revokeObjectURL(url); };
      worker.postMessage({ name });
    } catch (err) {
      console.warn('Texture worker unavailable, painting on the main thread', err);
      import('./textures.js').then(({ PAINTERS }) => setTimeout(() => resolve(PAINTERS[name]()), 0));
    }
  }).then(({ w, h, data }) => {
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  });
}

export function makeEarth(radius) {
  const group = new THREE.Group();
  const earthMat = new THREE.MeshStandardMaterial({ color: 0x1f4f8f, roughness: 0.85, metalness: 0 });
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), earthMat);
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.006, 96, 64), cloudMat);
  requestTexture('earth').then((t) => { earthMat.map = t; earthMat.color.set(0xffffff); earthMat.needsUpdate = true; });
  requestTexture('clouds').then((t) => { cloudMat.alphaMap = t; cloudMat.opacity = 0.85; cloudMat.needsUpdate = true; });
  group.add(earth, clouds, makeAtmosphere(radius * 1.035, 0x5aa8ff));
  group.userData = { earth, clouds };
  return group;
}

export function makeMoon(radius) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 1 });
  requestTexture('moon').then((t) => { mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true; });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), mat);
}

export function makeAtmosphere(radius, color) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { glow: { value: new THREE.Color(color) } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 glow; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(glow, f * 0.9); }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), mat);
}

export function makeStars(count, radius) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1, th = rnd() * 2 * Math.PI, q = Math.sqrt(1 - u * u);
    pos.set([radius * q * Math.cos(th), radius * u, radius * q * Math.sin(th)], i * 3);
    const b = 0.5 + 0.5 * rnd(), warm = rnd();
    col.set([b, b * (0.9 + 0.1 * warm), b * (0.8 + 0.2 * (1 - warm))], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
}

// A round, constant-screen-size marker.
export function makeMarker(color, size = 0.018) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(32, 32, 20, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(32, 32, 26, 0, Math.PI * 2); ctx.stroke();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), sizeAttenuation: false, depthTest: false, transparent: true }));
  sprite.scale.set(size, size, 1);
  sprite.renderOrder = 10;
  return sprite;
}
