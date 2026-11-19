// Solmar Bay — the wanted system and the Solmar Bay Police. Crimes add heat;
// heat decays when Rico lays low. Police cruisers spawn, chase and ram; at
// three stars and above, officers on foot join the hunt and can bust Rico.
import * as THREE from 'three';
import { Car } from './vehicles.js';
import { ROAD_COORDS } from './city.js';
import { angleDiff, clamp, dist2D, makeRng, randRange } from './util.js';

export class Wanted {
  constructor() {
    this.stars = 0;
    this.heat = 0;
    this.quietTime = 0;
  }
  addCrime(amount) {
    this.heat = Math.min(100, this.heat + amount);
    this.quietTime = 0;
    this.stars = this.heat <= 0 ? 0 : Math.min(5, 1 + Math.floor(this.heat / 25));
  }
  clear() { this.stars = 0; this.heat = 0; this.quietTime = 0; }
  update(dt) {
    this.quietTime += dt;
    if (this.quietTime > 20 && this.heat > 0) {
      this.heat = Math.max(0, this.heat - 7 * dt);
      this.stars = this.heat <= 0 ? 0 : Math.min(5, 1 + Math.floor(this.heat / 25));
    }
  }
}

function makeCopModel() {
  const g = new THREE.Group();
  const navy = new THREE.MeshLambertMaterial({ color: 0x1d3a5f });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc98a5e });
  const dark = new THREE.MeshLambertMaterial({ color: 0x14181c });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.68, 0.36), navy);
  torso.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.38), skin);
  head.position.y = 1.7;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.42), dark);
  cap.position.y = 1.92;
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xffd94d }));
  badge.position.set(-0.18, 1.28, 0.19);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.68, 0.24), dark);
  legL.geometry.translate(0, -0.34, 0);
  legL.position.set(-0.15, 0.7, 0);
  const legR = new THREE.Mesh(legL.geometry, dark);
  legR.position.set(0.15, 0.7, 0);
  for (const m of [torso, head, cap, badge, legL, legR]) { m.castShadow = true; g.add(m); }
  return { group: g, legL, legR };
}

export class Police {
  constructor(scene, colliders) {
    this.scene = scene;
    this.colliders = colliders;
    this.rng = makeRng(4242);
    this.cars = [];
    this.cops = [];
    this.onBusted = null;
    this.onRam = null;
    this.bustTimer = 0;
  }
  roadPointNear(x, z, minD, maxD) {
    for (let tries = 0; tries < 12; tries++) {
      const c = ROAD_COORDS[Math.floor(this.rng() * ROAD_COORDS.length)];
      const t = randRange(this.rng, -190, 190);
      const p = this.rng() < 0.5 ? { x: t, z: c } : { x: c, z: t };
      const d = dist2D(x, z, p.x, p.z);
      if (d >= minD && d <= maxD) return p;
    }
    return { x: x + 60, z };
  }
  spawnCar(x, z) {
    const p = this.roadPointNear(x, z, 55, 110);
    const car = new Car(this.scene, 'police', p.x, p.z, 0, 0xf0f0f0);
    car.ai = { stuckTimer: 0, lastX: p.x, lastZ: p.z };
    this.cars.push(car);
    return car;
  }
  spawnCop(x, z) {
    const p = this.roadPointNear(x, z, 25, 60);
    const m = makeCopModel();
    m.group.position.set(p.x, 0, p.z);
    this.scene.add(m.group);
    const cop = { ...m, x: p.x, z: p.z, angle: 0, phase: 0 };
    this.cops.push(cop);
    return cop;
  }
  clear() {
    for (const c of this.cars) c.remove(this.scene);
    for (const c of this.cops) this.scene.remove(c.group);
    this.cars = [];
    this.cops = [];
    this.bustTimer = 0;
  }
  update(dt, player, playerCar, wantedStars) {
    const px = playerCar ? playerCar.x : player.x;
    const pz = playerCar ? playerCar.z : player.z;
    // desired counts
    const wantCars = wantedStars === 0 ? 0 : Math.min(4, 1 + Math.floor(wantedStars / 2));
    const wantCops = wantedStars >= 3 ? Math.min(2, wantedStars - 2) : 0;
    while (this.cars.length < wantCars) this.spawnCar(px, pz);
    while (this.cars.length > wantCars) this.cars.pop().remove(this.scene);
    while (this.cops.length < wantCops) this.spawnCop(px, pz);
    while (this.cops.length > wantCops) this.scene.remove(this.cops.pop().group);
    // police cars chase
    for (const car of this.cars) {
      const want = Math.atan2(px - car.x, pz - car.z);
      const diff = angleDiff(car.angle, want);
      const d = dist2D(car.x, car.z, px, pz);
      const throttle = d < 4 ? 0.25 : 0.85;
      const prevX = car.x, prevZ = car.z;
      car.update(dt, {
        throttle,
        steer: clamp(diff * 2.0, -1, 1),
        brake: d < 3,
        handbrake: false,
      }, this.colliders);
      // stuck? teleport to a road near the player
      const moved = dist2D(prevX, prevZ, car.x, car.z);
      if (moved < 0.4 && Math.abs(car.speed) < 2) {
        car.ai.stuckTimer += dt;
        if (car.ai.stuckTimer > 4) {
          const p = this.roadPointNear(px, pz, 45, 80);
          car.x = p.x; car.z = p.z;
          car.ai.stuckTimer = 0;
        }
      } else car.ai.stuckTimer = 0;
      // ram the player's car
      if (playerCar && d < 3.4) {
        const f = car.forward();
        playerCar.x += f.x * 1.6 * dt * 10;
        playerCar.z += f.z * 1.6 * dt * 10;
        playerCar.speed *= 0.92;
        if (this.onRam) this.onRam();
      }
    }
    // foot cops run at Rico
    let nearCop = false;
    for (const cop of this.cops) {
      const d = dist2D(cop.x, cop.z, player.x, player.z);
      if (playerCar) continue; // cops only chase on foot
      const want = Math.atan2(player.x - cop.x, player.z - cop.z);
      cop.angle = want;
      cop.x += Math.sin(want) * 6.5 * dt;
      cop.z += Math.cos(want) * 6.5 * dt;
      cop.phase += dt * 10;
      const swing = Math.sin(cop.phase) * 0.7;
      cop.legL.rotation.x = swing;
      cop.legR.rotation.x = -swing;
      cop.group.position.set(cop.x, 0, cop.z);
      cop.group.rotation.y = cop.angle;
      if (d < 1.8) nearCop = true;
    }
    if (nearCop && !playerCar) {
      this.bustTimer += dt;
      if (this.bustTimer > 2.2 && this.onBusted) {
        this.bustTimer = 0;
        this.onBusted();
      }
    } else this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
  }
}
