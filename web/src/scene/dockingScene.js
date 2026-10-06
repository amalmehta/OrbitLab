// Close-up docking view in the station's local frame (metres).
// Physics LVLH: x radial (up, away from Earth), y along-track, z orbit normal.
// Scene: up = radial, -z = along-track (station flies "into the screen"), x = orbit normal.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DOCKING } from '../rl/dockingEnv.js';
import { makeStars, makeAtmosphere } from './bodies.js';

export const lvlhToScene = (p, out = new THREE.Vector3()) => out.set(p[2], p[0], -p[1]);

function metal(color, rough = 0.45, metalness = 0.6) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness });
}

function buildStation() {
  const g = new THREE.Group();
  const hullMat = metal(0xd9dde3, 0.5, 0.35);
  const darkMat = metal(0x5c6470, 0.6, 0.5);
  const goldMat = metal(0xc9a24a, 0.35, 0.8);
  const L = DOCKING.stationBox.y;
  // Modules along -z in scene (= +y along-track in physics), starting behind the docking port at z=0.
  const mod = (len, r, z0, mat = hullMat) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 40), mat);
    m.rotation.x = Math.PI / 2;
    m.position.z = -(z0 + len / 2);
    g.add(m);
    return m;
  };
  mod(1.2, 1.1, 0, darkMat);     // docking adapter
  mod(8, 2.1, 1.2);               // node
  mod(1, 2.4, 9.2, goldMat);      // radiator collar
  mod(10, 2.1, 10.2);             // lab
  mod(L - 20.2, 1.6, 20.2, darkMat);
  // Docking port ring and target
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.12, 16, 48), metal(0xffd166, 0.3, 0.7));
  ring.position.z = 0.02;
  g.add(ring);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0x7dff9a });
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), lightMat);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    l.position.set(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0.05);
    g.add(l);
  }
  // Truss and solar arrays (spanning orbit-normal, i.e. scene x)
  const truss = new THREE.Mesh(new THREE.BoxGeometry(46, 0.6, 0.6), darkMat);
  truss.position.z = -14;
  g.add(truss);
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1d3f8f, roughness: 0.3, metalness: 0.7, emissive: 0x06112a, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) for (const k of [0, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 4.2), panelMat);
    p.position.set(sx * (7 + k * 10), 0, -14);
    g.add(p);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(p.geometry), new THREE.LineBasicMaterial({ color: 0x9fb4d8 }));
    frame.position.copy(p.position);
    g.add(frame);
  }
  // Radiators (radial direction = up)
  const radMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.8, side: THREE.DoubleSide });
  for (const sy of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 6, 3), radMat);
    r.position.set(0, sy * 5.2, -22);
    g.add(r);
  }
  return g;
}

function buildCapsule() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 1.4, 32), metal(0xe8e8ea, 0.4, 0.3));
  body.rotation.x = -Math.PI / 2; // narrow end faces -z (toward the station)
  g.add(body);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.35, 24), metal(0x5c6470));
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.85;
  g.add(nose);
  const service = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.3, 32), metal(0x2b2f36, 0.5, 0.5));
  service.rotation.x = Math.PI / 2;
  service.position.z = 1.35;
  g.add(service);
  // Thruster plumes: one per axis direction.
  const plumeMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const plumes = [];
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const d of dirs) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1, 12), plumeMat);
    cone.geometry.translate(0, -0.5, 0);
    const dir = new THREE.Vector3(...d);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    cone.position.copy(dir.clone().multiplyScalar(0.95));
    cone.userData.dir = dir;
    cone.scale.setScalar(0.001);
    g.add(cone);
    plumes.push(cone);
  }
  g.userData.plumes = plumes;
  return g;
}

export class DockingScene {
  constructor(renderer, labelLayer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 5e7);
    this.camera.position.set(-52, 20, 46);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 8);
    this.controls.maxDistance = 400;

    const sun = new THREE.DirectionalLight(0xffffff, 2.8);
    sun.position.set(40, 60, 30);
    this.scene.add(sun, new THREE.AmbientLight(0x6688aa, 0.5), new THREE.HemisphereLight(0x88aaff, 0x223322, 0.5));
    this.scene.add(makeStars(3000, 4e6));

    // Earth far below (radius 6,371 km, 420 km down).
    const R = 6371e3, h = 420e3;
    const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), new THREE.MeshStandardMaterial({ color: 0x2a5c9a, roughness: 0.9 }));
    earth.position.y = -(R + h);
    const atmo = makeAtmosphere(R * 1.02, 0x5aa8ff);
    atmo.position.copy(earth.position);
    this.scene.add(earth, atmo);

    this.station = buildStation();
    this.scene.add(this.station);
    this.capsule = buildCapsule();
    this.scene.add(this.capsule);

    // Approach corridor
    const corridor = new THREE.Mesh(
      new THREE.ConeGeometry(Math.tan((DOCKING.startConeDeg * Math.PI) / 180) * DOCKING.startMax, DOCKING.startMax, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.03, side: THREE.DoubleSide, depthWrite: false }),
    );
    corridor.rotation.x = Math.PI / 2;
    corridor.position.z = DOCKING.startMax / 2;
    this.scene.add(corridor);

    this.trailGeom = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(3 * 2000);
    this.trailGeom.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Line(this.trailGeom, new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.8 }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    this.trailN = 0;

    // Faded trails from earlier episodes show how the policy changes as it learns.
    this.ghosts = [];
    this.labelLayer = labelLayer;
  }

  startEpisode() {
    if (this.trailN > 1) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.trailPos.slice(0, this.trailN * 3), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.25 }));
      this.scene.add(line);
      this.ghosts.push(line);
      while (this.ghosts.length > 12) {
        const old = this.ghosts.shift();
        this.scene.remove(old);
        old.geometry.dispose();
      }
      this.ghosts.forEach((l, i) => { l.material.opacity = 0.06 + (0.25 * (i + 1)) / this.ghosts.length; });
    }
    this.trailN = 0;
  }

  clearGhosts() {
    for (const l of this.ghosts) { this.scene.remove(l); l.geometry.dispose(); }
    this.ghosts = [];
  }

  update(state, accel) {
    const p = lvlhToScene([state[0], state[1], state[2]]);
    // Capsule nose sits 1 m ahead of its centre; offset so contact happens nose-to-port.
    this.capsule.position.copy(p).add(new THREE.Vector3(0, 0, 1.0));
    if (this.trailN < 2000) {
      this.trailPos.set([p.x, p.y, p.z], this.trailN * 3);
      this.trailN++;
      this.trailGeom.setDrawRange(0, this.trailN);
      this.trailGeom.attributes.position.needsUpdate = true;
    }
    // Thrust → plumes point opposite to the acceleration.
    const a = accel ? lvlhToScene(accel).multiplyScalar(1 / DOCKING.maxAccel) : new THREE.Vector3();
    for (const cone of this.capsule.userData.plumes) {
      const k = Math.max(0, -cone.userData.dir.dot(a));
      cone.scale.set(1, 0.1 + 1.6 * k, 1).multiplyScalar(k > 0.02 ? 1 : 0.001);
    }
  }

  render(width, height) {
    this.controls.update();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
}
