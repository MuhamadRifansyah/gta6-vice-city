// Solmar Bay — the game itself. Boots three.js, wires every system together
// (city, player, traffic, police, combat, missions, HUD, sound, effects, save),
// runs the loop, the camera, the menus and the ?shot= staging scenes used for
// screenshots. Rico Vega's story, all original: no Rockstar / GTA content.
import * as THREE from 'three';
import { buildCity } from './city.js';
import { Player } from './player.js';
import { Car, CAR_TYPES } from './vehicles.js';
import { Traffic } from './traffic.js';
import { Wanted, Police } from './police.js';
import { Combat } from './combat.js';
import { MissionManager } from './missions.js';
import { HUD } from './hud.js';
import { SoundEngine } from './audio.js';
import { Input } from './input.js';
import { Effects } from './effects.js';
import { saveGameData, loadGameData, hasSave, clearSave } from './save.js';
import { clamp, dist2D, lerp, lerpAngle } from './util.js';

const params = new URLSearchParams(window.location.search);
const SHOT = params.get('shot'); // chase | street | mission | start

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera.position.set(0, 6, -12);

    this.city = buildCity(this.scene);
    this.player = new Player(this.scene);
    this.traffic = new Traffic(this.scene, this.city.colliders, this.city.parkingSpots);
    this.wanted = new Wanted();
    this.police = new Police(this.scene, this.city.colliders);
    this.combat = new Combat(this.scene);
    this.missions = new MissionManager(this);
    this.hud = new HUD();
    this.sound = new SoundEngine();
    this.input = new Input(this.canvas);
    this.effects = new Effects(this.scene);

    // --- state ---
    this.screen = 'menu'; // menu | playing | paused | busted | wasted
    this.money = 500;
    this.health = 100;
    this.weapon = 'fists';
    this.ammo = 12;
    this.magSize = 12;
    this.reloading = 0;
    this.shootCooldown = 0;
    this.playerCar = null;
    this.camYaw = Math.PI;
    this.camPitch = 0.32;
    this.day = 1;
    this.clockMinutes = 12 * 60;
    this.missionCooldown = 0;
    this.lastDamageAt = -99;
    this.ramCooldown = 0;
    this.saveTimer = 0;
    this.elapsed = 0;
    this.framesRendered = 0;
    this.muted = false;

    this.wireCallbacks();
    this.wireMenu();
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'playing') this.pauseGame();
    });
    document.getElementById('loading').remove();
    if (hasSave()) document.getElementById('btn-continue').classList.remove('hidden');
  }

  wireCallbacks() {
    this.traffic.onPedHit = (ped) => {
      this.wanted.addCrime(15);
      this.hud.toast('Pedestrian down! The SBPD is coming.');
      this.effects.blood(ped.x, 1, ped.z);
      this.sound.crash();
      this.effects.shake(0.4);
    };
    this.traffic.onCarBump = (car) => {
      const px = this.playerCar ? this.playerCar.x : this.player.x;
      const pz = this.playerCar ? this.playerCar.z : this.player.z;
      if (dist2D(car.x, car.z, px, pz) < 35) { this.sound.crash(); this.effects.shake(0.25); }
    };
    this.police.onBusted = () => this.endRun('busted');
    this.police.onRam = () => {
      if (this.ramCooldown <= 0) {
        this.ramCooldown = 1;
        this.damagePlayer(3);
        this.sound.crash();
        this.effects.shake(0.5);
      }
    };
    this.combat.onPlayerHit = (dmg) => this.damagePlayer(dmg);
    this.combat.onEnemyShot = () => this.sound.enemyShot();
    this.combat.onEnemyKilled = (enemy) => {
      this.missions.onEnemyKilled();
      this.effects.blood(enemy.x, 1.2, enemy.z);
    };
  }

  wireMenu() {
    const startScreen = document.getElementById('start-screen');
    const pauseScreen = document.getElementById('pause-screen');
    const endScreen = document.getElementById('end-screen');
    document.getElementById('btn-start').addEventListener('click', () => {
      this.sound.init(); this.sound.resume(); this.sound.click();
      clearSave();
      this.newGame();
      startScreen.classList.add('hidden');
    });
    document.getElementById('btn-continue').addEventListener('click', () => {
      this.sound.init(); this.sound.resume(); this.sound.click();
      this.continueGame();
      startScreen.classList.add('hidden');
    });
    document.getElementById('btn-resume').addEventListener('click', () => {
      this.sound.click();
      pauseScreen.classList.add('hidden');
      this.screen = 'playing';
    });
    document.getElementById('btn-restart').addEventListener('click', () => {
      this.sound.click();
      clearSave();
      this.newGame();
      pauseScreen.classList.add('hidden');
    });
    document.getElementById('btn-quit-menu').addEventListener('click', () => {
      this.sound.click();
      this.saveGame();
      pauseScreen.classList.add('hidden');
      startScreen.classList.remove('hidden');
      this.screen = 'menu';
      this.hud.hide();
      if (document.pointerLockElement) document.exitPointerLock();
    });
    document.getElementById('btn-end-ok').addEventListener('click', () => {
      this.sound.click();
      endScreen.classList.add('hidden');
      this.screen = 'playing';
    });
  }

  // --- UI hooks used by missions / systems ---
  toast(msg, s) { this.hud.toast(msg, s); }
  banner(title, sub) { this.hud.banner(title, sub); }
  addMoney(n) { this.money += n; this.hud.setMoney(this.money); }
  saveGame() {
    saveGameData({
      money: this.money, missionIndex: this.missions.index,
      x: this.player.x, z: this.player.z, angle: this.player.angle,
      health: this.health, day: this.day, clockMinutes: this.clockMinutes,
    });
  }

  newGame() {
    this.money = 500;
    this.health = 100;
    this.weapon = 'fists';
    this.ammo = this.magSize;
    this.day = 1;
    this.clockMinutes = 12 * 60;
    this.wanted.clear();
    this.police.clear();
    this.combat.clearEnemies();
    this.combat.clearPickups();
    if (this.playerCar) { this.playerCar = null; }
    this.player.inCar = false;
    this.player.setPosition(0, 20, 0);
    this.scene.remove(this.missions.beacon);
    this.missions = new MissionManager(this);
    this.missionCooldown = 2.5;
    this.screen = 'playing';
    this.hud.show();
    this.hud.setHealth(this.health);
    this.hud.setMoney(this.money);
    this.hud.setWanted(0);
    this.hud.setWeapon(this.weapon, this.ammo);
    this.hud.toast('Welcome to Solmar Bay. Mara has a job for you.', 4);
    this.saveGame();
  }

  continueGame() {
    const data = loadGameData();
    this.newGame();
    if (!data) return;
    this.money = data.money ?? 500;
    this.health = data.health ?? 100;
    this.day = data.day ?? 1;
    this.clockMinutes = data.clockMinutes ?? 720;
    this.player.setPosition(data.x ?? 0, data.z ?? 20, data.angle ?? 0);
    this.missions.index = Math.min(data.missionIndex ?? 0, 5);
    this.hud.setMoney(this.money);
    this.hud.setHealth(this.health);
    this.hud.toast('Welcome back, Rico.', 3);
  }

  pauseGame() {
    if (this.screen !== 'playing') return;
    this.screen = 'paused';
    this.input.endFrame();
    this.saveGame();
    document.getElementById('pause-stats').innerHTML =
      `Money: <b>$${Math.floor(this.money).toLocaleString('en-US')}</b><br>` +
      `Mission: <b>${this.missions.completedAll ? 'Story complete' : 'Job ' + (this.missions.index + 1) + ' of 5'}</b><br>` +
      `Wanted: <b>${'★'.repeat(this.wanted.stars) || 'clean'}</b><br>` +
      `Health: <b>${Math.round(this.health)}</b>`;
    document.getElementById('pause-screen').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  endRun(kind) {
    if (this.screen !== 'playing') return;
    this.missions.fail(kind === 'busted' ? 'Rico got caught by the SBPD.' : 'Rico got wasted.');
    this.wanted.clear();
    this.police.clear();
    this.combat.clearEnemies();
    const lost = Math.floor(this.money * 0.15);
    this.money -= lost;
    this.health = 100;
    this.player.inCar = false;
    if (this.playerCar) { this.playerCar = null; }
    this.player.setPosition(0, 20, 0);
    this.screen = kind;
    document.getElementById('end-title').textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
    document.getElementById('end-text').textContent =
      kind === 'busted'
        ? `The SBPD took you in. You lost $${lost.toLocaleString('en-US')} in fines and impound fees. Mara bailed you out — the jobs are still waiting.`
        : `Rico went down. The clinic patched him up for $${lost.toLocaleString('en-US')}. The jobs are still waiting.`;
    document.getElementById('end-screen').classList.remove('hidden');
    this.hud.setMoney(this.money);
    this.hud.setHealth(this.health);
    this.hud.setWanted(0);
    if (document.pointerLockElement) document.exitPointerLock();
    this.saveGame();
  }

  damagePlayer(dmg) {
    if (this.screen !== 'playing') return;
    this.health -= dmg;
    this.lastDamageAt = this.elapsed;
    this.hud.setHealth(this.health);
    this.hud.damageFlash(0.5 + dmg * 0.04);
    this.effects.shake(0.3);
    if (this.health <= 0) this.endRun('wasted');
  }

  // --- entering / stealing cars ---
  tryEnterCar() {
    if (this.playerCar) {
      // exit: step out to the side
      const f = this.playerCar.forward();
      this.player.setPosition(
        this.playerCar.x - f.z * 2.2, this.playerCar.z + f.x * 2.2, this.playerCar.angle);
      this.player.inCar = false;
      this.traffic.parked.push(this.playerCar);
      this.playerCar = null;
      this.sound.click();
      return;
    }
    const car = this.traffic.nearestCar(this.player.x, this.player.z, 4.2);
    if (!car) return;
    const wasParked = this.traffic.parked.includes(car);
    this.traffic.removeParked(car);
    if (!wasParked) {
      // a driver was in it: they bail and run
      const ped = this.traffic.spawnPedestrian();
      ped.x = car.x + 2; ped.z = car.z + 2;
      ped.state = 'flee'; ped.fleeTimer = 4;
      ped.group.position.set(ped.x, 0, ped.z);
    }
    this.playerCar = car;
    this.player.inCar = true;
    this.wanted.addCrime(15);
    this.hud.toast(`You stole the ${car.spec.name}! The SBPD is coming.`);
    this.sound.horn();
    this.hud.hint('W A S D to drive · SPACE handbrake · E to get out', 4);
  }

  // --- shooting ---
  tryShoot() {
    if (this.weapon !== 'pistol' || this.playerCar || this.reloading > 0) return;
    if (this.shootCooldown > 0 || this.ammo <= 0) {
      if (this.ammo <= 0) this.startReload();
      return;
    }
    this.shootCooldown = 0.22;
    this.ammo--;
    // face where the camera looks
    this.player.angle = this.camYaw + Math.PI;
    const point = this.combat.shoot(this.camera);
    this.sound.gunshot();
    this.effects.shake(0.12);
    if (point) this.effects.burst(point.x, point.y, point.z, 0xffd98a, 5, 3, 2);
    if (this.elapsed - (this.lastShotCrimeAt || -99) > 5) {
      this.lastShotCrimeAt = this.elapsed;
      this.wanted.addCrime(10);
    }
    if (this.ammo === 0) this.startReload();
    this.hud.setWeapon(this.weapon, this.ammo);
  }
  startReload() {
    if (this.reloading > 0 || this.ammo === this.magSize) return;
    this.reloading = 1.2;
    this.sound.click();
  }

  // --- per-frame update ---
  step(dt) {
    this.elapsed += dt;
    this.clockMinutes += dt * 1.5;
    if (this.clockMinutes >= 1440) { this.clockMinutes -= 1440; this.day++; }
    const input = this.input;
    // mouse look
    const { dx, dy } = input.consumeMouse();
    this.camYaw -= dx * 0.0032;
    this.camPitch = clamp(this.camPitch + dy * 0.0022, 0.06, 0.62);
    // global keys
    if (input.wasPressed('KeyM')) {
      this.muted = !this.muted;
      this.sound.setMuted(this.muted);
      this.hud.toast(this.muted ? 'Sound muted (M to unmute)' : 'Sound on');
    }
    if (input.wasPressed('KeyP') || input.wasPressed('Escape')) this.pauseGame();
    if (input.wasPressed('KeyQ') && !this.playerCar) {
      this.weapon = this.weapon === 'fists' ? 'pistol' : 'fists';
      this.sound.click();
      this.hud.setWeapon(this.weapon, this.ammo);
      this.hud.toast(this.weapon === 'pistol' ? 'Pistol ready — click to shoot' : 'Fists. Mara would not approve.');
    }
    if (input.wasPressed('KeyR')) this.startReload();
    if (input.wasPressed('KeyH') && this.playerCar) this.sound.horn();
    if (input.wasPressed('KeyE')) this.tryEnterCar();
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    this.ramCooldown = Math.max(0, this.ramCooldown - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.ammo = this.magSize; this.hud.setWeapon(this.weapon, this.ammo); }
    }

    // --- movement ---
    if (this.playerCar) {
      const car = this.playerCar;
      const prevSpeed = car.speed;
      // in a staged screenshot scene the car keeps driving itself
      const autoDrive = !!SHOT;
      const throttle = autoDrive ? 0.55 : (input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0)
        + (input.isDown('KeyS') || input.isDown('ArrowDown') ? -0.8 : 0);
      const steer = (input.isDown('KeyA') || input.isDown('ArrowLeft') ? -1 : 0)
        + (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0);
      car.update(dt, {
        throttle,
        steer,
        brake: input.isDown('KeyS') && car.speed > 1,
        handbrake: input.isDown('Space'),
      }, this.city.colliders);
      if (car.crashed && Math.abs(prevSpeed) > 12) {
        this.damagePlayer(4);
        this.sound.crash();
        this.effects.sparks(car.x, car.z);
        this.effects.shake(0.5);
      }
      // keep Rico's position glued to the car while driving
      this.player.x = car.x;
      this.player.z = car.z;
      // collect pickups from the car too
      const got = this.combat.collect(car.x, car.z, 3);
      if (got > 0) { this.addMoney(got); this.sound.cash(); this.hud.toast(`+$${got} picked up`); }
    } else {
      // camera-relative on-foot movement
      const f = { x: -Math.sin(this.camYaw), z: -Math.cos(this.camYaw) };
      const r = { x: Math.cos(this.camYaw), z: -Math.sin(this.camYaw) };
      let mx = 0, mz = 0;
      if (input.isDown('KeyW') || input.isDown('ArrowUp')) { mx += f.x; mz += f.z; }
      if (input.isDown('KeyS') || input.isDown('ArrowDown')) { mx -= f.x; mz -= f.z; }
      if (input.isDown('KeyD') || input.isDown('ArrowRight')) { mx += r.x; mz += r.z; }
      if (input.isDown('KeyA') || input.isDown('ArrowLeft')) { mx -= r.x; mz -= r.z; }
      const sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      const jump = input.wasPressed('Space');
      this.player.update(dt, { x: mx, z: mz }, sprint, jump, this.city.colliders);
      const got = this.combat.collect(this.player.x, this.player.z, 2.2);
      if (got > 0) { this.addMoney(got); this.sound.cash(); this.hud.toast(`+$${got} picked up`); }
      if ((input.mouseDown || input.consumeClick()) && this.weapon === 'pistol') this.tryShoot();
    }

    // --- world systems ---
    const gunshotAt = (this.weapon === 'pistol' && this.shootCooldown > 0.12)
      ? { x: this.player.x, z: this.player.z } : null;
    this.traffic.update(dt, this.player, this.playerCar, gunshotAt);
    this.wanted.update(dt);
    this.police.update(dt, this.player, this.playerCar, this.wanted.stars);
    this.combat.update(dt, this.player, !!this.playerCar);
    this.missions.update(dt);
    this.city.update(dt, this.elapsed);
    this.effects.update(dt);

    // mission auto-start
    if (!this.missions.active && !this.missions.completedAll) {
      this.missionCooldown -= dt;
      if (this.missionCooldown <= 0) this.missions.startNext();
    }
    // health regen after 8 quiet seconds
    if (this.health < 100 && this.elapsed - this.lastDamageAt > 8) {
      this.health = Math.min(100, this.health + 2.5 * dt);
      this.hud.setHealth(this.health);
    }
    // autosave
    this.saveTimer += dt;
    if (this.saveTimer > 20) { this.saveTimer = 0; this.saveGame(); }
    // sound follows state
    this.sound.update(this.wanted.stars, !!this.playerCar,
      this.playerCar ? Math.abs(this.playerCar.speed) / this.playerCar.spec.maxSpeed : 0);

    // --- HUD ---
    const obj = this.missions.objectiveText();
    this.hud.setObjective(obj.title, obj.text);
    this.hud.setWanted(this.wanted.stars);
    this.hud.setClock(this.day, this.clockMinutes);
    this.hud.setMoney(this.money);
    this.hud.setSpeed(this.playerCar ? Math.abs(this.playerCar.speed) * 2.237 : 0,
      this.playerCar ? this.playerCar.spec.name : null);
    this.hud.drawMinimap({
      player: { x: this.playerCar ? this.playerCar.x : this.player.x,
                z: this.playerCar ? this.playerCar.z : this.player.z,
                angle: this.playerCar ? this.playerCar.angle : this.player.angle },
      cars: [...this.traffic.cars, ...this.traffic.parked].map((c) => ({ x: c.x, z: c.z })),
      police: this.police.cars.map((c) => ({ x: c.x, z: c.z })),
      enemies: this.combat.enemies.filter((e) => !e.dead).map((e) => ({ x: e.x, z: e.z })),
      marker: this.missions.markerPos(),
    });

    this.updateCamera(dt);
    this.input.endFrame();
  }

  updateCamera(dt) {
    const target = this.playerCar || this.player;
    const tx = target.x, tz = target.z;
    const ty = this.playerCar ? 1.2 : this.player.y + 1.5;
    if (this.fixedCam) {
      // staged screenshot framing: camera on the road ahead of Rico, looking
      // back down the road so the pursuing cruisers stay in frame
      const cx = tx + this.fixedCam.dx;
      const cy = ty + this.fixedCam.dy;
      const cz = tz + this.fixedCam.dz;
      this.camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 4));
      this.camera.lookAt(new THREE.Vector3(tx, ty, tz));
      return;
    }
    if (this.playerCar) {
      // chase cam: ease behind the car
      this.camYaw = lerpAngle(this.camYaw, this.playerCar.angle + Math.PI, Math.min(1, dt * 2.2));
      this.camPitch = lerp(this.camPitch, 0.34, Math.min(1, dt * 2));
      const dist = 12;
      const cx = tx + Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist;
      const cz = tz + Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist;
      const cy = ty + Math.sin(this.camPitch) * dist + 1.2;
      this.camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 6));
    } else {
      const dist = 7.5;
      const cx = tx + Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist;
      const cz = tz + Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist;
      const cy = ty + Math.sin(this.camPitch) * dist + 0.6;
      this.camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 10));
    }
    const shake = this.effects.offset();
    this.camera.position.x += shake.x;
    this.camera.position.y += shake.y;
    this.camera.position.z += shake.z;
    const look = new THREE.Vector3(tx, ty, tz);
    if (!this.playerCar) {
      look.x += -Math.sin(this.camYaw) * 2;
      look.z += -Math.cos(this.camYaw) * 2;
    } else {
      const f = this.playerCar.forward();
      look.x += f.x * 4;
      look.z += f.z * 4;
    }
    this.camera.lookAt(look);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // --- screenshot staging: deterministic scenes for ?shot= ---
  stageShot(name) {
    this.sound.init();
    this.newGame();
    document.getElementById('start-screen').classList.add('hidden');
    if (name === 'chase') {
      // Rico in a Comet GT, three stars, two cruisers closing in, job 1 live
      const car = new Car(this.scene, 'sports', 25, 60, Math.PI, 0xd93a2b);
      this.traffic.parked.push(car);
      this.playerCar = car;
      this.player.inCar = true;
      this.player.setPosition(25, 60, Math.PI);
      this.camYaw = 0;
      this.wanted.heat = 65;
      this.wanted.stars = 3;
      // two cruisers on the same road, right behind Rico, already in pursuit
      for (const pz of [82, 98]) {
        const cop = new Car(this.scene, 'police', 25, pz, Math.PI, 0xf0f0f0);
        cop.ai = { stuckTimer: 0, lastX: 25, lastZ: pz };
        this.police.cars.push(cop);
      }
      // front framing: camera on the road ahead, looking back at Rico and the cruisers
      this.fixedCam = { dx: 0, dy: 13, dz: -20 };
      this.missions.startNext();
      this.hud.toast('Lose the cops — reach the safehouse!');
    } else if (name === 'street') {
      this.player.setPosition(-25, -25, Math.PI * 1.25);
      this.camYaw = Math.PI * 0.25;
      this.missions.startNext();
      this.hud.hint('W A S D to move · E to steal a car · Q for the pistol', 6);
    } else if (name === 'mission') {
      // driving the taxi south on the x=25 road toward the mission beacon at the docks
      const car = new Car(this.scene, 'taxi', 25, 100, 0, 0xf2c200);
      this.traffic.parked.push(car);
      this.playerCar = car;
      this.player.inCar = true;
      this.player.setPosition(25, 100, 0);
      this.camYaw = Math.PI;
      this.missions.startNext();
      this.missions.active.step = 1; // delivery leg: beacon at the docks
      this.missions.updateBeacon();
    }
    // settle the world: fixed steps so traffic and police are mid-action
    for (let i = 0; i < 150; i++) {
      if (this.playerCar) {
        this.playerCar.update(1 / 60, { throttle: 0.55, steer: 0, brake: false, handbrake: false }, this.city.colliders);
      }
      this.traffic.update(1 / 60, this.player, this.playerCar, null);
      this.police.update(1 / 60, this.player, this.playerCar, this.wanted.stars);
      this.city.update(1 / 60, i / 60);
    }
    this.updateCamera(1);
    this.hud.setHealth(this.health);
    this.hud.setMoney(this.money);
    this.hud.setWanted(this.wanted.stars);
    this.hud.setWeapon(this.weapon, this.ammo);
    const obj = this.missions.objectiveText();
    this.hud.setObjective(obj.title, obj.text);
  }

  run() {
    if (SHOT && SHOT !== 'start') this.stageShot(SHOT);
    let last = performance.now();
    const frame = (now) => {
      requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (this.screen === 'playing') this.step(dt);
      this.renderer.render(this.scene, this.camera);
      this.framesRendered++;
      if (SHOT && this.framesRendered === 8) window.__shotReady = true;
    };
    requestAnimationFrame(frame);
  }
}

const game = new Game();
game.run();
