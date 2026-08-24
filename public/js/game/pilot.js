// First-person pilot controller: sprint, double jump, wall-running, tacticals.
import * as THREE from 'three';
import { moveWithCollisions, probeWall } from './world.js';
import { PILOT_TACTICALS } from '/shared/data.js';
import { sfx } from './audio.js';

const GRAV = -26;
const WALK = 7, SPRINT = 10.5, AIR_CTRL = 4.5;
const JUMP = 9.5;
const HALF = new THREE.Vector3(0.4, 0.9, 0.4);
export const PILOT_EYE = 1.62;

export class PilotController {
  constructor(input, colliders, tacticalId) {
    this.input = input;
    this.colliders = colliders;
    this.pos = new THREE.Vector3(0, HALF.y, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.jumpsLeft = 2;
    this.wallRun = null;          // {normal, along, time}
    this.wallRunCooldown = 0;
    this.tactical = PILOT_TACTICALS[tacticalId] || PILOT_TACTICALS.cloak;
    this.tacticalActive = 0;      // remaining seconds
    this.tacticalCooldown = 0;
    this.speedMult = 1;
    this.alive = true;
    this.frozen = false;          // rodeo / embarked
  }

  get eyePos() { return this.pos.clone().add(new THREE.Vector3(0, PILOT_EYE - HALF.y, 0)); }
  get cloaked() { return this.tactical.id === 'cloak' && this.tacticalActive > 0; }
  get stimmed() { return this.tactical.id === 'stim' && this.tacticalActive > 0; }
  get radarActive() { return this.tactical.id === 'radar' && this.tacticalActive > 0; }

  spawn(v) {
    this.pos.copy(v); this.pos.y = Math.max(this.pos.y, HALF.y);
    this.vel.set(0, 0, 0);
    this.jumpsLeft = 2; this.wallRun = null;
    this.tacticalActive = 0; this.tacticalCooldown = 0;
  }

  useTactical() {
    if (this.tacticalCooldown > 0 || this.tacticalActive > 0) return false;
    this.tacticalActive = this.tactical.duration;
    this.tacticalCooldown = this.tactical.cooldown + this.tactical.duration;
    return true;
  }

  applyLook(dx, dy, sens = 0.0022) {
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  jumpPressed() {
    if (this.wallRun) {
      // wall jump: leap away from the wall
      const n = this.wallRun.normal;
      this.vel.x += n.x * 8; this.vel.z += n.z * 8;
      this.vel.y = JUMP * 0.95;
      this.wallRun = null;
      this.wallRunCooldown = 0.3;
      this.jumpsLeft = 1;
      sfx.play('jets');
      return 'walljump';
    }
    if (this.onGround) {
      this.vel.y = JUMP;
      this.jumpsLeft = 1;
      sfx.play('jump');
      return 'jump';
    } else if (this.jumpsLeft > 0) {
      this.vel.y = JUMP * 0.92;
      this.jumpsLeft--;
      sfx.play('jets');
      return 'doublejump';
    }
  }

  update(dt) {
    if (this.frozen) return {};
    const inp = this.input;
    // timers
    if (this.tacticalActive > 0) this.tacticalActive -= dt;
    if (this.tacticalCooldown > 0) this.tacticalCooldown -= dt;
    if (this.wallRunCooldown > 0) this.wallRunCooldown -= dt;

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    let wish = new THREE.Vector3();
    if (inp.down('KeyW')) wish.add(fwd);
    if (inp.down('KeyS')) wish.sub(fwd);
    if (inp.down('KeyD')) wish.add(right);
    if (inp.down('KeyA')) wish.sub(right);
    const moving = wish.lengthSq() > 0;
    if (moving) wish.normalize();

    const sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
    let speed = (sprint ? SPRINT : WALK) * this.speedMult * (this.stimmed ? this.tactical.speedMult : 1);

    // ---- wall-run ----
    if (this.wallRun) {
      const wr = this.wallRun;
      wr.time += dt;
      const stillWall = probeWall(this.pos, wr.normal.clone().negate(), HALF.x + 0.35, this.colliders);
      const holdingIn = inp.down('KeyW') || inp.down('Space');
      if (!stillWall || !holdingIn || wr.time > 2.2 || this.onGround) {
        this.wallRun = null;
        this.wallRunCooldown = 0.25;
      } else {
        // run along the wall
        const along = wr.along;
        const runSpeed = Math.max(speed * 1.15, 11);
        this.vel.x = along.x * runSpeed;
        this.vel.z = along.z * runSpeed;
        this.vel.y = Math.max(this.vel.y - 4 * dt, -2.2);  // gentle slide down
      }
    } else if (!this.onGround && this.wallRunCooldown <= 0 && moving) {
      // try to attach to a side wall
      for (const side of [right, right.clone().negate()]) {
        const hit = probeWall(this.pos, side, HALF.x + 0.35, this.colliders);
        if (hit && this.vel.y < 6) {
          const n = hit.normal;
          // direction along wall closest to our heading
          const along = new THREE.Vector3(-n.z, 0, n.x);
          if (along.dot(fwd) < 0) along.negate();
          if (Math.abs(along.dot(fwd)) < 0.3) continue;   // hitting wall head-on: no run
          this.wallRun = { normal: n, along, time: 0 };
          this.jumpsLeft = Math.max(this.jumpsLeft, 1);
          break;
        }
      }
    }

    // ---- normal movement ----
    if (!this.wallRun) {
      if (this.onGround) {
        const target = wish.multiplyScalar(speed);
        this.vel.x += (target.x - this.vel.x) * Math.min(1, dt * 12);
        this.vel.z += (target.z - this.vel.z) * Math.min(1, dt * 12);
      } else if (moving) {
        this.vel.x += wish.x * AIR_CTRL * dt * speed * 0.35;
        this.vel.z += wish.z * AIR_CTRL * dt * speed * 0.35;
        const hs = Math.hypot(this.vel.x, this.vel.z);
        const max = speed * 1.25;
        if (hs > max) { this.vel.x *= max / hs; this.vel.z *= max / hs; }
      }
      this.vel.y += GRAV * dt;
    }

    const res = moveWithCollisions(this.pos, this.vel, dt, HALF, this.colliders);
    this.onGround = res.onGround;
    if (this.onGround) { this.jumpsLeft = 2; this.wallRun = null; }
    return { wallRunning: !!this.wallRun };
  }
}
