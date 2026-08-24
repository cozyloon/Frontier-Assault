// Player account store — scrypt-hashed passwords, two persistence backends:
//   • Postgres (Neon/Supabase/any) when DATABASE_URL is set  → survives redeploys
//   • local data/players.json otherwise                       → zero-setup local play
// Runtime reads always hit the in-memory map; writes are debounced to the backend.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { levelForXp, sanitizeLoadout, defaultLoadout, MAX_LEVEL, MAX_GEN, xpForLevel } from '../shared/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'players.json');

let players = {};        // nameLower -> record (in-memory source of truth)
let pool = null;         // pg Pool when in Postgres mode
let saveTimer = null;    // JSON-file debounce
const dirty = new Set(); // Postgres mode: keys awaiting upsert
let flushTimer = null;

export async function initStore() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: pg } = await import('pg');
    const local = /localhost|127\.0\.0\.1/.test(url);
    pool = new pg.Pool({
      connectionString: url,
      ssl: local ? undefined : { rejectUnauthorized: false },   // Neon requires TLS
      max: 5
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        name_lower TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const res = await pool.query('SELECT name_lower, data FROM players');
    players = {};
    for (const row of res.rows) players[row.name_lower] = row.data;
    console.log(`[store] Postgres connected — ${res.rows.length} player profile(s) loaded`);
  } else {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
      try { players = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
      catch (e) { console.error('[store] Could not parse players.json, starting fresh:', e.message); players = {}; }
    }
    console.log('[store] Using local JSON file (set DATABASE_URL to persist profiles in Postgres/Neon)');
  }
}

// ---------------- persistence ----------------
function persist(key) {
  if (pool) {
    dirty.add(key);
    if (!flushTimer) flushTimer = setTimeout(flushDirty, 400);
  } else {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      fs.writeFile(FILE, JSON.stringify(players, null, 1), err => {
        if (err) console.error('[store] Save failed:', err.message);
      });
    }, 500);
  }
}

async function flushDirty() {
  flushTimer = null;
  const keys = [...dirty];
  dirty.clear();
  for (const key of keys) {
    const rec = players[key];
    if (!rec) continue;
    try {
      await pool.query(
        `INSERT INTO players (name_lower, data, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (name_lower) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [key, rec]
      );
    } catch (e) {
      console.error(`[store] DB save failed for ${key} (will retry):`, e.message);
      dirty.add(key);
      if (!flushTimer) flushTimer = setTimeout(flushDirty, 5000);
    }
  }
}

// ---------------- accounts ----------------
function hashPassword(pass, salt) {
  return crypto.scryptSync(pass, salt, 32).toString('hex');
}

const NAME_RE = /^[A-Za-z0-9_\-]{2,16}$/;

export function register(name, pass) {
  if (!NAME_RE.test(name || '')) return { error: 'Callsign must be 2-16 chars: letters, numbers, _ or -.' };
  if (typeof pass !== 'string' || pass.length < 4) return { error: 'Password must be at least 4 characters.' };
  const key = name.toLowerCase();
  if (players[key]) return { error: 'That callsign is already taken.' };
  const salt = crypto.randomBytes(12).toString('hex');
  players[key] = {
    name, salt, hash: hashPassword(pass, salt),
    xp: 0, gen: 1, kills: 0, deaths: 0, titanKills: 0, matches: 0, wins: 0,
    loadout: defaultLoadout(),
    created: Date.now()
  };
  persist(key);
  return { profile: publicProfile(players[key]) };
}

export function login(name, pass) {
  const key = (name || '').toLowerCase();
  const rec = players[key];
  if (!rec) return { error: 'Unknown callsign.' };
  if (rec.hash !== hashPassword(pass || '', rec.salt)) return { error: 'Wrong password.' };
  return { profile: publicProfile(rec) };
}

export function getRecord(name) { return players[(name || '').toLowerCase()] || null; }

export function publicProfile(rec) {
  const level = levelForXp(rec.xp);
  return {
    name: rec.name, xp: rec.xp, level, gen: rec.gen,
    nextLevelXp: level >= MAX_LEVEL ? null : xpForLevel(level + 1),
    curLevelXp: xpForLevel(level),
    kills: rec.kills, deaths: rec.deaths, titanKills: rec.titanKills,
    matches: rec.matches, wins: rec.wins,
    loadout: sanitizeLoadout(rec.loadout, level)
  };
}

export function addXp(name, amount) {
  const rec = getRecord(name);
  if (!rec) return null;
  rec.xp += Math.max(0, Math.round(amount));
  persist(name.toLowerCase());
  return publicProfile(rec);
}

export function addStats(name, { kills = 0, deaths = 0, titanKills = 0, matches = 0, wins = 0 }) {
  const rec = getRecord(name);
  if (!rec) return;
  rec.kills += kills; rec.deaths += deaths; rec.titanKills += titanKills;
  rec.matches += matches; rec.wins += wins;
  persist(name.toLowerCase());
}

export function setLoadout(name, loadout) {
  const rec = getRecord(name);
  if (!rec) return null;
  rec.loadout = sanitizeLoadout(loadout, levelForXp(rec.xp));
  persist(name.toLowerCase());
  return rec.loadout;
}

// Regeneration (prestige): at max level, reset XP, bump Gen.
export function regenerate(name) {
  const rec = getRecord(name);
  if (!rec) return { error: 'Unknown player.' };
  if (levelForXp(rec.xp) < MAX_LEVEL) return { error: 'You must reach level 50 to regenerate.' };
  if (rec.gen >= MAX_GEN) return { error: 'Already at maximum generation.' };
  rec.gen += 1; rec.xp = 0;
  persist(name.toLowerCase());
  return { profile: publicProfile(rec) };
}
