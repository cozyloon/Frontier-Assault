// Local player's arsenal: pilot weapons (primary/sidearm/AT/ordnance) and titan weapons.
// Hitscan raycasts + projectile spawns; reports hits to the server, fx to peers.
import * as THREE from 'three';
import { PILOT_PRIMARIES, PILOT_SIDEARMS, PILOT_AT, PILOT_ORDNANCE, TITAN_PRIMARIES, TITAN_ORDNANCE } from '/shared/data.js';
import { sfx, weaponSound } from './audio.js';

const CATS = {
  primary: PILOT_PRIMARIES, sidearm: PILOT_SIDEARMS, at: PILOT_AT,
  titanPrimary: TITAN_PRIMARIES, titanOrdnance: TITAN_ORDNANCE
};

function makeWeaponState(slot, id) {
  const def = CATS[slot][id];
  return {
    slot, id, def,
    ammo: def.mag, reserve: def.reserve ?? Infinity,
    cooldown: 0, reloading: 0, charge: 0,
    lock: { targetId: null, progress: 0, locks: [] },
    burstQueue: 0, burstTimer: 0
  };
}

export class Arsenal {
  constructor(game, loadout) {
    this.game = game;
    this.pilotSlots = [
      makeWeaponState('primary', loadout.pilot.primary),
      makeWeaponState('sidearm', loadout.pilot.sidearm),
      makeWeaponState('at', loadout.pilot.at)
    ];
    this.titanSlots = [
      makeWeaponState('titanPrimary', loadout.titan.primary)
    ];
    this.titanOrdnance = TITAN_ORDNANCE[loadout.titan.ordnance];
    this.titanOrdnanceCd = 0;
    this.ordnance = PILOT_ORDNANCE[loadout.pilot.ordnance];
    this.ordnanceLeft = this.ordnance.count;
    this.pilotIndex = 0;
    this.raycaster = new THREE.Raycaster();
    this.triggerHeld = false;
  }

  get current() {
    return this.game.mode === 'titan' ? this.titanSlots[0] : this.pilotSlots[this.pilotIndex];
  }

  switchTo(i) {
    if (this.game.mode === 'titan') return;
    if (i >= 0 && i < this.pilotSlots.length && i !== this.pilotIndex) {
      this.pilotIndex = i;
      const w = this.current;
      w.cooldown = Math.max(w.cooldown, 0.35);
      this.game.hud.setWeapon(w);
      this.game.refreshViewmodel();
      sfx.play('reload');
    }
  }

  reload() {
    const w = this.current;
    if (w.reloading > 0 || w.ammo === w.def.mag || w.reserve <= 0) return;
    w.reloading = w.def.reload;
    sfx.play('reload');
  }

  // ---------- firing ----------
  update(dt, camera, firing, aiming) {
    const w = this.current;
    if (w.cooldown > 0) w.cooldown -= dt;
    if (this.titanOrdnanceCd > 0) this.titanOrdnanceCd -= dt;
    if (w.reloading > 0) {
      w.reloading -= dt;
      if (w.reloading <= 0) {
        const take = Math.min(w.def.mag - w.ammo, w.reserve);
        w.ammo += take;
        if (w.reserve !== Infinity) w.reserve -= take;
      }
      this.game.hud.setWeapon(w);
      return;
    }

    // lock-on weapons
    if (w.def.lockOn) this.updateLock(w, dt, camera, aiming || firing);
    else this.game.hud.setLock(null);

    // charge weapons: hold to charge, fires at full charge
    if (w.def.chargeTime) {
      if (firing && w.ammo > 0 && w.cooldown <= 0) {
        w.charge += dt;
        this.game.hud.setCharge(Math.min(1, w.charge / w.def.chargeTime));
        if (w.charge >= w.def.chargeTime) {
          w.charge = 0;
          this.fireOnce(w, camera);
          this.game.hud.setCharge(0);
        }
      } else { w.charge = 0; this.game.hud.setCharge(0); }
      return;
    }

    // burst continuation
    if (w.burstQueue > 0) {
      w.burstTimer -= dt;
      if (w.burstTimer <= 0) {
        w.burstQueue--;
        w.burstTimer = 60 / w.def.rpm;
        this.fireOnce(w, camera, true);
      }
      return;
    }

    const canFire = firing && (w.def.auto || !this.triggerHeld);
    this.triggerHeld = firing;
    if (canFire && w.cooldown <= 0) {
      if (w.ammo <= 0) { this.reload(); return; }
      if (w.def.burst) {
        w.cooldown = Math.max(0.35, (60 / w.def.rpm) * w.def.burst + 0.22);
        w.burstQueue = w.def.burst - 1;
        w.burstTimer = 60 / w.def.rpm;
        this.fireOnce(w, camera, true);
      } else {
        w.cooldown = 60 / w.def.rpm;
        this.fireOnce(w, camera);
      }
    }
  }

  updateLock(w, dt, camera, seeking) {
    const L = w.def.lockOn;
    const g = this.game;
    // find candidate in view cone
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    let best = null, bestAngle = (L.fov * Math.PI / 180) / 2;
    for (const e of g.getEnemyTargets(true)) {
      const wantTitan = w.def.vsTitanOnly || w.slot === 'titanOrdnance';
      if (wantTitan && !e.isTitan) continue;
      if (w.id === 'smart_pistol' && e.isTitan) continue;
      if (e.cloaked) continue;   // lock-on can't acquire cloaked pilots
      const to = e.pos.clone().sub(camera.position);
      const dist = to.length();
      if (dist > L.range) continue;
      const ang = to.normalize().angleTo(fwd);
      if (ang < bestAngle && g.hasLineOfSight(camera.position, e.pos)) { best = e; bestAngle = ang; }
    }
    if (best && seeking !== false) {
      if (w.lock.targetId !== best.id) { w.lock.targetId = best.id; w.lock.progress = 0; }
      w.lock.progress += dt;
      if (w.lock.progress >= L.time && !w.lock.done) {
        w.lock.done = true;
        sfx.play('locked');
      } else if (!w.lock.done && Math.random() < dt * 6) sfx.play('lock');
    } else {
      w.lock.targetId = null; w.lock.progress = 0; w.lock.done = false;
    }
    this.game.hud.setLock(w.lock.targetId ? { done: w.lock.done, progress: Math.min(1, w.lock.progress / L.time) } : null);
  }

  fireOnce(w, camera, isBurstShot = false) {
    if (w.ammo <= 0) return;
    w.ammo--;
    const g = this.game;
    const from = camera.position.clone();
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const muzzle = from.clone().addScaledVector(fwd, 1.2);
    const heavy = w.slot === 'titanPrimary' || w.slot === 'at';
    sfx.play(weaponSound(w.def, w.slot));
    g.effects.muzzle(muzzle);
    g.kickRecoil(heavy ? 0.012 : 0.005);

    // -------- lock-on projectile weapons (Archer / slaved / MTMS) --------
    if (w.def.projectile?.homing && w.def.lockOn) {
      if (!w.lock.done) { w.ammo++; return; }  // needs lock
      g.projectiles.spawn({
        from: muzzle, dir: fwd, speed: w.def.projectile.speed,
        homingTargetId: w.lock.targetId, radius: 3,
        damage: { slot: w.slot, weapon: w.id }, color: 0xff6a2b, size: 0.3
      });
      g.sendFx({ type: 'rocket', from: muzzle.toArray(), dir: fwd.toArray(), speed: w.def.projectile.speed, target: w.lock.targetId });
      this.afterShot(w);
      return;
    }

    // -------- smart pistol --------
    if (w.id === 'smart_pistol' && w.lock.done && w.lock.targetId) {
      g.sendHit(w.lock.targetId, 'pilot', w.slot, w.id, false, 1);
      const tp = g.getTargetPos(w.lock.targetId);
      if (tp) { g.effects.tracer(muzzle, tp); g.sendFx({ type: 'tracer', from: muzzle.toArray(), to: tp.toArray() }); }
      w.lock.targetId = null; w.lock.progress = 0; w.lock.done = false;
      this.afterShot(w);
      return;
    }

    // -------- projectile weapons --------
    if (w.def.projectile) {
      const p = w.def.projectile;
      g.projectiles.spawn({
        from: muzzle, dir: this.spreadDir(fwd, w.def.spread || 0.01),
        speed: p.speed, gravity: p.gravity || 0, radius: p.radius ?? 3, magnet: p.magnet || 0,
        damage: { slot: w.slot, weapon: w.id }, color: 0xffb24d, size: heavy ? 0.3 : 0.18
      });
      g.sendFx({ type: 'rocket', from: muzzle.toArray(), dir: fwd.toArray(), speed: p.speed });
      this.afterShot(w);
      return;
    }

    // -------- hitscan --------
    const pellets = w.def.pellets || 1;
    const range = w.def.range || 200;
    const hits = {};  // targetId -> {count, headshot}
    let endPoint = null, worldHit = false;
    for (let i = 0; i < pellets; i++) {
      const dir = this.spreadDir(fwd, (w.def.spread || 0) * (this.game.aiming ? 0.35 : 1));
      this.raycaster.set(from, dir);
      this.raycaster.far = range * (w.def.beam ? 2 : 1.6);
      const hit = this.raycaster.intersectObjects(g.raycastTargets, true)[0];
      const end = hit ? hit.point : from.clone().addScaledVector(dir, range);
      if (i === 0) { endPoint = end; worldHit = !!hit && !hit.object.userData.playerId; }
      if (hit && hit.object.userData.gruntId) {
        const gid = hit.object.userData.gruntId;
        if (g.isEnemyGrunt(gid)) {
          hits[gid] = hits[gid] || { count: 0, headshot: false, part: 'pilot' };
          hits[gid].count++;
        }
        continue;
      }
      if (hit && hit.object.userData.playerId && hit.object.userData.playerId !== g.myId) {
        const pid = hit.object.userData.playerId;
        const part = hit.object.userData.part === 'titan' ? 'titan' : 'pilot';
        const head = hit.object.userData.part === 'head';
        if (!g.isEnemy(pid)) continue;
        // vortex shield check: victim titan blocking?
        if (part === 'titan' && g.isVortexBlocking(pid, from)) continue;
        hits[pid] = hits[pid] || { count: 0, headshot: false, part };
        hits[pid].count++;
        if (head) hits[pid].headshot = true;
      }
    }
    for (const [pid, info] of Object.entries(hits)) {
      g.sendHit(pid, info.part, w.slot, w.id, info.headshot, info.count);
    }
    if (endPoint) {
      if (w.def.beam) { g.effects.beam(muzzle, endPoint); g.sendFx({ type: 'beam', from: muzzle.toArray(), to: endPoint.toArray() }); }
      else { g.effects.tracer(muzzle, endPoint); g.sendFx({ type: 'tracer', from: muzzle.toArray(), to: endPoint.toArray() }); }
      if (worldHit) g.effects.impact(endPoint);
    }
    this.afterShot(w);
  }

  afterShot(w) {
    if (w.ammo <= 0 && w.reserve > 0) this.reload();
    this.game.hud.setWeapon(w);
  }

  spreadDir(fwd, spread) {
    return fwd.clone()
      .add(new THREE.Vector3((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2))
      .normalize();
  }

  // ---------- pilot ordnance (G) ----------
  throwOrdnance(camera) {
    const o = this.ordnance;
    if (this.game.mode === 'titan') { this.fireTitanOrdnance(camera); return; }
    if (o.remote) {
      // satchel: throw while any active? second press detonates
      if (this.game.projectiles.detonateRemotes() > 0) return;
    }
    if (this.ordnanceLeft <= 0) return;
    this.ordnanceLeft--;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    this.game.projectiles.spawn({
      from: camera.position.clone().addScaledVector(fwd, 1),
      dir: fwd.clone().add(new THREE.Vector3(0, 0.18, 0)).normalize(),
      speed: o.throwSpeed, gravity: 18, radius: o.radius,
      fuse: o.remote || o.proximity ? null : o.fuse,
      sticky: !!o.remote, proximity: o.proximity || 0, remoteDet: !!o.remote,
      damage: { slot: 'ordnance', weapon: o.id },
      color: o.arc ? 0x7ad7ff : 0xcccccc, size: 0.16, ttl: 30
    });
    sfx.play('jump');
    this.game.hud.setOrdnance(this.ordnanceLeft, o.name);
    // grenades regenerate slowly
    setTimeout(() => { this.ordnanceLeft = Math.min(o.count, this.ordnanceLeft + 1); this.game.hud.setOrdnance(this.ordnanceLeft, o.name); }, 15000);
  }

  // ---------- titan ordnance (G while embarked) ----------
  fireTitanOrdnance(camera) {
    const o = this.titanOrdnance;
    if (this.titanOrdnanceCd > 0) return;
    const g = this.game;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const n = o.rockets || o.bomblets || 6;
    // lock-based ordnance uses current titan primary lock? Use nearest enemy titan in view.
    let targetId = null;
    if (o.lockOn) {
      let bestA = (o.lockOn.fov * Math.PI / 180) / 2;
      for (const e of g.getEnemyTargets(true)) {
        const to = e.pos.clone().sub(camera.position);
        if (to.length() > o.lockOn.range) continue;
        const a = to.normalize().angleTo(fwd);
        if (a < bestA && g.hasLineOfSight(camera.position, e.pos)) { bestA = a; targetId = e.id; }
      }
      if (!targetId) { g.hud.hint('NO TARGET IN RETICLE'); return; }
    }
    this.titanOrdnanceCd = o.cooldown;
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        let from, dir;
        if (o.groundWave) {
          // Ronin Arc Wave: electric shockwave racing along the ground
          dir = fwd.clone(); dir.y = 0; dir.normalize();
          from = camera.position.clone(); from.y = 1.2;
          from.addScaledVector(dir, 3);
        } else {
          from = camera.position.clone()
            .add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.6, (Math.random() - 0.5) * 1.6));
          dir = (targetId ? fwd.clone() : this.spreadDir(fwd, 0.05)).add(new THREE.Vector3(0, 0.12, 0)).normalize();
        }
        g.projectiles.spawn({
          from, dir,
          speed: o.projectile.speed, radius: o.projectile.radius || 3,
          homingTargetId: targetId, gravity: 0, ttl: o.groundWave ? 2.2 : 6,
          damage: { slot: 'titanOrdnance', weapon: o.id },
          color: o.groundWave ? 0x7ad7ff : 0xff6a2b, size: o.groundWave ? 0.5 : 0.25
        });
        g.sendFx({ type: 'rocket', from: from.toArray(), dir: dir.toArray(), speed: o.projectile.speed, target: targetId });
        sfx.play(o.groundWave ? 'shot_energy' : 'shot_heavy');
      }, i * 90);
    }
    g.hud.setTitanOrdnanceCd(o);
  }
}
