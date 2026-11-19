// Solmar Bay — the story. Five jobs for fixer Mara Quinn, from a first delivery
// to the big score, each a chain of steps (go to, pick up, steal, deliver, fight,
// escape) with a beacon marker, objective text and a cash reward. The manager
// owns the beacon mesh and advances steps; the game object it is given supplies
// the player, the world systems and the UI hooks.
import * as THREE from 'three';
import { Car } from './vehicles.js';
import { dist2D } from './util.js';

const MISSIONS = [
  {
    id: 'first-gear', title: 'MISSION 1 — FIRST GEAR', reward: 400,
    briefing: 'Mara Quinn needs a driver who asks no questions. Pick up the package uptown, deliver it to the docks.',
    steps: [
      { type: 'goto', x: 25, z: -125, radius: 5, text: 'Pick up the package at the uptown corner' },
      { type: 'goto', x: -150, z: 175, radius: 6, text: 'Deliver the package to the docks (south-west)' },
    ],
  },
  {
    id: 'hot-wheels', title: 'MISSION 2 — HOT WHEELS', reward: 600,
    briefing: 'A Comet GT is parked uptown with the keys in it. Take it — and bring it to the garage in one piece.',
    steps: [
      { type: 'steal', x: 100, z: -100, radius: 6, text: 'Steal the Comet GT parked uptown' },
      { type: 'deliver', x: -100, z: 100, radius: 6, text: 'Deliver the Comet GT to the garage' },
    ],
  },
  {
    id: 'getaway', title: 'MISSION 3 — THE GETAWAY', reward: 800,
    briefing: 'The deal went sideways. The SBPD is on its way — get to the safehouse and lose them.',
    steps: [
      { type: 'goto', x: 0, z: -25, radius: 5, text: 'Meet the buyer at the plaza' },
      { type: 'escape', x: 150, z: 150, radius: 6, wanted: 2, text: 'LOSE THE COPS — reach the safehouse' },
    ],
  },
  {
    id: 'turf-war', title: 'MISSION 4 — TURF WAR', reward: 1000,
    briefing: 'The Vipers took Mara\'s warehouse. Clear them out, grab the cash, and report back.',
    steps: [
      { type: 'kill', x: -150, z: -150, radius: 10, count: 4, text: 'Clear the Vipers from the warehouse' },
      { type: 'goto', x: 25, z: 25, radius: 5, text: 'Report back to Mara at the office' },
    ],
  },
  {
    id: 'big-score', title: 'MISSION 5 — THE BIG SCORE', reward: 2000,
    briefing: 'One last job: the armored van at the bank. Drive it to the beach drop, then vanish.',
    steps: [
      { type: 'van', x: 75, z: -75, radius: 6, text: 'Take the armored van at the bank' },
      { type: 'deliver', x: -25, z: 215, radius: 7, text: 'Drive the van to the beach drop' },
      { type: 'escape', x: 175, z: -175, radius: 6, wanted: 3, text: 'LOSE THE COPS — reach the north-east hideout' },
    ],
  },
];

export class MissionManager {
  constructor(game) {
    this.game = game;
    this.index = 0; // next mission to play
    this.active = null; // {def, step}
    this.stepTimer = 0;
    this.killsNeeded = 0;
    this.killsDone = 0;
    this.targetCar = null;
    this.completedAll = false;
    // beacon: a glowing pillar + ground ring at the current objective
    this.beacon = new THREE.Group();
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 40, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
    );
    pillar.position.y = 20;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 3.4, 24),
      new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.1;
    this.beacon.add(pillar, ring);
    this.beacon.visible = false;
    game.scene.add(this.beacon);
    this.pillar = pillar;
    this.ring = ring;
  }
  currentDef() { return MISSIONS[this.index] || null; }
  startNext() {
    const def = this.currentDef();
    if (!def) { this.completedAll = true; return false; }
    this.active = { def, step: 0 };
    this.game.toast(def.title);
    this.game.banner(def.title, def.briefing);
    this.game.sound.missionComplete();
    this.enterStep();
    return true;
  }
  enterStep() {
    const step = this.active.def.steps[this.active.step];
    this.stepTimer = 0;
    this.killsDone = 0;
    if (!step) return;
    if (step.type === 'kill') {
      this.killsNeeded = step.count;
      for (let i = 0; i < step.count; i++) {
        const a = (i / step.count) * Math.PI * 2;
        this.game.combat.spawnEnemy(step.x + Math.cos(a) * 7, step.z + Math.sin(a) * 7, 50);
      }
      this.game.toast('Vipers at the warehouse — take them out!');
    }
    if (step.type === 'steal') {
      this.targetCar = new Car(this.game.scene, 'sports', step.x, step.z, 0.6, 0xd93a2b);
      this.game.traffic.parked.push(this.targetCar);
      this.game.toast('That red Comet GT — it has to be yours.');
    }
    if (step.type === 'van') {
      this.targetCar = new Car(this.game.scene, 'van', step.x, step.z, -0.4, 0x2b3a4a);
      this.game.traffic.parked.push(this.targetCar);
    }
    if (step.type === 'escape') {
      this.game.wanted.heat = step.wanted * 25;
      this.game.wanted.stars = step.wanted;
      this.game.wanted.quietTime = 0;
      this.game.toast('The SBPD is on you — run!');
    }
    this.updateBeacon();
  }
  updateBeacon() {
    const step = this.active && this.active.def.steps[this.active.step];
    if (!step || step.type === 'kill') {
      // kill steps: beacon on the fight area
      if (step) { this.beacon.position.set(step.x, 0, step.z); this.beacon.visible = true; }
      else this.beacon.visible = false;
      return;
    }
    this.beacon.position.set(step.x, 0, step.z);
    this.beacon.visible = true;
  }
  objectiveText() {
    if (this.completedAll) return { title: 'FREE ROAM', text: 'Solmar Bay is yours. Explore, steal, race — and stay out of trouble.' };
    if (!this.active) return { title: 'SOLMAR BAY', text: 'Press M for the next job — Mara is waiting.' };
    const step = this.active.def.steps[this.active.step];
    return { title: this.active.def.title, text: step ? step.text : '' };
  }
  markerPos() {
    const step = this.active && this.active.def.steps[this.active.step];
    return step ? { x: step.x, z: step.z } : null;
  }
  fail(reason) {
    if (!this.active) return;
    this.game.combat.clearEnemies();
    if (this.targetCar) { this.targetCar.remove(this.game.scene); this.game.traffic.removeParked(this.targetCar); this.targetCar = null; }
    this.active = null;
    this.beacon.visible = false;
    this.game.banner('MISSION FAILED', reason);
    this.game.sound.missionFail();
  }
  completeStep() {
    const def = this.active.def;
    this.active.step++;
    if (this.active.step >= def.steps.length) {
      // mission complete
      this.game.addMoney(def.reward);
      this.game.banner('MISSION COMPLETE', `+$${def.reward} — ${def.title}`);
      this.game.sound.missionComplete();
      this.game.sound.cash();
      if (this.targetCar) { this.targetCar = null; }
      this.index++;
      this.active = null;
      this.beacon.visible = false;
      this.game.saveGame();
      // brief breather, then the next job auto-starts
      this.game.missionCooldown = 4;
      if (this.index >= MISSIONS.length) {
        this.completedAll = true;
        this.game.banner('STORY COMPLETE', 'Rico did it. Solmar Bay is yours now.');
      }
      return;
    }
    this.game.sound.pickup();
    this.enterStep();
  }
  update(dt) {
    // beacon pulse
    if (this.beacon.visible) {
      const t = performance.now() / 1000;
      this.pillar.material.opacity = 0.22 + Math.sin(t * 3) * 0.1;
      this.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.12);
    }
    if (!this.active) return;
    const step = this.active.def.steps[this.active.step];
    const g = this.game;
    const px = g.playerCar ? g.playerCar.x : g.player.x;
    const pz = g.playerCar ? g.playerCar.z : g.player.z;
    const d = dist2D(px, pz, step.x, step.z);
    switch (step.type) {
      case 'goto':
      case 'deliver':
        if (d < step.radius) this.completeStep();
        break;
      case 'steal':
      case 'van':
        if (g.playerCar === this.targetCar) this.completeStep();
        break;
      case 'escape':
        if (d < step.radius) this.completeStep();
        break;
      case 'kill':
        if (this.killsDone >= this.killsNeeded) this.completeStep();
        break;
      default:
        break;
    }
  }
  onEnemyKilled() { this.killsDone++; }
}
