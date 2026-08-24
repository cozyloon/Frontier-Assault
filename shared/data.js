// =============================================================
// FRONTIER ASSAULT — shared game data (server + client)
// Arsenal, unlock levels and progression modeled on Titanfall 1 (2014).
// Sources: Titanfall wiki / IGN Levels-and-Unlocks / community unlock lists.
// Note: in TF1 the Stryder/Ogre chassis unlocked by finishing the campaign;
// this game has no campaign, so they are mapped to levels 15 / 25.
// =============================================================

export const MAX_LEVEL = 50;
export const MAX_GEN = 10;

// Cumulative XP required to reach a level (index by level, 1-based).
export function xpForLevel(level) {
  const n = Math.max(0, level - 1);
  return Math.round(120 * n * n + 380 * n);
}
export function levelForXp(xp) {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}

// AI grunt minions (Attrition-style)
export const GRUNTS = {
  maxPerTeam: 8, squadSize: 4, spawnInterval: 40,
  hp: 50, speed: 2.6, engageRange: 32, fireInterval: 1,
  dmgVsGrunt: 12, dmgVsPilot: 5, hitChance: 0.55
};
// Attrition scoring
export const SCORE = { grunt: 1, pilot: 4, titan: 5 };

// Melee attacks (pilot jump-kick kills pilots outright, TF1 style)
export const MELEE = {
  pilot_melee: { name: 'Melee', damage: 100, titanDamage: 0, range: 3.0, cooldown: 0.9 },
  titan_punch: { name: 'Titan Punch', damage: 140, titanDamage: 350, range: 6.5, cooldown: 1.3 },
  ronin_sword: { name: 'Broadsword', damage: 300, titanDamage: 900, range: 8.5, cooldown: 1.1 }
};

// XP awards (server authoritative)
export const XP_EVENTS = {
  gruntKill: 25,
  pilotKill: 100,
  titanKillByPilot: 350,   // killing a titan as a pilot (AT weapons / rodeo)
  titanKillByTitan: 250,
  autoTitanKill: 100,      // your auto-titan got the kill
  rodeoDamage: 25,
  executionBonus: 25,
  firstBlood: 50,
  matchComplete: 300,
  matchVictory: 300,
  headshotBonus: 15
};

// ---------------- Pilot primary weapons ----------------
export const PILOT_PRIMARIES = {
  r101: { id: 'r101', name: 'R-101C Carbine', type: 'Assault Rifle', unlock: 1,
    damage: 25, headshot: 1.75, rpm: 700, mag: 24, reserve: 168, reload: 1.9,
    spread: 0.012, range: 90, auto: true, hitscan: true },
  smart_pistol: { id: 'smart_pistol', name: 'Smart Pistol MK5', type: 'Smart Pistol', unlock: 5,
    damage: 34, headshot: 1.0, rpm: 340, mag: 12, reserve: 84, reload: 1.7,
    spread: 0.02, range: 35, auto: false, hitscan: true, lockOn: { time: 1.1, fov: 22, range: 30, killLocks: 3 } },
  eva8: { id: 'eva8', name: 'EVA-8 Shotgun', type: 'Shotgun', unlock: 5,
    damage: 12, headshot: 1.3, rpm: 140, mag: 6, reserve: 42, reload: 2.6,
    spread: 0.06, range: 22, auto: true, hitscan: true, pellets: 8 },
  r97: { id: 'r97', name: 'R-97 Compact SMG', type: 'SMG', unlock: 6,
    damage: 16, headshot: 1.5, rpm: 900, mag: 30, reserve: 210, reload: 1.7,
    spread: 0.02, range: 45, auto: true, hitscan: true },
  longbow: { id: 'longbow', name: 'Longbow-DMR Sniper', type: 'Sniper', unlock: 9,
    damage: 90, headshot: 2.0, rpm: 80, mag: 5, reserve: 30, reload: 2.6,
    spread: 0.001, range: 300, auto: false, hitscan: true, scope: 6 },
  g2a4: { id: 'g2a4', name: 'G2A4 Rifle', type: 'Precision Rifle', unlock: 18,
    damage: 50, headshot: 2.0, rpm: 310, mag: 12, reserve: 84, reload: 2.0,
    spread: 0.004, range: 160, auto: false, hitscan: true },
  hemlok: { id: 'hemlok', name: 'Hemlok BF-R', type: 'Burst Rifle', unlock: 29,
    damage: 30, headshot: 1.75, rpm: 750, mag: 18, reserve: 126, reload: 2.1,
    spread: 0.01, range: 110, auto: false, hitscan: true, burst: 3 },
  car: { id: 'car', name: 'C.A.R. SMG', type: 'SMG', unlock: 34,
    damage: 20, headshot: 1.5, rpm: 780, mag: 24, reserve: 168, reload: 1.8,
    spread: 0.015, range: 60, auto: true, hitscan: true },
  spitfire: { id: 'spitfire', name: 'Spitfire LMG', type: 'LMG', unlock: 39,
    damage: 28, headshot: 1.5, rpm: 480, mag: 45, reserve: 180, reload: 3.2,
    spread: 0.03, spreadSettle: 0.008, range: 120, auto: true, hitscan: true },
  kraber: { id: 'kraber', name: 'Kraber-AP Sniper', type: 'Sniper', unlock: 44,
    damage: 160, headshot: 2.0, rpm: 40, mag: 4, reserve: 24, reload: 3.0,
    spread: 0.0, range: 400, auto: false, hitscan: true, scope: 8, boltAction: true }
};

// ---------------- Sidearms ----------------
export const PILOT_SIDEARMS = {
  p2011: { id: 'p2011', name: 'Hammond P2011', type: 'Pistol', unlock: 1,
    damage: 30, headshot: 2.0, rpm: 380, mag: 12, reserve: 60, reload: 1.4,
    spread: 0.006, range: 60, auto: false, hitscan: true },
  re45: { id: 're45', name: 'RE-45 Autopistol', type: 'Machine Pistol', unlock: 11,
    damage: 15, headshot: 1.5, rpm: 850, mag: 15, reserve: 90, reload: 1.5,
    spread: 0.025, range: 35, auto: true, hitscan: true },
  wingman: { id: 'wingman', name: 'B3 Wingman', type: 'Revolver', unlock: 36,
    damage: 55, headshot: 2.0, rpm: 160, mag: 6, reserve: 36, reload: 1.9,
    spread: 0.004, range: 90, auto: false, hitscan: true }
};

// ---------------- Anti-titan weapons ----------------
export const PILOT_AT = {
  archer: { id: 'archer', name: 'Archer Heavy Rocket', type: 'Lock-on Launcher', unlock: 1,
    damage: 500, rpm: 30, mag: 1, reserve: 6, reload: 2.4, projectile: { speed: 55, homing: true },
    lockOn: { time: 1.6, fov: 14, range: 140 }, vsTitanOnly: true },
  sidewinder: { id: 'sidewinder', name: 'Sidewinder', type: 'Micro-Missile SMG', unlock: 14,
    damage: 55, rpm: 420, mag: 12, reserve: 72, reload: 2.0, projectile: { speed: 70 } },
  mag_launcher: { id: 'mag_launcher', name: 'Mag Launcher', type: 'Magnetic GL', unlock: 22,
    damage: 190, rpm: 130, mag: 4, reserve: 24, reload: 2.2, projectile: { speed: 38, gravity: 8, magnet: 12 } },
  charge_rifle: { id: 'charge_rifle', name: 'Charge Rifle', type: 'Charged Beam', unlock: 33,
    damage: 450, rpm: 30, mag: 1, reserve: 8, reload: 2.2, hitscan: true, chargeTime: 1.4, beam: true }
};

// ---------------- Pilot ordnance ----------------
export const PILOT_ORDNANCE = {
  frag: { id: 'frag', name: 'Frag Grenade', unlock: 1, damage: 120, titanDamage: 150, radius: 6, fuse: 2.4, count: 2, throwSpeed: 22 },
  arc_grenade: { id: 'arc_grenade', name: 'Arc Grenade', unlock: 7, damage: 85, titanDamage: 300, radius: 7, fuse: 1.8, count: 2, throwSpeed: 22, arc: true },
  satchel: { id: 'satchel', name: 'Satchel Charge', unlock: 17, damage: 200, titanDamage: 650, radius: 7, remote: true, count: 2, throwSpeed: 14 },
  arc_mine: { id: 'arc_mine', name: 'Arc Mine', unlock: 31, damage: 120, titanDamage: 500, radius: 6, proximity: 5, count: 2, throwSpeed: 12 }
};

// ---------------- Pilot tactical abilities ----------------
export const PILOT_TACTICALS = {
  cloak: { id: 'cloak', name: 'Cloak', unlock: 1, duration: 9, cooldown: 15,
    desc: 'Bend light around you. Near-invisible to Titans, faint shimmer to pilots.' },
  stim: { id: 'stim', name: 'Stim', unlock: 8, duration: 5, cooldown: 12, speedMult: 1.45, healPerSec: 20,
    desc: 'Adrenaline surge: greatly increased speed and rapid health regeneration.' },
  radar: { id: 'radar', name: 'Active Radar Pulse', unlock: 19, duration: 6, cooldown: 14, range: 80,
    desc: 'Sonar pulse reveals enemies through walls.' }
};

// ---------------- Titan chassis ----------------
// TF1: Atlas default; Stryder = complete 1 campaign; Ogre = complete both.
// Adapted here to level unlocks 15 / 25.
export const TITAN_CHASSIS = {
  atlas: { id: 'atlas', name: 'Atlas', unlock: 1, role: 'All-rounder',
    health: 4200, shield: 1000, speed: 9.5, dashes: 2, dashCooldown: 5, scale: 1.0,
    desc: 'The versatile workhorse of the Frontier. Balanced armor and mobility.' },
  stryder: { id: 'stryder', name: 'Stryder', unlock: 15, role: 'Speed',
    health: 3200, shield: 900, speed: 12.5, dashes: 3, dashCooldown: 3.5, scale: 0.92,
    desc: 'Lean high-speed chassis. Three dash cells, lighter armor. (TF1: campaign unlock)' },
  ogre: { id: 'ogre', name: 'Ogre', unlock: 25, role: 'Tank',
    health: 5400, shield: 1100, speed: 7.5, dashes: 1, dashCooldown: 6, scale: 1.1,
    desc: 'Heavily armored brawler built to absorb punishment. (TF1: campaign unlock)' },
  ronin: { id: 'ronin', name: 'Ronin', unlock: 35, role: 'Skirmisher',
    health: 3400, shield: 900, speed: 12.8, dashes: 2, dashCooldown: 2.8, scale: 0.9,
    desc: 'Sword-bearing hit-and-run chassis. Get close, hit hard, phase out. (Titanfall 2 guest titan)' }
};

// ---------------- Titan primary weapons ----------------
export const TITAN_PRIMARIES = {
  xo16: { id: 'xo16', name: 'XO-16 Chaingun', unlock: 1,
    damage: 110, pilotDamage: 60, rpm: 600, mag: 40, reload: 2.6, spread: 0.015, range: 180, auto: true, hitscan: true },
  cannon40: { id: 'cannon40', name: '40mm Cannon', unlock: 10,
    damage: 400, pilotDamage: 120, rpm: 150, mag: 5, reload: 2.4, projectile: { speed: 120, radius: 3 }, auto: false },
  quad_rocket: { id: 'quad_rocket', name: 'Quad Rocket', unlock: 10,
    damage: 190, pilotDamage: 90, rpm: 500, mag: 4, burst: 4, reload: 2.8, projectile: { speed: 60, radius: 4 }, auto: false },
  railgun: { id: 'railgun', name: 'Plasma Railgun', unlock: 12,
    damage: 1400, pilotDamage: 200, rpm: 40, mag: 1, reload: 1.2, hitscan: true, chargeTime: 1.6, beam: true },
  arc_cannon: { id: 'arc_cannon', name: 'Arc Cannon', unlock: 21,
    damage: 900, pilotDamage: 250, rpm: 45, mag: 1, reload: 1.4, hitscan: true, chargeTime: 1.8, chain: 2, beam: true },
  triple_threat: { id: 'triple_threat', name: 'Triple Threat', unlock: 28,
    damage: 320, pilotDamage: 110, rpm: 110, mag: 3, burst: 3, reload: 2.6, projectile: { speed: 32, gravity: 12, radius: 4 }, auto: false },
  leadwall: { id: 'leadwall', name: 'Leadwall', unlock: 35,
    damage: 95, pilotDamage: 45, rpm: 180, mag: 6, reload: 2.4, spread: 0.055, range: 70, auto: false, hitscan: true, pellets: 6 }
};

// ---------------- Titan ordnance ----------------
export const TITAN_ORDNANCE = {
  rocket_salvo: { id: 'rocket_salvo', name: 'Rocket Salvo', unlock: 1, damage: 90, rockets: 8, cooldown: 11, projectile: { speed: 70, radius: 3 } },
  slaved_warheads: { id: 'slaved_warheads', name: 'Slaved Warheads', unlock: 11, damage: 110, rockets: 6, cooldown: 13, lockOn: { time: 1.2, fov: 18, range: 160 }, projectile: { speed: 55, homing: true, radius: 3 } },
  cluster_missile: { id: 'cluster_missile', name: 'Cluster Missile', unlock: 24, damage: 60, bomblets: 14, duration: 4, cooldown: 15, projectile: { speed: 80, radius: 8 } },
  mtms: { id: 'mtms', name: 'Multi-Target Missile System', unlock: 32, damage: 150, rockets: 8, maxTargets: 4, cooldown: 16, lockOn: { time: 0.6, fov: 25, range: 180 }, projectile: { speed: 65, homing: true, radius: 3 } },
  arc_wave: { id: 'arc_wave', name: 'Arc Wave', unlock: 35, damage: 700, rockets: 1, cooldown: 10, groundWave: true, projectile: { speed: 42, radius: 6 } }
};

// ---------------- Titan tactical abilities ----------------
export const TITAN_TACTICALS = {
  vortex: { id: 'vortex', name: 'Vortex Shield', unlock: 1, duration: 2.5, cooldown: 13, block: true,
    desc: 'Catch incoming bullets and rockets, then hurl them back.' },
  sword_block: { id: 'sword_block', name: 'Sword Block', unlock: 35, duration: 3.5, cooldown: 12, block: true,
    desc: 'Raise the broadsword to deflect frontal fire. (Ronin)' },
  esmoke: { id: 'esmoke', name: 'Electric Smoke', unlock: 12, duration: 6, cooldown: 14, dps: 220, pilotDps: 45, radius: 9,
    desc: 'Damaging electric smoke — cooks rodeoing pilots and blinds titans.' },
  pwall: { id: 'pwall', name: 'Particle Wall', unlock: 26, duration: 8, cooldown: 15, wallHealth: 2000,
    desc: 'Deployable energy barrier: blocks enemy fire, yours passes through.' }
};

// ---------------- Titanfall / match constants ----------------
export const MATCH = {
  titanBuildTime: 150,         // seconds until titanfall ready (TF1 ~ 4min, tuned down)
  killTimeBonusPilot: 12,      // seconds shaved off build time per pilot kill
  killTimeBonusTitan: 40,
  titanCoreBuildTime: 120,     // once in titan: core (damage boost) charge
  respawnDelay: 4,
  pilotHealth: 100,
  pilotRegenDelay: 4,
  pilotRegenRate: 40,
  doomDuration: 6,             // doomed titan seconds before detonation
  rodeoDamage: 90,             // per rodeo shot into the hull
  scoreLimitDefault: 50,
  timeLimitDefault: 600,       // 10 min
  maxPlayersDefault: 12
};

export const MAPS = {
  angel_city: { id: 'angel_city', name: 'Angel City', desc: 'Dense urban blocks, tight alleys, wall-run heaven.', size: 260, seed: 1337, theme: 'city' },
  fracture:   { id: 'fracture', name: 'Fracture', desc: 'Open dig site with scattered structures. Titan country.', size: 320, seed: 4242, theme: 'canyon' },
  rise:       { id: 'rise', name: 'Rise', desc: 'Massive parallel walls and ramps built for momentum.', size: 280, seed: 9001, theme: 'industrial' }
};

export const FACTIONS = { imc: { id: 'imc', name: 'IMC', color: 0x4da3ff }, militia: { id: 'militia', name: 'Militia', color: 0xffb24d } };

// Default loadouts for a fresh pilot
export function defaultLoadout() {
  return {
    pilot: { primary: 'r101', sidearm: 'p2011', at: 'archer', ordnance: 'frag', tactical: 'cloak' },
    titan: { chassis: 'atlas', primary: 'xo16', ordnance: 'rocket_salvo', tactical: 'vortex' }
  };
}

// Aggregate catalog for armory UI / validation
export const CATALOG = {
  pilotPrimary: PILOT_PRIMARIES,
  pilotSidearm: PILOT_SIDEARMS,
  pilotAT: PILOT_AT,
  pilotOrdnance: PILOT_ORDNANCE,
  pilotTactical: PILOT_TACTICALS,
  titanChassis: TITAN_CHASSIS,
  titanPrimary: TITAN_PRIMARIES,
  titanOrdnance: TITAN_ORDNANCE,
  titanTactical: TITAN_TACTICALS
};

export function isUnlocked(slotKey, itemId, level) {
  const item = CATALOG[slotKey]?.[itemId];
  return !!item && level >= item.unlock;
}

// Validate & sanitize a loadout against a player's level; fall back to defaults.
export function sanitizeLoadout(lo, level) {
  const d = defaultLoadout();
  const pick = (slotKey, cur, dflt) => (cur && isUnlocked(slotKey, cur, level)) ? cur : dflt;
  return {
    pilot: {
      primary: pick('pilotPrimary', lo?.pilot?.primary, d.pilot.primary),
      sidearm: pick('pilotSidearm', lo?.pilot?.sidearm, d.pilot.sidearm),
      at: pick('pilotAT', lo?.pilot?.at, d.pilot.at),
      ordnance: pick('pilotOrdnance', lo?.pilot?.ordnance, d.pilot.ordnance),
      tactical: pick('pilotTactical', lo?.pilot?.tactical, d.pilot.tactical)
    },
    titan: {
      chassis: pick('titanChassis', lo?.titan?.chassis, d.titan.chassis),
      primary: pick('titanPrimary', lo?.titan?.primary, d.titan.primary),
      ordnance: pick('titanOrdnance', lo?.titan?.ordnance, d.titan.ordnance),
      tactical: pick('titanTactical', lo?.titan?.tactical, d.titan.tactical)
    }
  };
}
