// Solmar Bay — traffic and pedestrians. AI cars drive the road grid (lane,
// intersections, turns, slowing for the car ahead), pedestrians stroll the
// sidewalks and flee from gunfire and speeding cars. Also owns the parked cars
// Rico can steal.
import * as THREE from 'three';
import { Car, randomCarColor } from './vehicles.js';
import { ROAD_COORDS } from './city.js';
import { angleDiff, clamp, dist2D, makeRng, randRange } from './util.js';

const PED_SHIRTS = [0xd95f4b, 0x4b7fd9, 0x59b06a, 0xe0a83c, 0x9b59b6, 0xe8e8e8, 0x333333, 0x2b8a8a];

function makePedestrianModel(shirtColor) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xc98a5e });
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2a3540 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.62, 0.32), shirt);
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.36), skin);
  head.position.y = 1.58;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), pants);
  legL.geometry.translate(0, -0.31, 0);
  legL.position.set(-0.14, 0.66, 0);
  const legR = new THREE.Mesh(legL.geometry, pants);
  legR.position.set(0.14, 0.66, 0);
  for (const m of [torso, head, legL, legR]) { m.castShadow = true; g.add(m); }
  return { group: g, legL, legR };
}

export class Traffic {
  constructor(scene, colliders, parkingSpots) {
    this.scene = scene;
    this.colliders = colliders;
    this.rng = makeRng(777);
    this.cars = [];
    this.peds = [];
    this.parked = [];
    this.onPedHit = null; // callback(ped) when the player runs one over
    this.onCarBump = null; // callback when the player bumps a traffic car hard
    // moving traffic
    for (let i = 0; i < 14; i++) this.spawnTrafficCar();
    // parked cars on lots and curbs
    for (let i = 0; i < Math.min(6, parkingSpots.length); i++) {
      const s = parkingSpots[i];
      const type = this.rng() < 0.25 ? 'sports' : (this.rng() < 0.5 ? 'sedan' : 'van');
      const car = new Car(scene, type, s.x, s.z, s.angle, randomCarColor(this.rng));
      this.parked.push(car);
    }
    for (let i = 0; i < 26; i++) this.spawnPedestrian();
  }
  randomRoadPoint() {
    const c = ROAD_COORDS[Math.floor(this.rng() * ROAD_COORDS.length)];
    const t = randRange(this.rng, -190, 190);
    return this.rng() < 0.5 ? { x: t, z: c } : { x: c, z: t };
  }
  spawnTrafficCar() {
    const p = this.randomRoadPoint();
    const alongX = Math.abs(p.z - Math.round(p.z / 50) * 50) < 1; // on an x-road?
    const type = this.rng() < 0.15 ? 'taxi' : (this.rng() < 0.2 ? 'sports' : 'sedan');
    const angle = alongX ? (this.rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (this.rng() < 0.5 ? 0 : Math.PI);
    const car = new Car(this.scene, type, p.x, p.z, angle, randomCarColor(this.rng));
    car.ai = { target: this.nextTarget(car), cruise: randRange(this.rng, 9, 14) };
    this.cars.push(car);
    return car;
  }
  // Next intersection along the car's current heading, sometimes turning.
  nextTarget(car) {
    const f = car.forward();
    const aheadX = car.x + f.x * 50, aheadZ = car.z + f.z * 50;
    // snap to nearest road line in the perpendicular axis
    let tx = aheadX, tz = aheadZ;
    if (Math.abs(f.x) > 0.7) { // travelling along x: stay on the z road line
      tz = ROAD_COORDS.reduce((a, b) => Math.abs(b - car.z) < Math.abs(a - car.z) ? b : a);
      tx = clamp(aheadX, -190, 190);
      if (this.rng() < 0.3) { // turn onto the z road at the next intersection
        const nx = ROAD_COORDS.reduce((a, b) => Math.abs(b - tx) < Math.abs(a - tx) ? b : a);
        tx = nx; tz = clamp(car.z + (this.rng() < 0.5 ? 50 : -50), -190, 190);
      }
    } else {
      tx = ROAD_COORDS.reduce((a, b) => Math.abs(b - car.x) < Math.abs(a - car.x) ? b : a);
      tz = clamp(aheadZ, -190, 190);
      if (this.rng() < 0.3) {
        const nz = ROAD_COORDS.reduce((a, b) => Math.abs(b - tz) < Math.abs(a - tz) ? b : a);
        tz = nz; tx = clamp(car.x + (this.rng() < 0.5 ? 50 : -50), -190, 190);
      }
    }
    return { x: tx, z: tz };
  }
  spawnPedestrian() {
    const bx = ROAD_COORDS[Math.floor(this.rng() * ROAD_COORDS.length)];
    const bz = ROAD_COORDS[Math.floor(this.rng() * ROAD_COORDS.length)];
    const x = bx + randRange(this.rng, -20, 20);
    const z = bz + randRange(this.rng, -20, 20);
    const model = makePedestrianModel(PED_SHIRTS[Math.floor(this.rng() * PED_SHIRTS.length)]);
    model.group.position.set(x, 0, z);
    this.scene.add(model.group);
    const ped = {
      ...model, x, z, angle: randRange(this.rng, 0, Math.PI * 2),
      speed: randRange(this.rng, 1.0, 1.9), phase: randRange(this.rng, 0, 6),
      target: { x: x + randRange(this.rng, -30, 30), z: z + randRange(this.rng, -30, 30) },
      state: 'walk', fleeTimer: 0, down: false, downTimer: 0,
    };
    this.peds.push(ped);
    return ped;
  }
  nearestCar(x, z, maxDist) {
    let best = null, bd = maxDist;
    for (const car of [...this.cars, ...this.parked]) {
      const d = dist2D(x, z, car.x, car.z);
      if (d < bd) { bd = d; best = car; }
    }
    return best;
  }
  removeParked(car) {
    const i = this.parked.indexOf(car);
    if (i >= 0) this.parked.splice(i, 1);
    const j = this.cars.indexOf(car);
    if (j >= 0) this.cars.splice(j, 1);
  }
  update(dt, player, playerCar, gunshotAt) {
    // --- AI cars ---
    for (const car of this.cars) {
      const ai = car.ai;
      const d = dist2D(car.x, car.z, ai.target.x, ai.target.z);
      if (d < 7) ai.target = this.nextTarget(car);
      const want = Math.atan2(ai.target.x - car.x, ai.target.z - car.z);
      const diff = angleDiff(car.angle, want);
      // slow for the car ahead (traffic or player)
      let slow = false;
      const f = car.forward();
      for (const other of [...this.cars, ...(playerCar ? [playerCar] : [])]) {
        if (other === car) continue;
        const dx = other.x - car.x, dz = other.z - car.z;
        const ahead = dx * f.x + dz * f.z;
        const side = Math.abs(dx * f.z - dz * f.x);
        if (ahead > 0 && ahead < 11 && side < 2.6) { slow = true; break; }
      }
      const throttle = slow ? 0 : (Math.abs(diff) > 0.9 ? 0.12 : 0.55);
      const prevSpeed = car.speed;
      car.update(dt, { throttle, steer: clamp(diff * 1.6, -1, 1), brake: slow, handbrake: false }, this.colliders);
      if (car.crashed && Math.abs(prevSpeed) > 8 && this.onCarBump) this.onCarBump(car);
    }
    // --- pedestrians ---
    for (const ped of this.peds) {
      if (ped.down) {
        ped.downTimer -= dt;
        if (ped.downTimer <= 0) {
          ped.down = false;
          ped.group.rotation.x = 0;
          ped.group.position.y = 0;
          // respawn elsewhere
          const p = this.randomRoadPoint();
          ped.x = p.x; ped.z = p.z;
          ped.target = { x: p.x + 20, z: p.z + 20 };
        }
        continue;
      }
      // flee from gunfire or a fast car nearby
      let threat = null;
      if (gunshotAt && dist2D(ped.x, ped.z, gunshotAt.x, gunshotAt.z) < 25) threat = gunshotAt;
      if (playerCar && Math.abs(playerCar.speed) > 6 && dist2D(ped.x, ped.z, playerCar.x, playerCar.z) < 9) {
        threat = { x: playerCar.x, z: playerCar.z };
      }
      if (threat) { ped.state = 'flee'; ped.fleeTimer = 3; }
      if (ped.state === 'flee') {
        ped.fleeTimer -= dt;
        const away = Math.atan2(ped.x - (threat ? threat.x : ped.x), ped.z - (threat ? threat.z : ped.z));
        ped.angle = away;
        ped.x += Math.sin(away) * 3.6 * dt;
        ped.z += Math.cos(away) * 3.6 * dt;
        ped.phase += dt * 9;
        if (ped.fleeTimer <= 0) ped.state = 'walk';
      } else {
        const dx = ped.target.x - ped.x, dz = ped.target.z - ped.z;
        const d = Math.hypot(dx, dz);
        if (d < 2) {
          ped.target = { x: ped.x + randRange(this.rng, -40, 40), z: ped.z + randRange(this.rng, -40, 40) };
        } else {
          ped.angle = Math.atan2(dx, dz);
          ped.x += (dx / d) * ped.speed * dt;
          ped.z += (dz / d) * ped.speed * dt;
          ped.phase += dt * ped.speed * 3.2;
        }
      }
      ped.x = clamp(ped.x, -208, 208);
      ped.z = clamp(ped.z, -258, 236);
      const swing = Math.sin(ped.phase) * 0.55;
      ped.legL.rotation.x = swing;
      ped.legR.rotation.x = -swing;
      ped.group.position.set(ped.x, 0, ped.z);
      ped.group.rotation.y = ped.angle;
      // run over by the player's car?
      if (playerCar && Math.abs(playerCar.speed) > 4 && dist2D(ped.x, ped.z, playerCar.x, playerCar.z) < 1.7) {
        ped.down = true;
        ped.downTimer = 6;
        ped.group.rotation.x = -Math.PI / 2;
        ped.group.position.y = 0.3;
        if (this.onPedHit) this.onPedHit(ped);
      }
    }
  }
}
