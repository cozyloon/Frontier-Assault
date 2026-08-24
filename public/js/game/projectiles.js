// Projectile simulation: rockets, grenades, mines. Owner's client deals damage.
import * as THREE from 'three';
import { sfx } from './audio.js';

export class Projectiles {
  constructor(scene, effects, game) {
    this.scene = scene;
    this.effects = effects;
    this.game = game;
    this.list = [];
  }

  spawn(opts) {
    // opts: from, dir, speed, gravity?, radius?, ttl?, homingTargetId?, magnet?,
    //       damage: {slot, weapon} | null (visual-only), color?, size?, fuse?,
    //       sticky?, proximity?, remoteDet? (satchel), directPart?
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(opts.size || 0.18, 8, 6),
      new THREE.MeshBasicMaterial({ color: opts.color ?? 0xffcf7a })
    );
    mesh.position.copy(opts.from);
    this.scene.add(mesh);
    const p = {
      mesh,
      pos: opts.from.clone(),
      vel: opts.dir.clone().normalize().multiplyScalar(opts.speed),
      gravity: opts.gravity || 0,
      radius: opts.radius ?? 3,
      ttl: opts.ttl ?? 6,
      homingTargetId: opts.homingTargetId || null,
      magnet: opts.magnet || 0,
      damage: opts.damage || null,
      fuse: opts.fuse ?? null,
      sticky: !!opts.sticky,
      proximity: opts.proximity || 0,
      remoteDet: !!opts.remoteDet,
      stuck: false,
      trail: opts.trail !== false
    };
    this.list.push(p);
    return p;
  }

  detonate(p) {
    p.dead = true;
    this.effects.explosion(p.pos, Math.max(2, p.radius), 0xff9a4d);
    sfx.play('explosion', this.game.distToCamera(p.pos));
    if (p.damage) {
      // AoE vs all enemy targets
      for (const e of this.game.getEnemyTargets(true)) {
        const d = e.pos.distanceTo(p.pos);
        if (d <= p.radius + (e.isTitan ? 2.2 : 0.9)) {
          this.game.sendHit(e.id, e.isTitan ? 'titan' : 'pilot', p.damage.slot, p.damage.weapon, false, 1);
        }
      }
      this.game.sendFx({ type: 'boom', pos: p.pos.toArray(), radius: p.radius });
    }
  }

  detonateRemotes() {   // satchel trigger
    let n = 0;
    for (const p of this.list) if (p.remoteDet && !p.dead) { this.detonate(p); n++; }
    return n;
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.dead) { this.scene.remove(p.mesh); this.list.splice(i, 1); continue; }
      p.ttl -= dt;
      if (p.fuse != null) { p.fuse -= dt; if (p.fuse <= 0) { this.detonate(p); continue; } }
      if (p.ttl <= 0) { if (p.damage && !p.remoteDet && !p.proximity) this.detonate(p); else p.dead = true; continue; }

      if (!p.stuck) {
        // homing
        if (p.homingTargetId) {
          const tgt = this.game.getTargetPos(p.homingTargetId);
          if (tgt) {
            const want = tgt.clone().sub(p.pos).normalize().multiplyScalar(p.vel.length());
            p.vel.lerp(want, Math.min(1, dt * 3.2));
          }
        }
        // magnetism toward nearest titan (Mag Launcher)
        if (p.magnet) {
          let best = null, bd = p.magnet;
          for (const e of this.game.getEnemyTargets(true)) {
            if (!e.isTitan) continue;
            const d = e.pos.distanceTo(p.pos);
            if (d < bd) { bd = d; best = e; }
          }
          if (best) {
            const want = best.pos.clone().sub(p.pos).normalize().multiplyScalar(p.vel.length());
            p.vel.lerp(want, Math.min(1, dt * 4));
          }
        }
        p.vel.y -= p.gravity * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.mesh.position.copy(p.pos);
        if (p.trail && Math.random() < 0.6) {
          this.effects.tracer(p.pos.clone().addScaledVector(p.vel, -dt * 2), p.pos, 0xff9a4d);
        }

        // direct hit vs enemies (owner-simulated only when damage set)
        if (p.damage) {
          for (const e of this.game.getEnemyTargets(true)) {
            const hitR = e.isTitan ? 2.4 : 0.8;
            if (e.pos.distanceTo(p.pos) < hitR) { this.detonate(p); break; }
          }
          if (p.dead) continue;
        }
        // world collision
        if (this.game.pointBlocked(p.pos)) {
          if (p.sticky || p.proximity) { p.stuck = true; p.vel.set(0, 0, 0); }
          else if (p.damage) { this.detonate(p); continue; }
          else { p.dead = true; this.effects.explosion(p.pos, 1.2, 0x999999); continue; }
        }
        if (p.pos.y < 0.1) {
          p.pos.y = 0.1;
          if (p.sticky || p.proximity) { p.stuck = true; p.vel.set(0, 0, 0); p.mesh.position.copy(p.pos); }
          else if (p.damage) { this.detonate(p); continue; }
          else { p.dead = true; continue; }
        }
      }
      // proximity mine trigger
      if (p.proximity && p.damage) {
        for (const e of this.game.getEnemyTargets(true)) {
          if (e.pos.distanceTo(p.pos) < p.proximity + (e.isTitan ? 2 : 0)) { this.detonate(p); break; }
        }
      }
    }
  }
}
