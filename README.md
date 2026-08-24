# FRONTIER ASSAULT

A browser-based online PvP mech shooter inspired by **Titanfall 1 (2014)** — pilots with wall-running and double jumps, callable Titans that drop from orbit, embark/disembark, auto-titan AI, rodeo attacks, and the authentic Titanfall 1 progression system (levels 1–50, Gen 1–10 regeneration).

Built with **Node.js + Socket.io** (server: lobbies, matches, authoritative damage/XP) and **Three.js** (3D client). No build step, no game-engine download — players just open the website.

---

## Run it locally

```bash
npm install
npm start
# → http://localhost:3000
```

Everyone on your LAN can join via `http://<your-ip>:3000`.

## Host it publicly (so friends can create lobbies and play)

The whole game is one Node process serving HTTP + WebSockets on `PORT` (default 3000). Any Node host works:

> **Not Vercel/Netlify** — the game needs a long-running Node process with persistent WebSockets; serverless platforms can't host it. Use any of the hosts below.

**Render.com (free tier, easiest)**
1. Push this folder to a GitHub repo (`.gitignore` already excludes `node_modules/`, `data/`, and `.env`).
2. Render → New → Web Service → connect the repo.
3. Build command `npm install`, start command `npm start`. Done — Render sets `PORT` automatically.
4. In the service's **Environment** tab, add `DATABASE_URL` (see below) so player progression survives redeploys.

**Railway.app / Fly.io** — same story: point it at the repo, `npm start`, set `DATABASE_URL`.

**Your own VPS**
```bash
git clone <repo> && cd <repo> && npm install
PORT=80 node server/index.js       # or run behind nginx with a reverse proxy
```

### Player database (Neon Postgres)

Player profiles (accounts with scrypt-hashed passwords, XP, levels, loadouts, stats) are stored:
- in **Postgres** when the `DATABASE_URL` env var is set — recommended for any public hosting. Create a free database at [neon.tech](https://neon.tech), copy its connection string, and set it as `DATABASE_URL` (in your host's environment settings, or a local `.env` — see `.env.example`). The server creates its `players` table automatically on first boot.
- in a local **`data/players.json`** file when `DATABASE_URL` is unset — fine for local/LAN play, but free-tier hosts wipe the disk on redeploy.

---

## How to play

1. **Enlist** (register a callsign) — your XP, level and unlocks persist.
2. **Play → create or join a lobby** (map, max players, score & time limit). Host starts the match.
3. Fight as a **Pilot**, build your **Titan meter** (kills speed it up), then call **TITANFALL**.

### Controls
| Key | Action |
|---|---|
| WASD / Shift | Move / sprint (Titan: dash) |
| Space | Jump → double jump; hold near a wall while moving = **wall-run**; jump again to leap off |
| Mouse / RMB | Fire / aim (snipers scope) |
| 1 / 2 / 3 | Primary / Sidearm / Anti-Titan weapon |
| R, G, Q | Reload, Ordnance, Tactical ability |
| **V** | Call **Titanfall** when ready |
| **E** | Embark/disembark your Titan · **Rodeo** an enemy Titan (get close) |
| **X** | Eject from a doomed Titan |
| **F** | Auto-titan mode: Follow ↔ Guard |
| Tab / Esc | Scoreboard / pause |

### Titan combat
- Titans have a regenerating **shield** plus a hull. Health bars float above every Titan; the cockpit shows a big hull readout at the top of the windscreen. At 0 HP they go **DOOMED** — eject (X) or go down with the ship.
- Calling Titanfall (V) marks the drop zone with a glowing beam. After deployment, **V (or F) toggles the auto-titan between FOLLOW and GUARD**.
- Un-piloted Titans fight on their own (**auto-titan**).
- **Rodeo**: sprint up to an enemy Titan, press E, and unload into its hull. Counter it with Electric Smoke.

### Attrition (TF1-style)
- AI **grunt squads** fight along the streets for both teams, deploying by **drop pod or dropship**. Scoring: grunt kill **+1**, pilot kill **+4**, titan kill **+5**.
- **Melee (C)**: pilot kick (one-hit pilot kill), titan punch, or Ronin's broadsword.
- Matches open with a **dropship deployment intro** — you drop from the ship onto the battlefield.
- A voice announcer calls deployments, Titanfall status, doomed warnings, ejects, and match results.

---

## Progression (authentic Titanfall 1 unlock levels)

Level cap **50**, then **Regenerate** up to Gen 10. Kills, titan kills, rodeo damage, first blood, victories → XP.

**Pilot primaries** — R-101C Carbine (1) · Smart Pistol MK5 (5) · EVA-8 Shotgun (5) · R-97 SMG (6) · Longbow-DMR (9) · G2A4 Rifle (18) · Hemlok BF-R (29) · C.A.R. SMG (34) · Spitfire LMG (39) · Kraber-AP (44)

**Sidearms** — Hammond P2011 (1) · RE-45 Autopistol (11) · B3 Wingman (36)

**Anti-Titan** — Archer Heavy Rocket (1) · Sidewinder (14) · Mag Launcher (22) · Charge Rifle (33)

**Ordnance** — Frag (1) · Arc Grenade (7) · Satchel Charge (17) · Arc Mine (31)

**Pilot tacticals** — Cloak (1) · Stim (8) · Active Radar Pulse (19)

**Titan chassis** — Atlas (1) · Stryder (15) · Ogre (25) · **Ronin (35)** *(TF1 chassis unlocked via campaign, mapped to levels here; Ronin is a Titanfall 2 guest titan with the Leadwall shotgun, Arc Wave, Sword Block, and a broadsword melee)*

**Titan primaries** — XO-16 Chaingun (1) · 40mm Cannon (10) · Quad Rocket (10) · Plasma Railgun (12) · Arc Cannon (21) · Triple Threat (28)

**Titan ordnance** — Rocket Salvo (1) · Slaved Warheads (11) · Cluster Missile (24) · Multi-Target Missile System (32)

**Titan tacticals** — Vortex Shield (1) · Electric Smoke (12) · Particle Wall (26)

## Maps
- **Angel City** — dense urban blocks, wall-run alleys
- **Fracture** — open canyon dig site, titan country
- **Rise** — industrial walls and ramps built for momentum

---

*Fan project for private use. Titanfall is a trademark of Respawn Entertainment / EA; this project uses no assets from the game.*
