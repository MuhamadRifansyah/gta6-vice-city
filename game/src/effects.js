// Solmar Bay — particles and screen feedback. A small pool of glowing boxes
// reused for collision sparks, gun impacts and pickups, plus a decaying camera
// shake value the main loop reads every frame.
import * as THREE from 'three';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.shakeAmount = 0;
    const geo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.visible = false;
      scene.add(m);
      this.pool.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1 });
    }
  }
  burst(x, y, z, color, count, speed, up) {
    let spawned = 0;
    for (const p of this.pool) {
      if (spawned >= count) break;
      if (p.life > 0) continue;
      p.life = p.maxLife = 0.5 + Math.random() * 0.4;
      p.mesh.visible = true;
      p.mesh.material.color.setHex(color);
      p.mesh.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * speed;
      p.vx = Math.cos(a) * r;
      p.vz = Math.sin(a) * r;
      p.vy = (up || 3) * Math.random() + 1;
      p.mesh.scale.setScalar(1);
      spawned++;
    }
  }
  sparks(x, z) { this.burst(x, 0.8, z, 0xffc93c, 10, 5, 4); }
  blood(x, y, z) { this.burst(x, y, z, 0xc02020, 8, 3, 2); }
  pickupSparkle(x, z) { this.burst(x, 0.8, z, 0x2fd67a, 8, 3, 4); }
  shake(amount) { this.shakeAmount = Math.min(1, this.shakeAmount + amount); }
  update(dt) {
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.8);
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vy -= 12 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.1) { p.mesh.position.y = 0.1; p.vy = Math.abs(p.vy) * 0.4; }
      p.mesh.scale.setScalar(Math.max(0.1, p.life / p.maxLife));
    }
  }
  // Random offset for the camera this frame (decays with shakeAmount).
  offset() {
    const s = this.shakeAmount * 0.35;
    return {
      x: (Math.random() - 0.5) * s,
      y: (Math.random() - 0.5) * s,
      z: (Math.random() - 0.5) * s,
    };
  }
}
