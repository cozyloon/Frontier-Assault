// =============================================================
// FRONTIER ASSAULT server — Express static hosting + Socket.io
// Lobbies, matches, authoritative damage/score/XP/titan meters.
// =============================================================
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import * as store from './store.js';
import {
  CATALOG, MATCH, MAPS, XP_EVENTS, GRUNTS, SCORE, MELEE, sanitizeLoadout, levelForXp
} from '../shared/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// load .env if present (DATABASE_URL etc.) — hosted platforms inject real env vars instead
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env — fine */ }

const PORT = process.env.PORT || 3000;

try {
  await store.initStore();
} catch (e) {
  console.error('[store] FATAL: could not initialize player storage.');
  console.error('        Check your DATABASE_URL (Neon connection string) or unset it to use the local JSON file.');
  console.error('        ' + e.message);
  process.exit(1);
}
if (process.env.TITAN_BUILD) MATCH.titanBuildTime = +process.env.TITAN_BUILD;   // test override

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
app.use('/vendor', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build')));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });

// ---------------- state ----------------
const lobbies = new Map();     // id -> lobby
let lobbySeq = 1;

function makeLobby(host, opts) {
  const id = 'L' + (lobbySeq++);
  const map = MAPS[opts.mapId] ? opts.mapId : 'angel_city';
  const lobby = {
    id,
    name: String(opts.name || `${host.name}'s lobby`).slice(0, 32),
    mapId: map,
    maxPlayers: Math.min(12, Math.max(2, opts.maxPlayers | 0 || MATCH.maxPlayersDefault)),
    scoreLimit: Math.min(200, Math.max(5, opts.scoreLimit | 0 || MATCH.scoreLimitDefault)),
    timeLimit: Math.min(1800, Math.max(120, opts.timeLimit | 0 || MATCH.timeLimitDefault)),
    hostId: host.socketId,
    state: 'waiting',          // waiting | ingame
    players: new Map(),        // socketId -> lobbyPlayer
    match: null
  };
  lobbies.set(id, lobby);
  return lobby;
}

function lobbySummary(l) {
  return {
    id: l.id, name: l.name, mapId: l.mapId, mapName: MAPS[l.mapId].name,
    players: l.players.size, maxPlayers: l.maxPlayers, state: l.state,
    scoreLimit: l.scoreLimit, timeLimit: l.timeLimit
  };
}

function lobbyDetail(l) {
  return {
    ...lobbySummary(l),
    hostId: l.hostId,
    roster: [...l.players.values()].map(p => ({
      id: p.socketId, name: p.name, level: p.level, gen: p.gen, team: p.team, ready: p.ready
    }))
  };
}

function broadcastLobby(l) { io.to(l.id).emit('lobby:update', lobbyDetail(l)); }

function pickTeam(l) {
  let imc = 0, mil = 0;
  for (const p of l.players.values()) p.team === 'imc' ? imc++ : mil++;
  return imc <= mil ? 'imc' : 'militia';
}

function leaveLobby(sock, notify = true) {
  const p = sock.data.player;
  if (!p || !p.lobbyId) return;
  const l = lobbies.get(p.lobbyId);
  p.lobbyId = null;
  if (!l) return;
  l.players.delete(sock.id);
  sock.leave(l.id);
  if (l.match) removeFromMatch(l, sock.id);
  if (l.players.size === 0) {
    if (l.match) clearInterval(l.match.tickTimer);
    lobbies.delete(l.id);
    return;
  }
  if (l.hostId === sock.id) l.hostId = [...l.players.keys()][0];
  if (notify) broadcastLobby(l);
}

// ---------------- match logic ----------------
function startMatch(l) {
  l.state = 'ingame';
  const match = {
    startedAt: Date.now(),
    timeLeft: l.timeLimit,
    scores: { imc: 0, militia: 0 },
    firstBloodTaken: false,
    players: new Map(),   // socketId -> matchPlayer
    grunts: new Map(),    // id -> grunt
    gruntSeq: 1,
    gruntSpawnIn: 5,      // first wave soon after start
    tickTimer: null
  };
  l.match = match;
  for (const lp of l.players.values()) addToMatch(l, lp);
  match.tickTimer = setInterval(() => matchTick(l), 1000);
  io.to(l.id).emit('match:start', matchStartPayload(l));
}

function matchStartPayload(l) {
  return {
    lobbyId: l.id, mapId: l.mapId, seed: MAPS[l.mapId].seed,
    scoreLimit: l.scoreLimit, timeLimit: l.timeLimit,
    timeLeft: l.match.timeLeft, scores: l.match.scores,
    players: [...l.match.players.values()].map(mpPublic)
  };
}

function mpPublic(mp) {
  return {
    id: mp.socketId, name: mp.name, team: mp.team, level: mp.level, gen: mp.gen,
    loadout: mp.loadout, kills: mp.kills, deaths: mp.deaths,
    mode: mp.mode, pilotHp: mp.pilotHp,
    titan: mp.titan ? titanPublic(mp.titan) : null
  };
}

function titanPublic(t) {
  return { chassis: t.chassis, shield: t.shield, maxShield: t.maxShield, hp: t.hp, maxHp: t.maxHp, doomed: t.doomed, embarked: t.embarked };
}

function addToMatch(l, lp) {
  const rec = store.getRecord(lp.name);
  const level = levelForXp(rec.xp);
  const mp = {
    socketId: lp.socketId, name: lp.name, team: lp.team, level, gen: rec.gen,
    loadout: sanitizeLoadout(rec.loadout, level),
    kills: 0, deaths: 0, titanKills: 0, xpEarned: 0, xpEvents: [],
    mode: 'pilot', pilotHp: MATCH.pilotHealth, lastDamagedAt: 0,
    meter: 0, meterActive: true,   // titanfall build meter (seconds)
    titan: null
  };
  l.match.players.set(lp.socketId, mp);
  return mp;
}

function removeFromMatch(l, socketId) {
  const m = l.match;
  if (!m) return;
  m.players.delete(socketId);
  io.to(l.id).emit('player:left', { id: socketId });
  const teams = new Set([...m.players.values()].map(p => p.team));
  if (m.players.size === 0) endMatch(l, 'empty');
}

function awardXp(l, mp, key, mult = 1) {
  const amount = Math.round((XP_EVENTS[key] || 0) * mult);
  if (!amount) return;
  mp.xpEarned += amount;
  mp.xpEvents.push({ key, amount });
  io.to(mp.socketId).emit('xp', { key, amount });
}

// ---------------- AI grunts (Attrition minions) ----------------
function gruntLanes(l) {
  const size = MAPS[l.mapId].size, half = size / 2, cell = size / 6;
  const xs = [];
  for (let i = 1; i <= 5; i++) xs.push(-half + cell * i);
  return { xs, half };
}

function spawnGruntSquads(l) {
  const m = l.match;
  const { xs, half } = gruntLanes(l);
  for (const team of ['imc', 'militia']) {
    const alive = [...m.grunts.values()].filter(g => g.team === team).length;
    const n = Math.min(GRUNTS.squadSize, GRUNTS.maxPerTeam - alive);
    if (n <= 0) continue;
    // whole squad arrives together: by drop pod or dropship, at one lane point
    const laneX = xs[Math.floor(Math.random() * xs.length)];
    const z = team === 'imc' ? -(half - 10) : (half - 10);
    const method = Math.random() < 0.5 ? 'pod' : 'ship';
    for (let i = 0; i < n; i++) {
      const id = 'g' + (m.gruntSeq++);
      m.grunts.set(id, {
        id, team, laneX,
        x: laneX + (Math.random() - 0.5) * 4,
        z: z + (Math.random() - 0.5) * 4,
        hp: GRUNTS.hp, fireCd: 0,
        hold: 4   // seconds hidden while the deployment animation plays
      });
    }
    io.to(l.id).emit('grunt:deploy', { method, pos: [laneX, z], team, count: n });
  }
}

function gruntTargets(m, team) {
  // enemy grunts + enemy pilots on foot (positions sampled from p:state)
  const out = [];
  for (const g of m.grunts.values()) if (g.team !== team && !g.hold) out.push({ kind: 'grunt', ref: g, x: g.x, y: 1.2, z: g.z });
  for (const mp of m.players.values()) {
    if (mp.team === team || mp.mode !== 'pilot' || mp.pilotHp <= 0 || !mp.lastPos) continue;
    if (mp.cloaked) continue;   // cloaked pilots are invisible to grunts (TF1 behavior)
    out.push({ kind: 'pilot', ref: mp, x: mp.lastPos[0], y: mp.lastPos[1], z: mp.lastPos[2] });
  }
  return out;
}

function killGrunt(l, grunt, killerMp) {
  const m = l.match;
  m.grunts.delete(grunt.id);
  io.to(l.id).emit('grunt:dead', { id: grunt.id, pos: [grunt.x, 0.9, grunt.z] });
  if (killerMp && killerMp.team !== grunt.team) {
    m.scores[killerMp.team] += SCORE.grunt;
    awardXp(l, killerMp, 'gruntKill');
    killerMp.meter = Math.min(MATCH.titanBuildTime, killerMp.meter + 4);
  }
}

function tickGrunts(l) {
  const m = l.match;
  m.gruntSpawnIn--;
  if (m.gruntSpawnIn <= 0) { m.gruntSpawnIn = GRUNTS.spawnInterval; spawnGruntSquads(l); }
  for (const g of m.grunts.values()) {
    if (g.hold > 0) { g.hold--; continue; }   // still aboard the pod / dropship
    if (g.fireCd > 0) g.fireCd--;
    const enemies = gruntTargets(m, g.team);
    let best = null, bd = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - g.x, e.z - g.z);
      if (d < bd) { bd = d; best = e; }
    }
    if (best && bd <= GRUNTS.engageRange) {
      if (g.fireCd <= 0) {
        g.fireCd = GRUNTS.fireInterval;
        io.to(l.id).emit('gruntfire', { from: [g.x, 1.4, g.z], to: [best.x, best.y + 0.6, best.z] });
        if (Math.random() < GRUNTS.hitChance) {
          if (best.kind === 'grunt') {
            best.ref.hp -= GRUNTS.dmgVsGrunt;
            if (best.ref.hp <= 0) killGrunt(l, best.ref, null);
          } else {
            applyPilotDamage(l, best.ref, null, GRUNTS.dmgVsPilot, 'grunt');
          }
        }
      }
    } else {
      // advance: align to lane, then push toward the enemy side (or nearest target)
      if (Math.abs(g.x - g.laneX) > 0.6) g.x += Math.sign(g.laneX - g.x) * GRUNTS.speed;
      else if (best) g.z += Math.sign(best.z - g.z) * GRUNTS.speed;
      else g.z += (g.team === 'imc' ? 1 : -1) * GRUNTS.speed;
    }
  }
  io.to(l.id).emit('grunts', [...m.grunts.values()].filter(g => !g.hold)
    .map(g => ({ id: g.id, team: g.team, x: +g.x.toFixed(1), z: +g.z.toFixed(1), hp: g.hp })));
}

function matchTick(l) {
  const m = l.match;
  if (!m) return;
  m.timeLeft--;
  tickGrunts(l);
  const meters = {};
  for (const mp of m.players.values()) {
    // titan build meter
    if (mp.meterActive && !mp.titan) {
      mp.meter = Math.min(MATCH.titanBuildTime, mp.meter + 1);
    }
    meters[mp.socketId] = { meter: mp.meter, ready: !mp.titan && mp.meter >= MATCH.titanBuildTime };
    // titan shield regen (8s after last damage)
    const t = mp.titan;
    if (t && !t.doomed && Date.now() - t.lastDamagedAt > 8000 && t.shield < t.maxShield) {
      t.shield = Math.min(t.maxShield, t.shield + t.maxShield * 0.12);
      io.to(l.id).emit('health', healthPayload(mp));
    }
    // pilot regen
    if (mp.mode !== 'dead' && mp.pilotHp > 0 && mp.pilotHp < MATCH.pilotHealth &&
        Date.now() - mp.lastDamagedAt > MATCH.pilotRegenDelay * 1000) {
      mp.pilotHp = Math.min(MATCH.pilotHealth, mp.pilotHp + MATCH.pilotRegenRate);
      io.to(mp.socketId).emit('health', healthPayload(mp));
    }
    // doomed titan countdown
    if (t && t.doomed && Date.now() >= t.detonateAt) destroyTitan(l, mp, t.lastAttacker);
  }
  io.to(l.id).emit('match:tick', { timeLeft: m.timeLeft, scores: m.scores, meters });
  if (m.timeLeft <= 0) return endMatch(l, 'time');
  if (m.scores.imc >= l.scoreLimit || m.scores.militia >= l.scoreLimit) return endMatch(l, 'score');
}

function healthPayload(mp) {
  return { id: mp.socketId, pilotHp: mp.pilotHp, mode: mp.mode, titan: mp.titan ? titanPublic(mp.titan) : null };
}

// Weapon lookup: slot -> catalog key
const SLOT_MAP = {
  primary: 'pilotPrimary', sidearm: 'pilotSidearm', at: 'pilotAT', ordnance: 'pilotOrdnance',
  titanPrimary: 'titanPrimary', titanOrdnance: 'titanOrdnance', titanTactical: 'titanTactical'
};

// Compute server-authoritative damage for a reported hit.
function computeDamage(attacker, slot, weaponId, part, headshot, pellets) {
  if (slot === 'melee') {
    const w = MELEE[weaponId];
    if (!w) return 0;
    return (part === 'titan' || part === 'rodeo') ? w.titanDamage : w.damage;
  }
  const cat = SLOT_MAP[slot];
  const w = cat && CATALOG[cat]?.[weaponId];
  if (!w) return 0;
  const n = Math.min(pellets || 1, w.pellets || w.rockets || w.bomblets || w.burst || 1);
  const vsTitan = part === 'titan' || part === 'rodeo';
  let dmg;
  if (slot === 'titanTactical') return weaponId === 'esmoke' ? Math.round((vsTitan ? w.dps : w.pilotDps) / 2) : 0;
  if (slot === 'ordnance') dmg = vsTitan ? w.titanDamage : w.damage;
  else if (slot === 'titanPrimary' || slot === 'titanOrdnance') dmg = vsTitan ? w.damage : (w.pilotDamage ?? w.damage);
  else if (slot === 'at') dmg = vsTitan ? w.damage : Math.round(w.damage * 0.15);
  else dmg = vsTitan ? Math.round(w.damage * 0.12) : w.damage;   // small arms barely scratch titans
  dmg *= n;
  if (!vsTitan && headshot && w.headshot) dmg = Math.round(dmg * w.headshot);
  if (part === 'rodeo') dmg = MATCH.rodeoDamage;                 // fixed per-shot rodeo damage into the hull
  return dmg;
}

function applyPilotDamage(l, victim, attacker, dmg, how) {
  if (victim.mode !== 'pilot' || victim.pilotHp <= 0) return;
  victim.pilotHp -= dmg;
  victim.lastDamagedAt = Date.now();
  if (victim.pilotHp <= 0) {
    victim.pilotHp = 0;
    victim.mode = 'dead';
    victim.deaths++;
    onKill(l, attacker, victim, how, false);
    io.to(l.id).emit('death', { victim: victim.socketId, killer: attacker?.socketId || null, how });
    setTimeout(() => {
      const m = l.match;
      if (!m || !m.players.has(victim.socketId)) return;
      victim.pilotHp = MATCH.pilotHealth;
      victim.mode = 'pilot';
      io.to(l.id).emit('respawn', { id: victim.socketId });
      io.to(l.id).emit('health', healthPayload(victim));
    }, MATCH.respawnDelay * 1000);
  }
  io.to(l.id).emit('health', healthPayload(victim));
}

function applyTitanDamage(l, victim, attacker, dmg, how, bypassShield) {
  const t = victim.titan;
  if (!t || t.hp <= 0 && t.doomed) { }
  if (!t) return;
  t.lastDamagedAt = Date.now();
  t.lastAttacker = attacker;
  if (!bypassShield && t.shield > 0) {
    const absorbed = Math.min(t.shield, dmg);
    t.shield -= absorbed;
    dmg -= absorbed;
  }
  if (dmg > 0 && !t.doomed) {
    t.hp -= dmg;
    if (t.hp <= 0) {
      t.hp = 0;
      t.doomed = true;
      t.detonateAt = Date.now() + MATCH.doomDuration * 1000;
      io.to(l.id).emit('titan:doomed', { id: victim.socketId });
    }
  }
  io.to(l.id).emit('health', healthPayload(victim));
}

function destroyTitan(l, owner, attacker) {
  const t = owner.titan;
  if (!t) return;
  const wasEmbarked = t.embarked;
  owner.titan = null;
  owner.meter = 0;
  io.to(l.id).emit('titan:dead', { id: owner.socketId, embarked: wasEmbarked });
  if (attacker && attacker.socketId !== owner.socketId && attacker.team !== owner.team) {
    const m = l.match;
    attacker.titanKills++;
    m.scores[attacker.team] += SCORE.titan;
    awardXp(l, attacker, attacker.mode === 'titan' ? 'titanKillByTitan' : 'titanKillByPilot');
    io.to(l.id).emit('killfeed', { killer: attacker.socketId, victim: owner.socketId, how: 'titan_destroyed' });
  }
  // pilot inside dies with the titan unless ejected
  if (wasEmbarked) {
    owner.mode = 'pilot'; // momentarily, applyPilotDamage flips to dead
    applyPilotDamage(l, owner, attacker && attacker.team !== owner.team ? attacker : null, 9999, 'titan_explosion');
  }
}

function onKill(l, attacker, victim, how, isTitanKill) {
  const m = l.match;
  if (!attacker || attacker.socketId === victim.socketId || attacker.team === victim.team) return;
  attacker.kills++;
  m.scores[attacker.team] += SCORE.pilot;
  awardXp(l, attacker, 'pilotKill');
  if (how === 'headshot') awardXp(l, attacker, 'headshotBonus');
  if (!m.firstBloodTaken) { m.firstBloodTaken = true; awardXp(l, attacker, 'firstBlood'); }
  // kills accelerate titan build
  attacker.meter = Math.min(MATCH.titanBuildTime, attacker.meter + MATCH.killTimeBonusPilot);
  io.to(l.id).emit('killfeed', { killer: attacker.socketId, victim: victim.socketId, how });
}

function endMatch(l, reason) {
  const m = l.match;
  if (!m) return;
  clearInterval(m.tickTimer);
  const winner = m.scores.imc === m.scores.militia ? null : (m.scores.imc > m.scores.militia ? 'imc' : 'militia');
  const results = [];
  for (const mp of m.players.values()) {
    awardXp(l, mp, 'matchComplete');
    if (winner && mp.team === winner) awardXp(l, mp, 'matchVictory');
    const profile = store.addXp(mp.name, mp.xpEarned);
    store.addStats(mp.name, {
      kills: mp.kills, deaths: mp.deaths, titanKills: mp.titanKills,
      matches: 1, wins: winner && mp.team === winner ? 1 : 0
    });
    results.push({
      id: mp.socketId, name: mp.name, team: mp.team,
      kills: mp.kills, deaths: mp.deaths, titanKills: mp.titanKills,
      xpEarned: mp.xpEarned, profile
    });
    const s = io.sockets.sockets.get(mp.socketId);
    if (s?.data?.player) s.data.player.profile = profile;
  }
  l.match = null;
  l.state = 'waiting';
  for (const lp of l.players.values()) lp.ready = false;
  io.to(l.id).emit('match:end', { reason, winner, scores: m.scores, results });
  broadcastLobby(l);
}

// ---------------- socket handling ----------------
io.on('connection', (sock) => {
  sock.data.player = null;

  const requireAuth = (cb) => {
    if (!sock.data.player) { cb && cb({ error: 'Not authenticated.' }); return null; }
    return sock.data.player;
  };
  const currentLobby = () => {
    const p = sock.data.player;
    return p?.lobbyId ? lobbies.get(p.lobbyId) : null;
  };
  const currentMatchPlayer = () => {
    const l = currentLobby();
    return l?.match?.players.get(sock.id) || null;
  };

  // ---- auth ----
  sock.on('auth:register', ({ name, pass } = {}, cb) => {
    const r = store.register(name, pass);
    if (r.profile) sock.data.player = { name: r.profile.name, socketId: sock.id, lobbyId: null, profile: r.profile };
    cb && cb(r);
  });
  sock.on('auth:login', ({ name, pass } = {}, cb) => {
    const r = store.login(name, pass);
    if (r.profile) {
      // kick ghost session with same name
      for (const [, s] of io.sockets.sockets) {
        if (s !== sock && s.data.player?.name?.toLowerCase() === r.profile.name.toLowerCase()) {
          leaveLobby(s); s.data.player = null; s.emit('kicked', { reason: 'Logged in elsewhere.' });
        }
      }
      sock.data.player = { name: r.profile.name, socketId: sock.id, lobbyId: null, profile: r.profile };
    }
    cb && cb(r);
  });
  sock.on('profile:loadout', ({ loadout } = {}, cb) => {
    const p = requireAuth(cb); if (!p) return;
    const lo = store.setLoadout(p.name, loadout);
    cb && cb({ loadout: lo });
  });
  const ack = (a, b) => (typeof a === 'function' ? a : b);   // tolerate (payload, cb) or (cb)
  sock.on('profile:regenerate', (a, b) => {
    const cb = ack(a, b);
    const p = requireAuth(cb); if (!p) return;
    cb && cb(store.regenerate(p.name));
  });
  sock.on('profile:get', (a, b) => {
    const cb = ack(a, b);
    const p = requireAuth(cb); if (!p) return;
    cb && cb({ profile: store.publicProfile(store.getRecord(p.name)) });
  });

  // ---- lobbies ----
  sock.on('lobby:list', (a, b) => {
    const cb = ack(a, b);
    cb && cb({ lobbies: [...lobbies.values()].map(lobbySummary) });
  });
  sock.on('lobby:create', (opts = {}, cb) => {
    const p = requireAuth(cb); if (!p) return;
    leaveLobby(sock);
    const l = makeLobby(p, opts);
    const lp = { socketId: sock.id, name: p.name, level: store.publicProfile(store.getRecord(p.name)).level, gen: p.profile.gen, team: 'imc', ready: false };
    l.players.set(sock.id, lp);
    p.lobbyId = l.id;
    sock.join(l.id);
    cb && cb({ lobby: lobbyDetail(l) });
    broadcastLobby(l);
  });
  sock.on('lobby:join', ({ id } = {}, cb) => {
    const p = requireAuth(cb); if (!p) return;
    const l = lobbies.get(id);
    if (!l) return cb && cb({ error: 'Lobby not found.' });
    if (l.players.size >= l.maxPlayers) return cb && cb({ error: 'Lobby is full.' });
    leaveLobby(sock);
    const prof = store.publicProfile(store.getRecord(p.name));
    const lp = { socketId: sock.id, name: p.name, level: prof.level, gen: prof.gen, team: pickTeam(l), ready: false };
    l.players.set(sock.id, lp);
    p.lobbyId = l.id;
    sock.join(l.id);
    cb && cb({ lobby: lobbyDetail(l), ingame: l.state === 'ingame' });
    broadcastLobby(l);
    if (l.state === 'ingame' && l.match) {
      // late join: drop straight into the running match
      const mp = addToMatch(l, lp);
      io.to(l.id).emit('player:joined', mpPublic(mp));
      sock.emit('match:start', matchStartPayload(l));
    }
  });
  sock.on('lobby:leave', () => leaveLobby(sock));
  sock.on('lobby:ready', ({ ready } = {}) => {
    const l = currentLobby(); if (!l) return;
    const lp = l.players.get(sock.id); if (!lp) return;
    lp.ready = !!ready;
    broadcastLobby(l);
  });
  sock.on('lobby:team', ({ team } = {}) => {
    const l = currentLobby(); if (!l || l.state === 'ingame') return;
    const lp = l.players.get(sock.id); if (!lp) return;
    if (team === 'imc' || team === 'militia') lp.team = team;
    broadcastLobby(l);
  });
  sock.on('lobby:start', (a, b) => {
    const cb = ack(a, b);
    const l = currentLobby();
    if (!l) return cb && cb({ error: 'Not in a lobby.' });
    if (l.hostId !== sock.id) return cb && cb({ error: 'Only the host can start.' });
    if (l.state === 'ingame') return cb && cb({ error: 'Already in game.' });
    startMatch(l);
    cb && cb({ ok: true });
  });
  sock.on('chat', ({ text } = {}) => {
    const p = sock.data.player; const l = currentLobby();
    if (!p || !l || typeof text !== 'string') return;
    io.to(l.id).emit('chat', { from: p.name, text: text.slice(0, 200) });
  });

  // ---- in-match: state relay ----
  sock.on('p:state', (state) => {
    const l = currentLobby();
    if (!l || !l.match) return;
    const mp = l.match.players.get(sock.id);
    if (mp && Array.isArray(state.pos)) mp.lastPos = state.pos;   // sampled for grunt AI targeting
    if (mp) mp.cloaked = !!state.cloak;                            // cloak hides pilots from grunt AI
    state.id = sock.id;
    sock.volatile.to(l.id).emit('p:state', state);
  });
  sock.on('fx', (fx) => {
    const l = currentLobby();
    if (!l || !l.match) return;
    fx.id = sock.id;
    sock.to(l.id).emit('fx', fx);
  });

  // ---- in-match: combat ----
  sock.on('hit', ({ target, part, slot, weapon, headshot, pellets } = {}) => {
    const l = currentLobby(); const m = l?.match;
    const attacker = currentMatchPlayer();
    if (!m || !attacker) return;
    // grunt hit?
    if (m.grunts.has(target)) {
      const grunt = m.grunts.get(target);
      if (grunt.team === attacker.team) return;
      const dmg = computeDamage(attacker, slot, weapon, 'pilot', !!headshot, pellets | 0);
      if (dmg <= 0) return;
      grunt.hp -= dmg;
      io.to(sock.id).emit('hitmarker', { target, dmg, part: 'grunt' });
      if (grunt.hp <= 0) killGrunt(l, grunt, attacker);
      return;
    }
    const victim = m.players.get(target);
    if (!victim || victim.team === attacker.team) return;
    const dmg = computeDamage(attacker, slot, weapon, part, !!headshot, pellets | 0);
    if (dmg <= 0) return;
    if (part === 'pilot') {
      if (victim.mode !== 'pilot') return;
      io.to(sock.id).emit('hitmarker', { target, dmg, headshot: !!headshot, part });
      applyPilotDamage(l, victim, attacker, dmg, headshot ? 'headshot' : weapon);
    } else if (part === 'titan' || part === 'rodeo') {
      if (!victim.titan) return;
      io.to(sock.id).emit('hitmarker', { target, dmg, part });
      if (part === 'rodeo') awardXp(l, attacker, 'rodeoDamage', 0.2);
      applyTitanDamage(l, victim, attacker, dmg, weapon, part === 'rodeo');
    }
  });

  // ---- titanfall / embark ----
  sock.on('titanfall:request', ({ pos } = {}, cb) => {
    const l = currentLobby(); const mp = currentMatchPlayer();
    if (!l || !mp) return cb && cb({ error: 'No match.' });
    if (mp.titan) return cb && cb({ error: 'Titan already deployed.' });
    if (mp.meter < MATCH.titanBuildTime) return cb && cb({ error: 'Titan not ready.' });
    const chassis = CATALOG.titanChassis[mp.loadout.titan.chassis];
    mp.titan = {
      chassis: chassis.id,
      maxShield: chassis.shield, shield: chassis.shield,
      maxHp: chassis.health, hp: chassis.health,
      doomed: false, embarked: false, lastDamagedAt: 0, lastAttacker: null
    };
    mp.meter = 0;
    io.to(l.id).emit('titanfall', { id: sock.id, pos, chassis: chassis.id });
    cb && cb({ ok: true });
  });
  sock.on('titan:embark', () => {
    const l = currentLobby(); const mp = currentMatchPlayer();
    if (!l || !mp?.titan || mp.titan.doomed) return;
    mp.titan.embarked = true;
    mp.mode = 'titan';
    io.to(l.id).emit('embark', { id: sock.id });
    io.to(l.id).emit('health', healthPayload(mp));
  });
  sock.on('titan:disembark', () => {
    const l = currentLobby(); const mp = currentMatchPlayer();
    if (!l || !mp?.titan) return;
    mp.titan.embarked = false;
    mp.mode = 'pilot';
    io.to(l.id).emit('disembark', { id: sock.id });
    io.to(l.id).emit('health', healthPayload(mp));
  });
  sock.on('titan:eject', () => {
    const l = currentLobby(); const mp = currentMatchPlayer();
    if (!l || !mp?.titan || !mp.titan.embarked) return;
    mp.titan.embarked = false;
    mp.mode = 'pilot';
    io.to(l.id).emit('eject', { id: sock.id });
    // ejecting from a doomed titan detonates it immediately
    if (mp.titan.doomed) destroyTitan(l, mp, mp.titan.lastAttacker);
    io.to(l.id).emit('health', healthPayload(mp));
  });

  sock.on('disconnect', () => leaveLobby(sock));
});

server.listen(PORT, () => {
  console.log(`FRONTIER ASSAULT server up on http://localhost:${PORT}`);
});
