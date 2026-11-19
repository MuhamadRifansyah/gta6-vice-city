// Solmar Bay — combat. Rico's pistol (raycast shooting from the camera,
// magazine + reload), Viper gang enemies with health and return fire, and the
// cash pickups they drop. Tracers are short-lived lines; hits feed the effects
// system through callbacks the main loop wires up.
import * as THREE from 'three';
import { clamp, dist2D, makeRng, randRange } from './util.js';

function makeEnemyModel() {
  const g = new THREE.Group();
  const purple = new THREE.MeshLambertMaterial({ color: 0x6a3fa0 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xb07a4e });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c1c22 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.68, 0.36), purple);
  torso.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.38), skin);
  head.position.y = 1.7;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.4),
    new THREE.MeshBasicMaterial({ color: 0xd8c832 }));
  band.position.y = 1.86;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.5), dark);
  gun.position.set(0.3, 1.25, 0.3);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.68, 0.24), dark);
  legL.geometry.translate(0, -0.34, 0);
  legL.position.set(-0.15, 0.7, 0);
  const legR = new THREE.Mesh(legL.geometry, dark);
  legR.position.set(0.15, 0.7, 0);
  for (const m of [torso, head, band, gun, legL, legR]) { m.castShadow = true; g.add(m); }
  return { group: g, torso, legL, legR };
}

export class Combat {
  constructor(scene) {
    this.scene = scene;
    this.rng = makeRng(99);
    this.enemies = [];
    this.pickups = [];
    this.tracers = [];
    this.raycaster = new THREE.Raycaster();
    this.onPlayerHit = null; // (damage, fromPos)
    this.onEnemyShot = null; // (fromPos) for sound
    this.onEnemyKilled = null; // (enemy)
  }
  spawnEnemy(x, z, health) {
    const m = makeEnemyModel();
    m.group.position.set(x, 0, z);
    this.scene.add(m.group);
    const enemy = {
      ...m, x, z, angle: 0, health: health || 50, maxHealth: health || 50,
      shootTimer: randRange(this.rng, 0.8, 2.2), phase: 0, dead: false, deadTimer: 0,
    };
    m.torso.userData.enemy = enemy;
    this.enemies.push(enemy);
    return enemy;
  }
  clearEnemies() {
    for (const e of this.enemies) this.scene.remove(e.group);
    this.enemies = [];
  }
  spawnPickup(x, z, amount) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.32),
      new THREE.MeshLambertMaterial({ color: 0x2fd67a, emissive: 0x0a5a28 }));
    mesh.position.set(x, 0.5, z);
    this.scene.add(mesh);
    this.pickups.push({ mesh, x, z, amount, spin: 0 });
  }
  clearPickups() {
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.pickups = [];
  }
  // Fire the pistol from the camera. Returns the hit point (or null).
  shoot(camera) {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    this.raycaster.far = 120;
    const targets = [];
    for (const e of this.enemies) if (!e.dead) targets.push(e.torso);
    const hits = this.raycaster.intersectObjects(targets, false);
    let point = null;
    if (hits.length > 0) {
      const hit = hits[0];
      point = hit.point.clone();
      const enemy = hit.object.userData.enemy;
      enemy.health -= 25;
      if (enemy.health <= 0 && !enemy.dead) {
        enemy.dead = true;
        enemy.deadTimer = 1.2;
        enemy.group.rotation.x = -Math.PI / 2;
        enemy.group.position.y = 0.3;
        this.spawnPickup(enemy.x + randRange(this.rng, -1, 1), enemy.z + randRange(this.rng, -1, 1),
          50 + Math.floor(this.rng() * 100));
        if (this.onEnemyKilled) this.onEnemyKilled(enemy);
      }
    } else {
      point = this.raycaster.ray.at(90, new THREE.Vector3());
    }
    // tracer from the camera muzzle to the hit point
    const from = camera.position.clone();
    const geo = new THREE.BufferGeometry().setFromPoints([from, point]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.08 });
    return point;
  }
  update(dt, playerPos, playerInCar) {
    // tracers fade
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.9;
      if (t.life <= 0) { this.scene.remove(t.line); t.line.geometry.dispose(); this.tracers.splice(i, 1); }
    }
    // pickups spin
    for (const p of this.pickups) {
      p.spin += dt * 3;
      p.mesh.rotation.y = p.spin;
      p.mesh.position.y = 0.5 + Math.sin(p.spin * 1.4) * 0.12;
    }
    // enemies: face the player, shoot with inaccuracy, die and fade
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        e.deadTimer -= dt;
        if (e.deadTimer <= 0) {
          this.scene.remove(e.group);
          this.enemies.splice(i, 1);
        }
        continue;
      }
      const d = dist2D(e.x, e.z, playerPos.x, playerPos.z);
      e.angle = Math.atan2(playerPos.x - e.x, playerPos.z - e.z);
      e.group.rotation.y = e.angle;
      e.phase += dt * 6;
      const swing = Math.sin(e.phase) * (d > 12 ? 0.6 : 0.15);
      e.legL.rotation.x = swing;
      e.legR.rotation.x = -swing;
      // shuffle closer when far
      if (d > 10 && d < 40) {
        e.x += Math.sin(e.angle) * 2.2 * dt;
        e.z += Math.cos(e.angle) * 2.2 * dt;
        e.group.position.set(e.x, 0, e.z);
      }
      if (d < 34 && !playerInCar) {
        e.shootTimer -= dt;
        if (e.shootTimer <= 0) {
          e.shootTimer = randRange(this.rng, 1.4, 2.6);
          const hitChance = clamp(0.42 - d * 0.008, 0.1, 0.42);
          if (this.onEnemyShot) this.onEnemyShot({ x: e.x, z: e.z });
          if (this.rng() < hitChance && this.onPlayerHit) this.onPlayerHit(6 + Math.floor(this.rng() * 6), { x: e.x, z: e.z });
        }
      }
    }
  }
  // Collect cash pickups near (x, z). Returns the total collected.
  collect(x, z, radius) {
    let total = 0;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (dist2D(x, z, p.x, p.z) < radius) {
        total += p.amount;
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
    return total;
  }
}
