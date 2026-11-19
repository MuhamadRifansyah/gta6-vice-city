// Solmar Bay — the HUD: DOM readouts (health, money, wanted stars, objective,
// speed) and a live 2D top-down minimap on canvas showing roads, the sea, the
// player, traffic, police and the mission marker.
import { ROAD_COORDS } from './city.js';

const MAP_MIN = -210, MAP_MAX = 240; // world span the minimap shows

export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      healthBar: document.getElementById('health-bar'),
      healthText: document.getElementById('health-text'),
      money: document.getElementById('money'),
      weapon: document.getElementById('weapon'),
      stars: document.getElementById('stars'),
      clock: document.getElementById('clock'),
      objTitle: document.getElementById('objective-title'),
      objText: document.getElementById('objective-text'),
      speedo: document.getElementById('speedo'),
      speed: document.getElementById('speed'),
      carName: document.getElementById('car-name'),
      minimap: document.getElementById('minimap'),
      crosshair: document.getElementById('crosshair'),
      toast: document.getElementById('toast'),
      banner: document.getElementById('banner'),
      vignette: document.getElementById('vignette'),
      hint: document.getElementById('hint'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.toastTimer = null;
    this.bannerTimer = null;
    this.hintTimer = null;
  }
  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }
  setHealth(h) {
    const pct = Math.max(0, Math.round(h));
    this.el.healthBar.style.width = pct + '%';
    this.el.healthBar.style.background = pct > 50
      ? 'linear-gradient(90deg,#2fd67a,#9be15d)'
      : pct > 25 ? 'linear-gradient(90deg,#f2a93c,#ffd94d)' : 'linear-gradient(90deg,#e5534b,#ff8a5c)';
    this.el.healthText.textContent = String(pct);
  }
  setMoney(m) { this.el.money.textContent = '$' + Math.floor(m).toLocaleString('en-US'); }
  setWeapon(name, ammo) {
    this.el.weapon.textContent = name === 'pistol' ? `PISTOL · ${ammo}/12` : 'FISTS';
    this.el.crosshair.classList.toggle('hidden', name !== 'pistol');
  }
  setWanted(stars) {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < stars ? '★' : '<span class="dim">★</span>';
    this.el.stars.innerHTML = s;
  }
  setClock(day, minutes) {
    const h = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);
    this.el.clock.textContent = `DAY ${day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  setObjective(title, text) {
    this.el.objTitle.textContent = title;
    this.el.objText.textContent = text;
  }
  setSpeed(mph, carName) {
    if (!carName) { this.el.speedo.classList.add('hidden'); return; }
    this.el.speedo.classList.remove('hidden');
    this.el.speed.textContent = String(Math.round(mph));
    this.el.carName.textContent = carName;
  }
  toast(msg, seconds) {
    this.el.toast.textContent = msg;
    this.el.toast.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.el.toast.style.opacity = '0'; }, (seconds || 3.2) * 1000);
  }
  banner(title, sub) {
    this.el.banner.innerHTML = title + (sub ? `<small>${sub}</small>` : '');
    this.el.banner.classList.remove('hidden');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.el.banner.classList.add('hidden'), 3400);
  }
  hint(text, seconds) {
    this.el.hint.textContent = text;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => { this.el.hint.textContent = ''; }, (seconds || 4) * 1000);
  }
  damageFlash(strength) {
    this.el.vignette.style.opacity = String(Math.min(1, strength));
    setTimeout(() => { this.el.vignette.style.opacity = '0'; }, 260);
  }
  // --- minimap ---
  drawMinimap(view) {
    const ctx = this.mapCtx;
    const S = 190;
    const scale = S / (MAP_MAX - MAP_MIN);
    const toX = (x) => (x - MAP_MIN) * scale;
    const toY = (z) => (z - MAP_MIN) * scale;
    ctx.clearRect(0, 0, S, S);
    // sea + sand at the south
    ctx.fillStyle = '#1e7fa8';
    ctx.fillRect(0, toY(232), S, S - toY(232));
    ctx.fillStyle = '#e8d29a';
    ctx.fillRect(0, toY(200), S, toY(232) - toY(200));
    // land
    ctx.fillStyle = '#28444f';
    ctx.fillRect(0, 0, S, toY(200));
    // roads
    ctx.strokeStyle = '#5a646c';
    ctx.lineWidth = 4;
    for (const c of ROAD_COORDS) {
      ctx.beginPath(); ctx.moveTo(toX(c), 0); ctx.lineTo(toX(c), toY(200)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, toY(c)); ctx.lineTo(S, toY(c)); ctx.stroke();
    }
    // mission marker
    if (view.marker) {
      const pulse = 5 + Math.sin(performance.now() / 200) * 2;
      ctx.fillStyle = '#ffc93c';
      ctx.beginPath(); ctx.arc(toX(view.marker.x), toY(view.marker.z), pulse, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(toX(view.marker.x), toY(view.marker.z), pulse + 3, 0, Math.PI * 2); ctx.stroke();
    }
    // traffic cars
    ctx.fillStyle = '#cfd8dc';
    for (const c of view.cars) {
      ctx.fillRect(toX(c.x) - 1.5, toY(c.z) - 1.5, 3, 3);
    }
    // police
    ctx.fillStyle = '#ff4040';
    for (const c of view.police) {
      ctx.beginPath(); ctx.arc(toX(c.x), toY(c.z), 3, 0, Math.PI * 2); ctx.fill();
    }
    // enemies
    ctx.fillStyle = '#c060ff';
    for (const c of view.enemies) {
      ctx.beginPath(); ctx.arc(toX(c.x), toY(c.z), 2.5, 0, Math.PI * 2); ctx.fill();
    }
    // player arrow (rotates with facing)
    const px = toX(view.player.x), py = toY(view.player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(view.player.angle);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#0e7c7b'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }
}
