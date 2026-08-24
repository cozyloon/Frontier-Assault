// Menus: auth, main menu, lobby browser, lobby room, armory, stats.
import { socket, call, state } from './net.js';
import { CATALOG, MAPS, MAX_LEVEL, xpForLevel, defaultLoadout } from '/shared/data.js';
import { startGame } from './game/game.js';
import { sfx } from './game/audio.js';
import { initMenuBg, setMenuBgActive } from './menubg.js';

const $ = (id) => document.getElementById(id);
const screens = ['splash', 'auth', 'menu', 'lobbies', 'room', 'armory', 'stats', 'game'];
const MENU_SCREENS = new Set(['auth', 'menu', 'lobbies', 'room', 'armory', 'stats']);
initMenuBg();

// ---------------- splash background art (painted at load — generated, no assets) ----------------
function paintSplashBg() {
  const c = document.createElement('canvas');
  c.width = 1920; c.height = 1080;
  const x = c.getContext('2d');
  // dusk sky
  const sky = x.createLinearGradient(0, 0, 0, 1080);
  sky.addColorStop(0, '#04060c');
  sky.addColorStop(0.45, '#0c1428');
  sky.addColorStop(0.68, '#2a3050');
  sky.addColorStop(0.82, '#7a4426');
  sky.addColorStop(1, '#c05a28');
  x.fillStyle = sky; x.fillRect(0, 0, 1920, 1080);
  // stars
  for (let i = 0; i < 420; i++) {
    x.fillStyle = `rgba(207,224,255,${0.2 + Math.random() * 0.7})`;
    x.fillRect(Math.random() * 1920, Math.random() * 620, Math.random() < 0.15 ? 2 : 1, Math.random() < 0.15 ? 2 : 1);
  }
  // setting sun glow
  const sun = x.createRadialGradient(1420, 870, 10, 1420, 870, 380);
  sun.addColorStop(0, 'rgba(255,235,200,0.95)');
  sun.addColorStop(0.2, 'rgba(255,180,100,0.55)');
  sun.addColorStop(1, 'rgba(255,140,60,0)');
  x.fillStyle = sun; x.beginPath(); x.arc(1420, 870, 380, 0, 7); x.fill();
  // far skyline
  x.fillStyle = '#141a28';
  for (let bx = 0; bx < 1920;) {
    const w = 60 + Math.random() * 130, h = 90 + Math.random() * 260;
    x.fillRect(bx, 900 - h, w, h + 200);
    bx += w + 8;
  }
  // near skyline with lit windows
  x.fillStyle = '#0a0e18';
  const nearB = [];
  for (let bx = -40; bx < 1920;) {
    const w = 110 + Math.random() * 190, h = 200 + Math.random() * 380;
    x.fillRect(bx, 1000 - h, w, h + 100);
    nearB.push([bx, 1000 - h, w, h]);
    bx += w + 14;
  }
  for (const [bx, by, w, h] of nearB) {
    for (let wy = by + 16; wy < by + h - 10; wy += 26) {
      for (let wx = bx + 12; wx < bx + w - 14; wx += 22) {
        if (Math.random() < 0.24) { x.fillStyle = Math.random() < 0.8 ? 'rgba(255,214,140,0.8)' : 'rgba(140,214,255,0.7)'; x.fillRect(wx, wy, 9, 12); }
      }
    }
  }
  // giant titan silhouette (right side, backlit)
  x.fillStyle = '#05070c';
  const tx = 1560, ty = 1080, S = 3.4;
  const r = (ox, oy, w, h) => x.fillRect(tx + ox * S, ty - oy * S, w * S, h * S);
  r(-55, 170, 110, 80);      // torso
  r(-40, 195, 80, 30);       // head block
  r(-95, 175, 45, 55);       // left pauldron
  r(50, 175, 45, 55);        // right pauldron
  r(-88, 130, 32, 60);       // left arm
  r(56, 130, 32, 60);        // right arm
  r(40, 118, 95, 22);        // arm cannon
  r(-52, 95, 40, 95);        // left leg
  r(12, 95, 40, 95);         // right leg
  r(-60, 14, 56, 16);        // left foot
  r(4, 14, 56, 16);          // right foot
  // rim light on titan
  x.fillStyle = 'rgba(255,150,70,0.5)';
  x.fillRect(tx + 50 * S, ty - 230 * S + 60 * S, 4, 170 * S);
  // dropships
  x.fillStyle = '#0c1220';
  for (const [dx, dy] of [[380, 240], [720, 160], [1120, 300]]) {
    x.fillRect(dx, dy, 46, 10); x.fillRect(dx + 10, dy - 6, 26, 6);
    x.fillStyle = 'rgba(255,178,77,0.8)'; x.fillRect(dx - 6, dy + 3, 4, 3);
    x.fillStyle = '#0c1220';
  }
  // atmosphere haze + vignette
  const haze = x.createLinearGradient(0, 700, 0, 1080);
  haze.addColorStop(0, 'rgba(20,26,40,0)'); haze.addColorStop(1, 'rgba(8,10,16,0.7)');
  x.fillStyle = haze; x.fillRect(0, 700, 1920, 380);
  const vig = x.createRadialGradient(960, 540, 380, 960, 540, 1150);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  x.fillStyle = vig; x.fillRect(0, 0, 1920, 1080);

  const el = $('screen-splash');
  el.style.backgroundImage = `linear-gradient(rgba(4,6,10,0.25), rgba(4,6,10,0.35)), url(${c.toDataURL('image/jpeg', 0.85)})`;
  el.style.backgroundSize = 'cover';
  el.style.backgroundPosition = 'center bottom';
}
paintSplashBg();

// ---------------- splash ----------------
let splashDone = false;
function leaveSplash() {
  if (splashDone) return;
  splashDone = true;
  sfx.play('splash');
  sfx.startMusic();
  $('screen-splash').classList.add('leaving');
  setTimeout(() => show('auth'), 900);
}
$('screen-splash').addEventListener('click', leaveSplash);
document.addEventListener('keydown', (e) => {
  if (!splashDone && $('screen-splash').classList.contains('active')) {
    if (e.code === 'Enter' || e.code === 'Space') leaveSplash();
    else sfx.startMusic();   // any key: at least start the soundtrack while on splash
  }
});

// ---------------- menu SFX (delegated) ----------------
document.addEventListener('click', (e) => {
  if (e.target.closest('.btn, .tab, .list-item.clickable, .slot-row')) sfx.play('ui_click');
});
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('.btn, .tab, .list-item.clickable, .slot-row');
  if (el && el !== document._lastHover) { document._lastHover = el; sfx.play('ui_hover'); }
});

export function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('active', s === name);
  setMenuBgActive(MENU_SCREENS.has(name));
  if (MENU_SCREENS.has(name)) sfx.startMusic(); else sfx.stopMusic();
}

function playerChipText() {
  const p = state.profile;
  return p ? `${p.name} · Gen ${p.gen} · LVL ${p.level}` : '';
}
function refreshChips() {
  for (const id of ['menu-player', 'lb-player', 'armory-player']) $(id).textContent = playerChipText();
  const p = state.profile;
  if (p) {
    const bar = $('menu-xpbar');
    const span = p.nextLevelXp ? (p.xp - p.curLevelXp) / (p.nextLevelXp - p.curLevelXp) : 1;
    bar.querySelector('.fill').style.width = `${Math.round(span * 100)}%`;
    bar.querySelector('.label').textContent = p.nextLevelXp
      ? `LVL ${p.level} — ${p.xp} / ${p.nextLevelXp} XP`
      : `LVL ${MAX_LEVEL} (MAX) — ${p.xp} XP`;
  }
}

// ---------------- auth ----------------
async function doAuth(kind) {
  const name = $('auth-name').value.trim();
  const pass = $('auth-pass').value;
  const r = await call('auth:' + kind, { name, pass });
  if (r.error) { $('auth-error').textContent = r.error; return; }
  state.profile = r.profile;
  refreshChips();
  show('menu');
}
$('btn-login').onclick = () => doAuth('login');
$('btn-register').onclick = () => doAuth('register');
$('auth-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth('login'); });
$('btn-logout').onclick = () => location.reload();

document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => show(b.dataset.back));
$('btn-play').onclick = () => { show('lobbies'); refreshLobbies(); };
$('btn-armory').onclick = () => { show('armory'); renderArmory(); };
$('btn-stats').onclick = async () => {
  const r = await call('profile:get');
  if (r.profile) state.profile = r.profile;
  const p = state.profile;
  const kd = p.deaths ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
  $('stats-body').innerHTML = `
    <div><b>${p.name}</b> — Generation ${p.gen}, Level ${p.level} / ${MAX_LEVEL}</div>
    <div>XP: <b>${p.xp}</b>${p.nextLevelXp ? ` (next level at ${p.nextLevelXp})` : ' (MAX)'}</div>
    <div>Pilot kills: <b>${p.kills}</b> · Deaths: <b>${p.deaths}</b> · K/D: <b>${kd}</b></div>
    <div>Titans destroyed: <b>${p.titanKills}</b></div>
    <div>Matches: <b>${p.matches}</b> · Victories: <b>${p.wins}</b></div>
    ${p.level >= MAX_LEVEL && p.gen < 10 ? '<button class="btn primary" id="btn-regen">REGENERATE (Gen ' + (p.gen + 1) + ')</button>' : ''}
  `;
  const rg = $('btn-regen');
  if (rg) rg.onclick = async () => {
    const rr = await call('profile:regenerate');
    if (rr.profile) { state.profile = rr.profile; refreshChips(); $('btn-stats').onclick(); }
  };
  show('stats');
};

// ---------------- lobby browser ----------------
const mapSel = $('cl-map');
for (const m of Object.values(MAPS)) {
  const o = document.createElement('option');
  o.value = m.id; o.textContent = `${m.name} — ${m.desc}`;
  mapSel.appendChild(o);
}

async function refreshLobbies() {
  const r = await call('lobby:list');
  const list = $('lobby-list');
  list.innerHTML = '';
  if (!r.lobbies.length) list.innerHTML = '<div class="list-item"><span class="meta">No open lobbies — create one on the right.</span></div>';
  for (const l of r.lobbies) {
    const el = document.createElement('div');
    el.className = 'list-item clickable';
    el.innerHTML = `<div><b>${esc(l.name)}</b><div class="meta">${l.mapName} · score ${l.scoreLimit} · ${Math.round(l.timeLimit / 60)} min · ${l.state === 'ingame' ? 'IN PROGRESS (joinable)' : 'waiting'}</div></div>
      <span>${l.players}/${l.maxPlayers}</span>`;
    el.onclick = async () => {
      const jr = await call('lobby:join', { id: l.id });
      if (jr.error) { $('lobbies-error').textContent = jr.error; return; }
      state.lobby = jr.lobby;
      enterRoom();
    };
    list.appendChild(el);
  }
}
$('btn-refresh').onclick = refreshLobbies;
$('btn-create').onclick = async () => {
  const r = await call('lobby:create', {
    name: $('cl-name').value.trim() || undefined,
    mapId: mapSel.value,
    maxPlayers: +$('cl-max').value,
    scoreLimit: +$('cl-score').value,
    timeLimit: +$('cl-time').value
  });
  if (r.error) { $('lobbies-error').textContent = r.error; return; }
  state.lobby = r.lobby;
  enterRoom();
};

// ---------------- lobby room ----------------
function enterRoom() {
  show('room');
  renderRoom();
}
function renderRoom() {
  const l = state.lobby;
  if (!l) return;
  $('room-title').textContent = l.name;
  $('room-map').textContent = `${l.mapName} · score ${l.scoreLimit} · ${Math.round(l.timeLimit / 60)} min`;
  const imc = $('room-imc'), mil = $('room-militia');
  imc.innerHTML = ''; mil.innerHTML = '';
  for (const p of l.roster) {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `<span>${esc(p.name)} <span class="meta">G${p.gen} L${p.level}${p.id === l.hostId ? ' · HOST' : ''}</span></span>
      <span class="${p.ready ? 'ok-tag' : 'meta'}">${p.ready ? 'READY' : '—'}</span>`;
    (p.team === 'imc' ? imc : mil).appendChild(el);
  }
  $('btn-start').classList.toggle('hidden', l.hostId !== state.myId);
}
socket.on('lobby:update', (l) => {
  state.lobby = l;
  if ($('screen-room').classList.contains('active')) renderRoom();
});
$('btn-leave-room').onclick = () => { socket.emit('lobby:leave'); state.lobby = null; show('lobbies'); refreshLobbies(); };
$('btn-switch-team').onclick = () => {
  const me = state.lobby?.roster.find(r => r.id === state.myId);
  if (me) socket.emit('lobby:team', { team: me.team === 'imc' ? 'militia' : 'imc' });
};
let readyState = false;
$('btn-ready').onclick = () => { readyState = !readyState; socket.emit('lobby:ready', { ready: readyState }); $('btn-ready').textContent = readyState ? 'UNREADY' : 'READY'; };
$('btn-start').onclick = async () => {
  const r = await call('lobby:start');
  if (r.error) $('room-error').textContent = r.error;
};

// chat
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    socket.emit('chat', { text: e.target.value.trim() });
    e.target.value = '';
  }
});
socket.on('chat', ({ from, text }) => {
  const log = $('chat-log');
  const el = document.createElement('div');
  el.innerHTML = `<b>${esc(from)}:</b> ${esc(text)}`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
});
socket.on('kicked', ({ reason }) => { alert(reason); location.reload(); });

// ---------------- match start / end ----------------
socket.on('match:start', (payload) => {
  show('game');
  startGame(payload, () => {         // onQuit
    socket.emit('lobby:leave');
    state.lobby = null;
    show('lobbies'); refreshLobbies();
  }, () => {                          // onReturnToLobby (match ended)
    show('room'); renderRoom();
  });
});
socket.on('match:end:profile', () => {});
socket.on('profile:refresh', async () => {
  const r = await call('profile:get');
  if (r.profile) { state.profile = r.profile; refreshChips(); }
});

// After results, game code calls this to update profile shown in menus.
export function setProfile(p) { state.profile = p; refreshChips(); }

// ---------------- armory ----------------
const SLOTS = {
  pilot: [
    ['pilotPrimary', 'primary', 'PRIMARY WEAPON'],
    ['pilotSidearm', 'sidearm', 'SIDEARM'],
    ['pilotAT', 'at', 'ANTI-TITAN WEAPON'],
    ['pilotOrdnance', 'ordnance', 'ORDNANCE'],
    ['pilotTactical', 'tactical', 'TACTICAL ABILITY']
  ],
  titan: [
    ['titanChassis', 'chassis', 'CHASSIS'],
    ['titanPrimary', 'primary', 'PRIMARY WEAPON'],
    ['titanOrdnance', 'ordnance', 'ORDNANCE'],
    ['titanTactical', 'tactical', 'TACTICAL ABILITY']
  ]
};
let armoryTab = 'pilot';
let activeSlot = null;

document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  armoryTab = t.dataset.tab;
  activeSlot = null;
  renderArmory();
});

function itemStatLine(catKey, item) {
  const bits = [];
  if (item.type) bits.push(item.type);
  if (item.role) bits.push(item.role);
  if (item.damage) bits.push(`DMG ${item.damage}`);
  if (item.rpm) bits.push(`${item.rpm} RPM`);
  if (item.mag) bits.push(`MAG ${item.mag}`);
  if (item.health) bits.push(`HP ${item.health} / SHD ${item.shield} / DASH ×${item.dashes}`);
  if (item.duration && !item.damage) bits.push(`${item.duration}s / CD ${item.cooldown}s`);
  return bits.join(' · ');
}

function renderArmory() {
  const lo = state.profile.loadout;
  const cont = $('armory-slots');
  cont.innerHTML = '';
  // "next unlock" banner across the entire catalog
  const lvl = state.profile.level;
  let next = null;
  for (const cat of Object.values(CATALOG)) {
    for (const item of Object.values(cat)) {
      if (item.unlock > lvl && (!next || item.unlock < next.unlock)) next = item;
    }
  }
  const banner = document.createElement('div');
  banner.className = 'list-item';
  banner.innerHTML = next
    ? `<span class="meta">NEXT UNLOCK</span><b>${next.name}</b><span class="lock-tag">LVL ${next.unlock}</span>`
    : '<span class="ok-tag">ALL EQUIPMENT UNLOCKED</span>';
  cont.appendChild(banner);
  for (const [catKey, slotKey, label] of SLOTS[armoryTab]) {
    const cur = CATALOG[catKey][lo[armoryTab][slotKey]];
    const row = document.createElement('div');
    row.className = 'slot-row' + (activeSlot === catKey ? ' active' : '');
    row.innerHTML = `<div><div class="slot-name">${label}</div><div class="item-name">${cur ? cur.name : '—'}</div></div><span>›</span>`;
    row.onclick = () => { activeSlot = catKey; renderArmory(); renderPicker(catKey, slotKey, label); };
    cont.appendChild(row);
  }
  if (!activeSlot) { $('armory-picker-title').textContent = 'Select a slot'; $('armory-picker').innerHTML = ''; }
}

function renderPicker(catKey, slotKey, label) {
  const level = state.profile.level;
  const lo = state.profile.loadout;
  $('armory-picker-title').textContent = label;
  const list = $('armory-picker');
  list.innerHTML = '';
  const items = Object.values(CATALOG[catKey]).sort((a, b) => a.unlock - b.unlock);
  for (const item of items) {
    const locked = level < item.unlock;
    const selected = lo[armoryTab][slotKey] === item.id;
    const el = document.createElement('div');
    el.className = 'list-item clickable' + (locked ? ' locked' : '') + (selected ? ' selected' : '');
    el.innerHTML = `<div><b>${item.name}</b><div class="meta">${itemStatLine(catKey, item)}${item.desc ? '<br>' + item.desc : ''}</div></div>
      ${locked ? `<span class="lock-tag">LVL ${item.unlock}</span>` : (selected ? '<span class="ok-tag">EQUIPPED</span>' : `<span class="meta">LVL ${item.unlock}</span>`)}`;
    if (!locked) el.onclick = async () => {
      lo[armoryTab][slotKey] = item.id;
      const r = await call('profile:loadout', { loadout: lo });
      if (r.loadout) state.profile.loadout = r.loadout;
      renderArmory(); renderPicker(catKey, slotKey, label);
    };
    else el.onclick = () => {
      const title = $('armory-picker-title');
      title.textContent = `🔒 ${item.name} UNLOCKS AT LEVEL ${item.unlock} (you are ${level})`;
      title.style.color = 'var(--err)';
      clearTimeout(title._t);
      title._t = setTimeout(() => { title.textContent = label; title.style.color = ''; }, 2200);
    };
    list.appendChild(el);
  }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

refreshChips();
