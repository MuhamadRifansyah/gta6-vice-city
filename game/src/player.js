// Solmar Bay — Rico Vega on foot. A low-poly character (torso, head, swinging
// arms and legs) with walk / sprint / jump, camera-relative movement, and
// building collision. When Rico is in a car the mesh hides.
import * as THREE from 'three';
import { clamp, collideCircleBox, lerpAngle } from './util.js';

export class Player {
  constructor(scene) {
    this.x = 0; this.z = 20;
    this.angle = 0; // facing
    this.vy = 0; this.y = 0;
    this.speed = 0;
    this.walkPhase = 0;
    this.inCar = false;
    this.group = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0xc98a5e });
    const shirt = new THREE.MeshLambertMaterial({ color: 0x0e7c7b });
    const pants = new THREE.MeshLambertMaterial({ color: 0x22303c });
    const hair = new THREE.MeshLambertMaterial({ color: 0x1a1210 });
    const shoe = new THREE.MeshLambertMaterial({ color: 0xf0ead8 });
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), shirt);
    this.torso.position.y = 1.12;
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.4), skin);
    this.head.position.y = 1.72;
    const hairM = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.42), hair);
    hairM.position.y = 1.95;
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.26), pants);
    this.legL.geometry.translate(0, -0.36, 0); // pivot at the hip
    this.legL.position.set(-0.16, 0.72, 0);
    this.legR = new THREE.Mesh(this.legL.geometry, pants);
    this.legR.position.set(0.16, 0.72, 0);
    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), shirt);
    this.armL.geometry.translate(0, -0.31, 0); // pivot at the shoulder
    this.armL.position.set(-0.42, 1.42, 0);
    this.armR = new THREE.Mesh(this.armL.geometry, shirt);
    this.armR.position.set(0.42, 1.42, 0);
    const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.4), shoe);
    shoeL.position.set(0, -0.66, 0.06);
    const shoeR = shoeL.clone();
    this.legL.add(shoeL);
    this.legR.add(shoeR);
    for (const m of [this.torso, this.head, hairM, this.legL, this.legR, this.armL, this.armR]) {
      m.castShadow = true;
      this.group.add(m);
    }
    this.group.position.set(this.x, 0, this.z);
    scene.add(this.group);
  }
  setPosition(x, z, angle) {
    this.x = x; this.z = z; this.angle = angle;
    this.group.position.set(x, 0, z);
    this.group.rotation.y = angle;
  }
  // move: {x, z} wish direction in world space (already camera-relative), sprint bool, jump bool
  update(dt, move, sprint, jump, colliders) {
    const targetSpeed = sprint ? 9.5 : 5.2;
    const mx = move.x, mz = move.z;
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      const nx = mx / len, nz = mz / len;
      this.speed = Math.min(targetSpeed, this.speed + 30 * dt);
      const want = Math.atan2(nx, nz);
      this.angle = lerpAngle(this.angle, want, Math.min(1, dt * 12));
      this.x += nx * this.speed * dt;
      this.z += nz * this.speed * dt;
      this.walkPhase += dt * this.speed * 1.6;
    } else {
      this.speed = Math.max(0, this.speed - 30 * dt);
    }
    // jump / gravity
    if (jump && this.y === 0) this.vy = 7.5;
    this.vy -= 22 * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) { this.y = 0; this.vy = 0; }
    // building collision
    for (const box of colliders) {
      const hit = collideCircleBox(this.x, this.z, 0.55, box);
      if (hit) { this.x += hit.nx * hit.depth; this.z += hit.nz * hit.depth; }
    }
    this.x = clamp(this.x, -208, 208);
    this.z = clamp(this.z, -258, 236);
    // animate limbs
    const swing = this.speed > 0.3 ? Math.sin(this.walkPhase) * 0.7 : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;
    this.armR.rotation.x = swing * 0.8;
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.angle;
    this.group.visible = !this.inCar;
  }
}
