// Procedural WebAudio SFX engine — layered synth sounds, no asset files.
let ctx = null;
let masterGain = null;
let ambient = null;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function env(g, t0, attack, decay, peak = 1) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

let _noiseBuf = null;
function noiseBuffer(a) {
  if (_noiseBuf) return _noiseBuf;
  _noiseBuf = a.createBuffer(1, a.sampleRate * 1.0, a.sampleRate);
  const d = _noiseBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.03 * white) / 1.03;          // brown-ish
    d[i] = i % 2 ? white : last * 3;               // mixed character
  }
  return _noiseBuf;
}

export const sfx = {
  vol: 0.55,

  play(kind, dist = 0) {
    try {
      const a = ac();
      const t = a.currentTime;
      const bus = a.createGain();
      const falloff = Math.max(0.04, 1 - dist / 140);
      bus.gain.value = this.vol * falloff;
      bus.connect(masterGain);

      const osc = (type, f0, f1, dur, peak = 0.6, delay = 0) => {
        const o = a.createOscillator(), g = a.createGain();
        o.type = type; o.frequency.setValueAtTime(f0, t + delay);
        if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + delay + dur);
        env(g, t + delay, 0.004, dur, peak);
        o.connect(g); g.connect(bus);
        o.start(t + delay); o.stop(t + delay + dur + 0.05);
      };
      const noise = (dur, peak = 0.5, fType = 'lowpass', f0 = 2000, f1 = 0, q = 0.8, delay = 0) => {
        const s = a.createBufferSource(); s.buffer = noiseBuffer(a); s.loop = true;
        s.playbackRate.value = 0.7 + Math.random() * 0.6;
        const f = a.createBiquadFilter(); f.type = fType; f.Q.value = q;
        f.frequency.setValueAtTime(f0, t + delay);
        if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + delay + dur);
        const g = a.createGain(); env(g, t + delay, 0.004, dur, peak);
        s.connect(f); f.connect(g); g.connect(bus);
        s.start(t + delay); s.stop(t + delay + dur + 0.05);
      };

      switch (kind) {
        // ---------- weapons ----------
        case 'shot':          noise(0.09, 0.5, 'bandpass', 1800, 500, 0.6); osc('square', 190, 70, 0.07, 0.3); break;
        case 'shot_smg':      noise(0.06, 0.4, 'bandpass', 2400, 900, 0.7); osc('square', 260, 110, 0.05, 0.25); break;
        case 'shot_pistol':   noise(0.08, 0.45, 'bandpass', 2000, 600, 0.8); osc('triangle', 320, 90, 0.06, 0.35); break;
        case 'shot_shotgun':  noise(0.22, 0.8, 'lowpass', 2800, 400); osc('square', 130, 45, 0.16, 0.5); break;
        case 'shot_sniper':   noise(0.05, 0.9, 'highpass', 1200); noise(0.5, 0.35, 'lowpass', 900, 150, 0.5, 0.03); osc('sine', 140, 40, 0.4, 0.5); break;
        case 'shot_lmg':      noise(0.1, 0.55, 'bandpass', 1500, 400); osc('square', 150, 60, 0.09, 0.4); break;
        case 'shot_energy':   osc('sawtooth', 1400, 180, 0.28, 0.45); osc('sine', 700, 90, 0.28, 0.3); noise(0.15, 0.2, 'highpass', 3000); break;
        case 'shot_heavy':    noise(0.35, 0.7, 'lowpass', 1200, 200); osc('sine', 110, 35, 0.3, 0.6); break;
        case 'shot_chaingun': noise(0.07, 0.6, 'bandpass', 1000, 350, 0.5); osc('square', 95, 45, 0.07, 0.5); break;
        case 'rocket_loop':   noise(0.5, 0.3, 'lowpass', 800, 300); break;

        // ---------- explosions / titan ----------
        case 'explosion':     noise(0.9, 1.0, 'lowpass', 1400, 90); osc('sine', 95, 26, 0.8, 0.9); noise(0.15, 0.6, 'highpass', 2500); break;
        case 'explosion_big': noise(1.6, 1.1, 'lowpass', 1100, 60); osc('sine', 70, 20, 1.4, 1.0); noise(0.25, 0.7, 'highpass', 2000); break;
        case 'titanfall':     noise(1.8, 0.9, 'lowpass', 600, 60); osc('sine', 55, 22, 1.7, 0.9); osc('sawtooth', 800, 60, 1.2, 0.12); break;
        case 'step_titan':    noise(0.16, 0.5, 'lowpass', 300, 80); osc('sine', 60, 30, 0.14, 0.6); break;
        case 'servo':         osc('sawtooth', 200, 700, 0.25, 0.15); osc('sine', 90, 90, 0.2, 0.2); break;
        case 'embark':        osc('sawtooth', 160, 620, 0.35, 0.2); noise(0.3, 0.3, 'lowpass', 900, 300, 0.8, 0.1); osc('sine', 440, 880, 0.18, 0.25, 0.35); break;
        case 'disembark':     osc('sawtooth', 620, 160, 0.3, 0.2); noise(0.25, 0.25, 'lowpass', 900, 250); break;
        case 'dash':          noise(0.4, 0.5, 'bandpass', 700, 1800, 0.5); break;
        case 'doom':          osc('sawtooth', 220, 55, 1.1, 0.6); osc('square', 110, 40, 1.1, 0.3); noise(0.9, 0.3, 'lowpass', 500, 120); break;
        case 'eject':         osc('sawtooth', 280, 1400, 0.6, 0.5); noise(0.5, 0.5, 'highpass', 800); break;
        case 'vortex':        osc('sine', 300, 900, 0.5, 0.3); osc('sine', 450, 1350, 0.5, 0.2); break;

        // ---------- pilot movement ----------
        case 'step':          noise(0.05, 0.16, 'lowpass', 700, 250); break;
        case 'jump':          noise(0.14, 0.28, 'bandpass', 900, 2200, 0.6); break;
        case 'jets':          noise(0.3, 0.35, 'bandpass', 1400, 3000, 0.5); osc('sine', 500, 900, 0.2, 0.12); break;
        case 'land':          noise(0.12, 0.35, 'lowpass', 500, 150); osc('sine', 90, 45, 0.1, 0.3); break;
        case 'wallrun':       noise(0.25, 0.2, 'bandpass', 1100, 1800, 0.4); break;
        case 'cloak':         osc('sine', 1600, 300, 0.5, 0.25); noise(0.4, 0.15, 'highpass', 4000); break;
        case 'stim':          osc('sine', 400, 1200, 0.35, 0.3); osc('sine', 800, 2400, 0.35, 0.15); break;
        case 'radar':         osc('sine', 900, 900, 0.1, 0.3); osc('sine', 1200, 1200, 0.12, 0.25, 0.15); break;

        // ---------- feedback ----------
        case 'reload':        osc('square', 480, 700, 0.05, 0.2); osc('square', 700, 500, 0.05, 0.2, 0.12); break;
        case 'hit':           osc('triangle', 1300, 950, 0.05, 0.3); break;
        case 'hit_crit':      osc('triangle', 1700, 1150, 0.07, 0.4); osc('sine', 2200, 1800, 0.05, 0.2); break;
        case 'lock':          osc('sine', 1050, 1050, 0.05, 0.25); break;
        case 'locked':        osc('sine', 1500, 1500, 0.14, 0.4); osc('sine', 1500, 1500, 0.1, 0.3, 0.16); break;
        case 'ready':         osc('sine', 660, 880, 0.28, 0.4); osc('sine', 990, 1320, 0.3, 0.25, 0.12); break;
        case 'levelup':       for (let i = 0; i < 4; i++) osc('sine', 520 * (1 + i * 0.25), 0, 0.22, 0.3, i * 0.09); break;
        case 'death':         osc('sawtooth', 300, 60, 0.8, 0.4); noise(0.6, 0.3, 'lowpass', 800, 150); break;

        // ---------- UI ----------
        case 'ui_click':      osc('sine', 850, 640, 0.06, 0.22); break;
        case 'ui_hover':      osc('sine', 1400, 1400, 0.03, 0.08); break;
        case 'ui_open':       osc('sine', 500, 900, 0.14, 0.2); break;
        case 'splash':        osc('sine', 110, 55, 2.2, 0.5); osc('sine', 220, 110, 2.0, 0.25); noise(2.0, 0.2, 'lowpass', 500, 90); osc('sine', 880, 1760, 0.6, 0.15, 0.4); break;
      }
    } catch (e) { /* audio optional */ }
  },

  // low ambient wind loop for matches
  startAmbient() {
    try {
      const a = ac();
      if (ambient) return;
      const s = a.createBufferSource(); s.buffer = noiseBuffer(a); s.loop = true;
      s.playbackRate.value = 0.3;
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 0.4;
      const g = a.createGain(); g.gain.value = 0.045 * this.vol;
      const lfo = a.createOscillator(); lfo.frequency.value = 0.13;
      const lfoG = a.createGain(); lfoG.gain.value = 0.02 * this.vol;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      s.connect(f); f.connect(g); g.connect(masterGain);
      s.start(); lfo.start();
      ambient = { s, lfo, g };
    } catch (e) {}
  },
  stopAmbient() {
    try {
      if (!ambient) return;
      ambient.g.gain.linearRampToValueAtTime(0.0001, ac().currentTime + 0.5);
      const amb = ambient; ambient = null;
      setTimeout(() => { try { amb.s.stop(); amb.lfo.stop(); } catch (e) {} }, 600);
    } catch (e) {}
  },

  // ---------------- procedural menu music: dark military sci-fi loop ----------------
  startMusic() {
    try {
      const a = ac();
      if (this._music) return;
      const bus = a.createGain();
      bus.gain.value = 0.0001;
      bus.gain.linearRampToValueAtTime(0.16 * this.vol, a.currentTime + 2);
      bus.connect(masterGain);
      // Am – F – C – G roots, low and slow
      const roots = [55.0, 43.65, 65.41, 49.0];   // A1, F1, C2, G1
      let bar = 0;
      const BAR = 3.6;
      const scheduleBar = () => {
        const t = a.currentTime + 0.05;
        const root = roots[bar % roots.length];
        // sub drone
        const subO = a.createOscillator(), subG = a.createGain();
        subO.type = 'sine'; subO.frequency.value = root;
        subG.gain.setValueAtTime(0.0001, t);
        subG.gain.linearRampToValueAtTime(0.5, t + 0.8);
        subG.gain.linearRampToValueAtTime(0.0001, t + BAR + 0.3);
        subO.connect(subG); subG.connect(bus);
        subO.start(t); subO.stop(t + BAR + 0.5);
        // pad: root + fifth + octave, detuned saws through lowpass
        for (const mult of [2, 3, 4]) {
          for (const det of [-4, 4]) {
            const o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
            o.type = 'sawtooth'; o.frequency.value = root * mult; o.detune.value = det;
            f.type = 'lowpass'; f.frequency.value = 600;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(0.05, t + 1.4);
            g.gain.linearRampToValueAtTime(0.0001, t + BAR + 0.4);
            o.connect(f); f.connect(g); g.connect(bus);
            o.start(t); o.stop(t + BAR + 0.6);
          }
        }
        // sparse high pulse motif every other bar
        if (bar % 2 === 1) {
          for (let i = 0; i < 3; i++) {
            const o = a.createOscillator(), g = a.createGain();
            o.type = 'sine'; o.frequency.value = root * 8 * (i === 2 ? 1.5 : 1);
            const nt = t + 0.9 + i * 0.45;
            g.gain.setValueAtTime(0.0001, nt);
            g.gain.linearRampToValueAtTime(0.12, nt + 0.03);
            g.gain.exponentialRampToValueAtTime(0.0001, nt + 0.6);
            o.connect(g); g.connect(bus);
            o.start(nt); o.stop(nt + 0.7);
          }
        }
        bar++;
      };
      scheduleBar();
      this._music = { bus, timer: setInterval(scheduleBar, BAR * 1000) };
    } catch (e) {}
  },
  stopMusic() {
    try {
      if (!this._music) return;
      clearInterval(this._music.timer);
      this._music.bus.gain.linearRampToValueAtTime(0.0001, ac().currentTime + 1.2);
      const b = this._music.bus; this._music = null;
      setTimeout(() => b.disconnect(), 1500);
    } catch (e) {}
  }
};

// ---------------- announcer voice (Web Speech API — no assets) ----------------
let voiceObj = null;
function pickVoice() {
  if (voiceObj) return voiceObj;
  const vs = speechSynthesis.getVoices();
  voiceObj = vs.find(v => /en[-_](US|GB)/i.test(v.lang) && /google|microsoft/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang)) || vs[0] || null;
  return voiceObj;
}
export const voice = {
  enabled: true,
  say(text, { priority = false } = {}) {
    try {
      if (!this.enabled || !('speechSynthesis' in window)) return;
      if (priority) speechSynthesis.cancel();
      else if (speechSynthesis.speaking && speechSynthesis.pending) return;   // don't stack a backlog
      const u = new SpeechSynthesisUtterance(text);
      u.voice = pickVoice();
      u.rate = 1.02; u.pitch = 0.72; u.volume = 0.9;   // low pitch: military computer
      speechSynthesis.speak(u);
    } catch (e) { /* voice optional */ }
  }
};
try { speechSynthesis.onvoiceschanged = () => { voiceObj = null; pickVoice(); }; } catch (e) {}

// Weapon definition → sound kind
export function weaponSound(def, slot) {
  if (def.beam || def.chargeTime) return 'shot_energy';
  if (slot === 'titanPrimary') return def.hitscan ? 'shot_chaingun' : 'shot_heavy';
  if (slot === 'titanOrdnance' || slot === 'at') return 'shot_heavy';
  const t = (def.type || '').toLowerCase();
  if (t.includes('shotgun')) return 'shot_shotgun';
  if (t.includes('sniper')) return 'shot_sniper';
  if (t.includes('smg') || t.includes('machine pistol')) return 'shot_smg';
  if (t.includes('pistol') || t.includes('revolver')) return 'shot_pistol';
  if (t.includes('lmg')) return 'shot_lmg';
  return 'shot';
}
