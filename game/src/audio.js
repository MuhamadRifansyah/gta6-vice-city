// Solmar Bay — all sound is synthesized with the Web Audio API: no audio files,
// no network. Engine hum, sirens, gunshots, pickups, UI blips and a procedural
// music loop (bassline + hats + chords) that starts once the player interacts.
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.musicTimer = null;
    this.musicStep = 0;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenHigh = false;
  }
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.startMusic();
    } catch { this.ctx = null; }
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }
  now() { return this.ctx ? this.ctx.currentTime : 0; }
  // --- one-shot helpers -------------------------------------------------
  blip(freq, dur, type, vol, slideTo) {
    if (!this.ctx || this.muted) return;
    const t = this.now();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol, filterFreq) {
    if (!this.ctx || this.muted) return;
    const t = this.now();
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq || 1200;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }
  gunshot() { this.noise(0.14, 0.5, 900); this.blip(120, 0.12, 'sine', 0.35, 40); }
  enemyShot() { this.noise(0.1, 0.18, 700); }
  pickup() { this.blip(660, 0.09, 'sine', 0.2); setTimeout(() => this.blip(990, 0.12, 'sine', 0.2), 80); }
  cash() {
    this.blip(880, 0.08, 'sine', 0.2);
    setTimeout(() => this.blip(1174, 0.08, 'sine', 0.2), 70);
    setTimeout(() => this.blip(1568, 0.14, 'sine', 0.22), 140);
  }
  missionComplete() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => setTimeout(() => this.blip(n, 0.22, 'triangle', 0.25), i * 110));
  }
  missionFail() { this.blip(220, 0.5, 'sawtooth', 0.2, 110); }
  click() { this.blip(440, 0.05, 'square', 0.12); }
  horn() { this.blip(370, 0.18, 'square', 0.15, 370); this.blip(466, 0.18, 'square', 0.12, 466); }
  crash() { this.noise(0.25, 0.4, 500); this.blip(90, 0.2, 'sine', 0.3, 45); }
  sirenStart() {
    if (!this.ctx || this.sirenOsc) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.value = 750;
    g.gain.value = 0.0;
    o.connect(g); g.connect(this.master);
    o.start();
    this.sirenOsc = o; this.sirenGain = g;
  }
  sirenStop() {
    if (this.sirenOsc) { try { this.sirenOsc.stop(); } catch { /* already stopped */ } }
    this.sirenOsc = null; this.sirenGain = null;
  }
  // Called every frame: siren wail and engine follow the game state.
  update(wanted, inCar, speedNorm) {
    if (!this.ctx) return;
    if (wanted > 0) {
      this.sirenStart();
      if (this.sirenOsc) {
        this.sirenHigh = !this.sirenHigh;
        this.sirenOsc.frequency.setTargetAtTime(this.sirenHigh ? 950 : 650, this.now(), 0.05);
        this.sirenGain.gain.setTargetAtTime(this.muted ? 0 : 0.045, this.now(), 0.1);
      }
    } else this.sirenStop();
    if (inCar) {
      if (!this.engineOsc) {
        const o = this.ctx.createOscillator();
        const f = this.ctx.createBiquadFilter();
        const g = this.ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = 60;
        f.type = 'lowpass'; f.frequency.value = 500;
        g.gain.value = 0.0;
        o.connect(f); f.connect(g); g.connect(this.master);
        o.start();
        this.engineOsc = o; this.engineGain = g; this.engineFilter = f;
      }
      this.engineOsc.frequency.setTargetAtTime(55 + speedNorm * 160, this.now(), 0.08);
      this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.05 + speedNorm * 0.05, this.now(), 0.1);
    } else if (this.engineOsc) {
      try { this.engineOsc.stop(); } catch { /* already stopped */ }
      this.engineOsc = null; this.engineGain = null; this.engineFilter = null;
    }
  }
  // --- procedural music: a lazy 100 BPM bassline, hats and soft chords ---
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const bass = [55, 0, 55, 0, 65.4, 0, 55, 0, 49, 0, 49, 0, 58.3, 0, 73.4, 0];
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 207.7, 246.9]];
    const stepDur = 60 / 100 / 2; // eighth notes at 100 BPM
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted) { this.musicStep++; return; }
      const s = this.musicStep % 16;
      const t = this.now();
      const b = bass[s];
      if (b) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'triangle'; o.frequency.value = b;
        g.gain.setValueAtTime(0.16, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.95);
        o.connect(g); g.connect(this.master);
        o.start(t); o.stop(t + stepDur);
      }
      if (s % 2 === 0) this.noise(0.03, 0.05, 6000); // hat
      if (s === 0) {
        const ch = chords[Math.floor(this.musicStep / 16) % chords.length];
        ch.forEach((f) => {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.045, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 16);
          o.connect(g); g.connect(this.master);
          o.start(t); o.stop(t + stepDur * 16);
        });
      }
      this.musicStep++;
    }, stepDur * 1000);
  }
}
