// DOM HUD controller.
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.centerTimer = null;
    this.hintTimer = null;
  }

  setHealth(hp, max) {
    const el = $('hud-health');
    el.querySelector('.fill').style.width = `${Math.max(0, (hp / max) * 100)}%`;
    el.classList.toggle('hurt', hp < max * 0.35);
  }

  setTitanBars(shield, maxShield, hp, maxHp, visible) {
    const s = $('hud-shield');
    s.classList.toggle('hidden', !visible);
    if (visible) s.querySelector('.fill').style.width = `${Math.max(0, (shield / maxShield) * 100)}%`;
    const h = $('hud-titanhull');
    h.classList.toggle('hidden', !visible);
    if (visible) {
      const frac = Math.max(0, hp / maxHp);
      h.querySelector('.fill').style.width = `${frac * 100}%`;
      h.classList.toggle('low', frac <= 0.25);
      h.querySelector('.label').textContent = hp > 0
        ? `TITAN HULL ${Math.ceil(hp)} / ${maxHp} — DOOMED AT 0`
        : 'TITAN DOOMED';
      // big windscreen-top readout (cockpit view)
      const bar = document.querySelector('#cp-hull .cp-hull-bar');
      const num = document.querySelector('#cp-hull .cp-hull-num');
      if (bar && num) {
        bar.querySelector('.fill').style.width = `${frac * 100}%`;
        bar.querySelector('.shield').style.width = `${Math.max(0, (shield / maxShield) * 100)}%`;
        bar.classList.toggle('low', frac <= 0.25);
        num.classList.toggle('doomed', hp <= 0);
        num.textContent = hp > 0 ? `${Math.ceil(hp)} / ${maxHp}` : '⚠ DOOMED — EJECT (X) ⚠';
      }
    }
  }

  setMeter(pct, ready, inTitan) {
    const el = $('hud-titanmeter');
    el.querySelector('.fill').style.width = `${Math.round(pct * 100)}%`;
    el.classList.toggle('ready', ready);
    el.querySelector('.label').textContent = inTitan ? 'TITAN ACTIVE'
      : ready ? 'TITANFALL READY — PRESS V' : `TITAN ${Math.round(pct * 100)}%`;
  }

  setTactical(name, readyPct) {
    const el = $('hud-tactical');
    el.querySelector('.fill').style.width = `${Math.round(readyPct * 100)}%`;
    el.querySelector('.label').textContent = `${name.toUpperCase()} (Q)${readyPct >= 1 ? ' — READY' : ''}`;
  }

  setWeapon(w) {
    $('hud-weapon').textContent = w.def.name.toUpperCase();
    $('hud-ammo').innerHTML = w.reloading > 0
      ? '<span>RELOADING…</span>'
      : `${w.ammo}<span> / ${w.reserve === Infinity ? '∞' : w.reserve}</span>`;
  }

  setOrdnance(count, name) {
    $('hud-ordnance').textContent = `${name.toUpperCase()} ×${count} (G)`;
  }
  setTitanOrdnanceCd(o) {
    $('hud-ordnance').textContent = `${o.name.toUpperCase()} — CHARGING (G)`;
  }

  setCharge(pct) {
    $('crosshair').style.color = pct > 0 ? `rgb(255, ${Math.round(200 - 150 * pct)}, 60)` : '';
    $('crosshair').style.transform = `translate(-50%,-50%) scale(${1 + pct * 0.8})`;
  }

  setLock(lock) {
    const el = $('hud-lockon');
    if (!lock) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.classList.toggle('locked', lock.done);
    el.textContent = lock.done ? 'LOCKED' : `LOCKING ${Math.round(lock.progress * 100)}%`;
  }

  hitmarker(crit) {
    const el = $('hitmarker');
    el.classList.remove('show', 'crit');
    void el.offsetWidth;
    el.classList.add('show');
    if (crit) el.classList.add('crit');
    setTimeout(() => el.classList.remove('show'), 120);
  }

  center(msg, ttl = 2500) {
    $('hud-center-msg').textContent = msg;
    clearTimeout(this.centerTimer);
    if (ttl) this.centerTimer = setTimeout(() => { $('hud-center-msg').textContent = ''; }, ttl);
  }

  hint(msg, ttl = 1800) {
    $('hud-hints').textContent = msg;
    clearTimeout(this.hintTimer);
    if (ttl) this.hintTimer = setTimeout(() => { $('hud-hints').textContent = ''; }, ttl);
  }

  xpToast(key, amount) {
    const labels = {
      gruntKill: 'GRUNT KILLED',
      pilotKill: 'PILOT KILL', titanKillByPilot: 'TITAN DESTROYED', titanKillByTitan: 'TITAN DESTROYED',
      autoTitanKill: 'AUTO-TITAN KILL', rodeoDamage: 'RODEO', executionBonus: 'EXECUTION',
      firstBlood: 'FIRST BLOOD', matchComplete: 'MATCH COMPLETE', matchVictory: 'VICTORY',
      headshotBonus: 'HEADSHOT'
    };
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = `+${amount} XP — ${labels[key] || key}`;
    $('hud-xp-toasts').appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  killfeed(text, teamClassA, killerName, rest) {
    const kf = $('killfeed');
    const el = document.createElement('div');
    el.className = 'kf';
    el.innerHTML = text;
    kf.appendChild(el);
    while (kf.children.length > 6) kf.firstChild.remove();
    setTimeout(() => el.remove(), 7000);
  }

  setScores(imc, mil) {
    $('score-imc').textContent = imc;
    $('score-mil').textContent = mil;
  }

  setTimer(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    $('hud-timer').textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  showRespawn(show, msg) {
    $('respawn-overlay').classList.toggle('hidden', !show);
    if (msg) $('respawn-msg').textContent = msg;
  }
}
