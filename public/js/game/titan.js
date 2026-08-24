// Titan entity (shared visuals), embarked driving controls and auto-titan AI.
import * as THREE from 'three';
import { moveWithCollisions } from './world.js';
import { TITAN_CHASSIS } from '/shared/data.js';
import { makeTitanMesh, animateWalk } from './models.js';
import { sfx } from './audio.js';

export const TITAN_HALF = new THREE.Vector3(1.4, 2.3, 1.4);
export const TITAN_EYE = 3.9;   // above feet
const GRAV = -30;

export class TitanEntity {
  constructor(scene, chassisId, color, ownerId) {
    this.chassis = TITAN_CHASSIS[chassisId] || TITAN_CHASSIS.atlas;
    this.ownerId = ownerId;
    this.scene = scene;
    this.mesh = makeTitanMesh(chassisId, color);
    this.mesh.scale.setScalar(this.chassis.scale);
    this.mesh.traverse(o => { if (o.isMesh) { o.userData.playerId = ownerId; o.userData.part = 'titan'; } });
    scene.add(this.mesh);
    this.pos = new THREE.Vector3();          // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.falling = true;                     // titanfall drop animation
    this.landed = false;
    this.dashesLeft = this.chassis.dashes;
    this.dashTimer = 0;
    this.dashVel = new THREE.Vector3();
    this.aiMode = 'follow';                  // follow | guard
    this.guardPoint = new THREE.Vector3();
    this.doomed = false;
    this.smokeUntil = 0;
    this.vortexUntil = 0;

    // overhead health bar (canvas sprite): shield + hull + doom state
    this.hbCanvas = document.createElement('canvas');
    this.hbCanvas.width = 128; this.hbCanvas.height = 26;
    this.hbTex = new THREE.CanvasTexture(this.hbCanvas);
    this.healthBar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.hbTex, depthTest: false, transparent: true }));
    this.healthBar.raycast = () => {};   // UI-only: must never block or crash weapon raycasts
    this.healthBar.scale.set(4.4, 0.9, 1);
    this.healthBar.position.y = 5.6 * this.chassis.scale;
    this.mesh.add(this.healthBar);
    this.updateHealthBar(this.chassis.shield, this.chassis.shield, this.chassis.health, this.chassis.health, false);
  }

  updateHealthBar(shield, maxShield, hp, maxHp, doomed) {
    const x = this.hbCanvas.getContext('2d');
    x.clearRect(0, 0, 128, 26);
    x.fillStyle = '#000a'; x.fillRect(0, 0, 128, 26);
    if (doomed) {
      x.fillStyle = '#ff2030'; x.font = 'bold 13px Consolas,monospace'; x.textAlign = 'center';
      x.fillText('⚠ DOOMED ⚠', 64, 18);
    } else {
      // shield strip
      x.fillStyle = '#123'; x.fillRect(3, 3, 122, 7);
      x.fillStyle = '#4da3ff'; x.fillRect(3, 3, 122 * Math.max(0, shield / maxShield), 7);
      // hull strip (green → orange → red by remaining)
      const frac = Math.max(0, hp / maxHp);
      x.fillStyle = '#1a2214'; x.fillRect(3, 12, 122, 11);
      x.fillStyle = frac > 0.5 ? '#57d97a' : frac > 0.25 ? '#ffb24d' : '#ff5560';
      x.fillRect(3, 12, 122 * frac, 11);
      // doom-limit tick at 0 (right edge marker showing destroy threshold)
      x.fillStyle = '#fff';
      x.fillRect(3, 12, 1.5, 11);
    }
    this.hbTex.needsUpdate = true;
  }

  beginFall(pos) {
    this.pos.set(pos.x, 120, pos.z);
    this.landPos = new THREE.Vector3(pos.x, 0, pos.z);
    this.falling = true; this.landed = false;
    this.updateMesh();
  }

  updateFall(dt, effects) {
    if (!this.falling) return false;
    this.pos.y -= 90 * dt;
    // re-entry flame trail
    if (Math.random() < 0.7) {
      const p = this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 4 + Math.random() * 3, (Math.random() - 0.5) * 2));
      effects.tracer(p, p.clone().add(new THREE.Vector3(0, 6, 0)), 0xffa040);
    }
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.falling = false; this.landed = true;
      effects.explosion(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), 8, 0xcfa96a);
      effects.shockwave(this.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 22, 0xcfa96a);
      sfx.play('titanfall');
    }
    this.updateMesh();
    return this.falling;
  }

  // physics step for locally-simulated titans (mine)
  step(dt, colliders, wishDir, speedScale = 1) {
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.vel.x = this.dashVel.x; this.vel.z = this.dashVel.z;
    } else {
      const speed = this.chassis.speed * speedScale;
      const tx = wishDir.x * speed, tz = wishDir.z * speed;
      this.vel.x += (tx - this.vel.x) * Math.min(1, dt * 6);
      this.vel.z += (tz - this.vel.z) * Math.min(1, dt * 6);
    }
    this.vel.y += GRAV * dt;
    const center = this.pos.clone(); center.y += TITAN_HALF.y;
    moveWithCollisions(center, this.vel, dt, TITAN_HALF, colliders);
    this.pos.set(center.x, center.y - TITAN_HALF.y, center.z);
    // dash cell regen
    if (this.dashesLeft < this.chassis.dashes) {
      this.dashRegen = (this.dashRegen || 0) + dt;
      if (this.dashRegen >= this.chassis.dashCooldown) { this.dashRegen = 0; this.dashesLeft++; }
    }
    // stride animation from actual ground speed
    const gs = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase = (this.walkPhase || 0) + gs * dt * 1.6;
    animateWalk(this.mesh, this.walkPhase, Math.min(0.4, gs * 0.045));
    this.updateMesh();
  }

  dash(dir) {
    if (this.dashesLeft <= 0 || this.dashTimer > 0) return false;
    this.dashesLeft--;
    this.dashTimer = 0.32;
    this.dashVel.set(dir.x, 0, dir.z).normalize().multiplyScalar(38);
    sfx.play('dash');
    return true;
  }

  get eyePos() { return this.pos.clone().add(new THREE.Vector3(0, TITAN_EYE * this.chassis.scale, 0)); }
  get centerPos() { return this.pos.clone().add(new THREE.Vector3(0, 2.3 * this.chassis.scale, 0)); }

  updateMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  setDoomed() {
    if (this.doomed) return;
    this.doomed = true;
    this.mesh.traverse(o => { if (o.isMesh && o.material?.color) o.material = o.material.clone(); });
    this._flash = 0;
  }

  updateDoomFlash(dt) {
    if (!this.doomed) return;
    this._flash = (this._flash || 0) + dt;
    const on = Math.sin(this._flash * 10) > 0;
    this.mesh.traverse(o => { if (o.isMesh && o.material?.emissive) o.material.emissive.setHex(on ? 0x661111 : 0x000000); });
  }

  dispose() { this.scene.remove(this.mesh); }
}

// ---------------- Auto-titan AI (runs on the OWNER's client) ----------------
export class TitanAI {
  constructor(titan, game) {
    this.t = titan;
    this.game = game;      // needs: game.getEnemyTargets(), game.fireTitanShot(from,dir,targetInfo)
    this.fireTimer = 0;
    this.burstLeft = 0;
    this.repathTimer = 0;
    this.wish = new THREE.Vector3();
  }

  update(dt) {
    const t = this.t;
    if (t.falling || t.doomed) return;
    const enemies = this.game.getEnemyTargets();   // [{id, pos, isTitan}]
    // acquire nearest visible enemy
    let best = null, bestD = 140;
    for (const e of enemies) {
      const d = e.pos.distanceTo(t.centerPos);
      if (d < bestD && this.game.hasLineOfSight(t.eyePos, e.pos)) { best = e; bestD = d; }
    }
    // face target
    if (best) {
      const dir = best.pos.clone().sub(t.centerPos);
      const targetYaw = Math.atan2(-dir.x, -dir.z);
      let dy = targetYaw - t.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      t.yaw += THREE.MathUtils.clamp(dy, -2.2 * dt, 2.2 * dt);
      // fire when roughly on target
      this.fireTimer -= dt;
      if (Math.abs(dy) < 0.15 && this.fireTimer <= 0) {
        this.fireTimer = 0.14;
        const from = t.eyePos.add(new THREE.Vector3(-Math.sin(t.yaw), 0, -Math.cos(t.yaw)).multiplyScalar(1.5));
        const aim = best.pos.clone()
          .add(new THREE.Vector3((Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 2.2))
          .sub(from).normalize();
        this.game.fireAutoTitanShot(from, aim, best);
      }
    }
    // movement
    this.repathTimer -= dt;
    if (this.repathTimer <= 0) {
      this.repathTimer = 0.4;
      this.wish.set(0, 0, 0);
      const anchor = t.aiMode === 'follow' ? this.game.getOwnerPos() : t.guardPoint;
      const toAnchor = anchor.clone().sub(t.pos); toAnchor.y = 0;
      const dAnchor = toAnchor.length();
      if (dAnchor > (t.aiMode === 'follow' ? 9 : 3)) {
        this.wish.copy(toAnchor.normalize());
      }
    }
    t.step(dt, this.game.world.colliders, this.wish, 0.85);
  }
}
