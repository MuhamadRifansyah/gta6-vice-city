// Solmar Bay — vehicles. Builds the low-poly car models (sedan, taxi, sports car,
// van, police cruiser) from boxes and cylinders, and the arcade driving physics
// every car in the city shares: throttle, steering, handbrake, building collision.
import * as THREE from 'three';
import { clamp, collideCircleBox, lerp } from './util.js';

export const CAR_TYPES = {
  sedan: { name: 'Marlin Sedan', maxSpeed: 30, accel: 15, color: 0x4a7fb5 },
  taxi: { name: 'Bay Taxi', maxSpeed: 29, accel: 14, color: 0xf2c200 },
  sports: { name: 'Comet GT', maxSpeed: 42, accel: 20, color: 0xd93a2b },
  van: { name: 'Hauler Van', maxSpeed: 24, accel: 11, color: 0x8a8f96 },
  police: { name: 'SBPD Cruiser', maxSpeed: 38, accel: 18, color: 0xf0f0f0 },
};
const CAR_COLORS = [0x4a7fb5, 0xd93a2b, 0x3fae6a, 0xe8e8e8, 0x222831, 0xc96a1e, 0x7a4a9e, 0x2b8a8a];

const glassMat = new THREE.MeshLambertMaterial({ color: 0x18242e });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
const hubMat = new THREE.MeshLambertMaterial({ color: 0xbbbbbb });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
const blackMat = new THREE.MeshLambertMaterial({ color: 0x111418 });

export function makeCarModel(type, colorHex) {
  const spec = CAR_TYPES[type] || CAR_TYPES.sedan;
  const color = colorHex !== undefined ? colorHex : spec.color;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const low = type === 'sports';
  const bodyH = low ? 0.42 : 0.55;
  const bodyY = low ? 0.5 : 0.62;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, bodyH, 4.3), bodyMat);
  body.position.y = bodyY;
  body.castShadow = true;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, type === 'van' ? 2.6 : 2.0), glassMat);
  cabin.position.set(0, bodyY + bodyH / 2 + 0.24, type === 'van' ? 0.3 : -0.25);
  cabin.castShadow = true;
  group.add(cabin);
  if (type === 'sports') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.35), blackMat);
    spoiler.position.set(0, 1.0, -2.0);
    group.add(spoiler);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 0.3), blackMat);
    lip.position.set(0, 0.32, 2.2);
    group.add(lip);
  }
  if (type === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xffe14d }));
    sign.position.set(0, 1.45, -0.25);
    group.add(sign);
  }
  if (type === 'police') {
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 1.2), blackMat);
    hood.position.set(0, bodyY + bodyH / 2 + 0.03, 1.5);
    group.add(hood);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.3), blackMat);
    bar.position.set(0, 1.42, -0.25);
    group.add(bar);
  }
  // wheels
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  for (const [wx, wz] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]]) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.38, wz);
    const tyre = new THREE.Mesh(wheelGeo, tyreMat);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.32, 8), hubMat);
    hub.rotation.z = Math.PI / 2;
    pivot.add(tyre, hub);
    group.add(pivot);
    wheels.push({ pivot, front: wz > 0 });
  }
  // headlights / taillights (front is +z in model space)
  for (const hx of [-0.65, 0.65]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), headMat);
    h.position.set(hx, bodyY, 2.16);
    group.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), tailMat);
    t.position.set(hx, bodyY + 0.08, -2.16);
    group.add(t);
  }
  // police light bar lenses, for the flashing effect
  let redLens = null, blueLens = null;
  if (type === 'police') {
    redLens = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.32),
      new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    redLens.position.set(-0.32, 1.52, -0.25);
    blueLens = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.32),
      new THREE.MeshBasicMaterial({ color: 0x2040ff }));
    blueLens.position.set(0.32, 1.52, -0.25);
    group.add(redLens, blueLens);
  }
  return { group, wheels, redLens, blueLens, type };
}

export function randomCarColor(rng) {
  return CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];
}

// One drivable car: arcade physics, building collision, visual wheel steer/spin.
export class Car {
  constructor(scene, type, x, z, angle, colorHex) {
    this.type = type;
    this.spec = CAR_TYPES[type] || CAR_TYPES.sedan;
    this.model = makeCarModel(type, colorHex);
    this.group = this.model.group;
    this.x = x; this.z = z; this.angle = angle;
    this.speed = 0;
    this.steer = 0;
    this.crashed = false; // set for one frame when a hard hit lands
    this.flash = 0; // police light phase
    this.group.position.set(x, 0, z);
    this.group.rotation.y = angle;
    scene.add(this.group);
  }
  forward() { return { x: Math.sin(this.angle), z: Math.cos(this.angle) }; }
  // ctrl: { throttle -1..1, steer -1..1, brake bool, handbrake bool }
  update(dt, ctrl, colliders) {
    const max = this.spec.maxSpeed;
    const targetSteer = clamp(ctrl.steer, -1, 1) * 0.55 * clamp(Math.abs(this.speed) / 6, 0.25, 1);
    this.steer = lerp(this.steer, targetSteer, Math.min(1, dt * 8));
    if (ctrl.throttle > 0) this.speed += this.spec.accel * ctrl.throttle * dt;
    else if (ctrl.throttle < 0) this.speed += this.spec.accel * 0.7 * ctrl.throttle * dt;
    if (ctrl.brake) {
      this.speed -= Math.sign(this.speed) * 26 * dt;
      if (Math.abs(this.speed) < 0.5) this.speed = 0;
    }
    if (ctrl.handbrake) this.speed -= Math.sign(this.speed) * 18 * dt;
    // drag + rolling resistance
    this.speed -= this.speed * (ctrl.handbrake ? 1.6 : 0.55) * dt;
    this.speed = clamp(this.speed, -max * 0.45, max);
    if (Math.abs(this.speed) < 0.05 && !ctrl.throttle) this.speed = 0;
    this.angle += (this.steer * (this.speed / 3.2)) * dt * (this.speed < 0 ? -1 : 1);
    const f = this.forward();
    this.x += f.x * this.speed * dt;
    this.z += f.z * this.speed * dt;
    // world bounds
    this.x = clamp(this.x, -208, 208);
    this.z = clamp(this.z, -258, 236);
    // building collision: two circles, front and rear
    this.crashed = false;
    for (const [ox, oz] of [[1.5, 0], [-1.5, 0]]) {
      const cx = this.x + f.x * ox, cz = this.z + f.z * oz;
      for (const box of colliders) {
        const hit = collideCircleBox(cx, cz, 1.25, box);
        if (hit) {
          this.x += hit.nx * hit.depth;
          this.z += hit.nz * hit.depth;
          const into = -(f.x * hit.nx + f.z * hit.nz);
          if (into > 0.25 && Math.abs(this.speed) > 6) { this.crashed = true; }
          this.speed *= 0.55;
        }
      }
    }
    // visuals
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.angle;
    for (const w of this.model.wheels) {
      if (w.front) w.pivot.rotation.y = this.steer * 0.9;
      w.pivot.children[0].rotation.x += this.speed * dt * 2.2;
    }
    // police light flash
    if (this.type === 'police' && this.model.redLens) {
      this.flash += dt * 7;
      const on = Math.floor(this.flash) % 2 === 0;
      this.model.redLens.material.color.setHex(on ? 0xff2020 : 0x550000);
      this.model.blueLens.material.color.setHex(on ? 0x101040 : 0x2040ff);
    }
  }
  remove(scene) { scene.remove(this.group); }
}
