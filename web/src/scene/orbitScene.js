// The Earth–Moon view: bodies, the spacecraft and station, trails, predicted paths and burn markers.
// Scale: 1 scene unit = 1,000 km. Physics x–y plane (the Moon's orbit) maps to the scene's x–z plane.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { R_EARTH, R_MOON, MOON_ORBIT, MOON_SOI } from '../physics/constants.js';
import { makeEarth, makeMoon, makeStars, makeMarker } from './bodies.js';

export const KM = 1 / 1000;
export const toScene = (p, out = new THREE.Vector3()) => out.set(p[0] * KM, p[2] * KM, -p[1] * KM);

function circle(radius, color, opacity, dashed = false, segments = 256) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, -Math.sin(a) * radius));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: radius * 0.03, gapSize: radius * 0.02 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(g, m);
  if (dashed) line.computeLineDistances();
  return line;
}

// A thick polyline (screen-space width) whose points change over time.
class PathLine {
  constructor(color, opacity = 1, width = 2) {
    this.material = new LineMaterial({ color, linewidth: width, transparent: true, opacity, worldUnits: false });
    this.line = new Line2(new LineGeometry(), this.material);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.count = -1;
  }
  set(points, force = false) {
    if (!force && points.length === this.count && points[0] === this.first) return;
    this.count = points.length;
    this.first = points[0];
    this.line.visible = points.length > 1;
    if (points.length < 2) return;
    const arr = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      arr[i * 3] = p[0] * KM; arr[i * 3 + 1] = p[2] * KM; arr[i * 3 + 2] = -p[1] * KM;
    }
    this.line.geometry.dispose();
    this.line.geometry = new LineGeometry();
    this.line.geometry.setPositions(arr);
  }
  resize(w, h) {
    this.material.resolution.set(w, h);
  }
}

export class OrbitScene {
  constructor(renderer, labelLayer) {
    this.renderer = renderer;
    this.labelLayer = labelLayer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.0005, 20000);
    this.camera.position.set(0, 40, 60);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.002;
    this.controls.maxDistance = 3000;
    this.focus = 'earth';
    this.focusPos = new THREE.Vector3();

    const sunDir = new THREE.Vector3(1, 0.25, 0.6).normalize();
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.copy(sunDir.multiplyScalar(1000));
    this.scene.add(sun, new THREE.AmbientLight(0x334466, 0.35));
    this.scene.add(makeStars(5000, 9000));

    this.earth = makeEarth(R_EARTH * KM);
    this.earth.rotation.z = (23.4 * Math.PI) / 180;
    this.scene.add(this.earth);
    this.moon = makeMoon(R_MOON * KM);
    this.scene.add(this.moon);
    this.moonOrbit = circle(MOON_ORBIT * KM, 0x8899aa, 0.25);
    this.scene.add(this.moonOrbit);
    this.soi = circle(MOON_SOI * KM, 0x9fa8ff, 0.35, true, 128);
    this.scene.add(this.soi);
    this.grid = new THREE.PolarGridHelper(420, 12, 8, 128, 0x334455, 0x223344);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.35;
    this.scene.add(this.grid);

    this.trail = new PathLine(0xffb347, 0.95, 2.5);
    this.prediction = new PathLine(0x6fd3ff, 0.8, 1.8);
    this.scene.add(this.trail.line, this.prediction.line);
    this.targetRing = null;

    this.craft = makeMarker('#ffb347');
    this.station = makeMarker('#7dff9a');
    this.station.visible = false;
    this.scene.add(this.craft, this.station);
    this.burnMarkers = [];

    this.labels = {};
    for (const [key, text] of [['earth', 'Earth'], ['moon', 'Moon'], ['craft', 'Spacecraft'], ['station', 'Station']]) {
      const el = document.createElement('div');
      el.className = `label label-${key}`;
      el.textContent = text;
      labelLayer.append(el);
      this.labels[key] = el;
    }
    this.burnLabels = [];
  }

  setOptions({ showSOI, showGrid, showLabels }) {
    this.soi.visible = showSOI;
    this.grid.visible = showGrid;
    this.showLabels = showLabels;
  }

  setTargetRing(radiusKm, color = 0x9dff9d) {
    if (this.targetRing) this.scene.remove(this.targetRing);
    this.targetRing = radiusKm ? circle(radiusKm * KM, color, 0.45, true) : null;
    if (this.targetRing) this.scene.add(this.targetRing);
  }

  setBurns(burns) {
    for (const m of this.burnMarkers) this.scene.remove(m);
    for (const l of this.burnLabels) l.remove();
    this.burnMarkers = burns.map((b) => {
      const m = makeMarker('#ff5d7a', 0.014);
      m.userData.burn = b;
      this.scene.add(m);
      return m;
    });
    this.burnLabels = burns.map((b) => {
      const el = document.createElement('div');
      el.className = 'label label-burn';
      el.textContent = b.label;
      this.labelLayer.append(el);
      return el;
    });
  }

  // Burn positions come from the predicted path: find where it is at each burn time.
  placeBurns(burnPositions) {
    this.burnMarkers.forEach((m, i) => {
      const p = burnPositions[i];
      m.visible = Boolean(p) && !m.userData.burn.done;
      if (p) toScene(p, m.position);
    });
  }

  setFocus(which, flight) {
    this.focus = which;
    const target = this.focusTarget(flight);
    const offset = this.camera.position.clone().sub(this.controls.target);
    const want = { earth: 60, moon: 25, craft: 1.5 }[which] ?? 60;
    offset.setLength(want);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
    this.focusPos.copy(target);
  }

  // Look down on the Earth–Moon system, centred between Earth and the Moon's position at a key moment.
  frameEarthMoon(moonPos = [MOON_ORBIT, 0, 0]) {
    this.focus = 'earth';
    const m = toScene(moonPos);
    const mid = m.clone().multiplyScalar(0.5);
    this.controls.target.copy(mid);
    // above the midpoint, pulled back toward Earth's side for a little perspective
    const half = m.length() * 0.62; // half the span to fit, with margin
    const fit = half / Math.tan((this.camera.fov * Math.PI) / 360) / Math.min(1, this.camera.aspect);
    this.camera.position.copy(mid).add(m.clone().setLength(-fit * 0.35)).add(new THREE.Vector3(0, fit, 0));
    this.focusPos.set(0, 0, 0);
  }

  focusTarget(flight) {
    if (this.focus === 'moon') return this.moon.position.clone();
    if (this.focus === 'craft' && flight) return toScene(flight.craft);
    return new THREE.Vector3(); // Earth (fixed): the camera is free to sit anywhere
  }

  update(flight, moonState, t) {
    toScene(moonState.r, this.moon.position);
    this.moon.rotation.y = moonState.angle; // tidally locked: same face to Earth
    this.soi.position.copy(this.moon.position);
    this.earth.userData.earth.rotation.y = (t / 86164) * Math.PI * 2;
    this.earth.userData.clouds.rotation.y = (t / 86164) * Math.PI * 2 * 1.04;
    if (flight) {
      toScene(flight.craft, this.craft.position);
      this.craft.visible = true;
      this.trail.set(flight.trail);
      this.prediction.set(flight.prediction);
      if (flight.station) {
        this.station.visible = true;
        toScene(flight.station, this.station.position);
      } else this.station.visible = false;
    } else {
      this.craft.visible = false;
      this.station.visible = false;
    }
    // keep the camera following the focus body
    const target = this.focusTarget(flight);
    const delta = target.clone().sub(this.focusPos);
    this.camera.position.add(delta);
    this.controls.target.add(delta);
    this.focusPos.copy(target);
    this.controls.update();
  }

  render(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.trail.resize(width, height);
    this.prediction.resize(width, height);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels(width, height);
  }

  updateLabels(width, height) {
    const place = (el, obj, visible = true) => {
      if (!this.showLabels || !visible) { el.style.display = 'none'; return; }
      const v = obj.getWorldPosition(new THREE.Vector3()).project(this.camera);
      if (v.z > 1 || v.z < -1) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.style.transform = `translate(${((v.x + 1) / 2) * width + 10}px, ${((1 - v.y) / 2) * height - 8}px)`;
    };
    place(this.labels.earth, this.earth);
    place(this.labels.moon, this.moon);
    place(this.labels.craft, this.craft, this.craft.visible);
    place(this.labels.station, this.station, this.station.visible);
    this.burnLabels.forEach((el, i) => place(el, this.burnMarkers[i], this.burnMarkers[i].visible));
  }

  hideLabels() {
    for (const el of [...Object.values(this.labels), ...this.burnLabels]) el.style.display = 'none';
  }
}
