// Remote player representation: pilot mesh + titan mesh, interpolation, name tags.
import * as THREE from 'three';
import { makePilotMesh, makeNameSprite, teamColor, animateWalk } from './models.js';
import { TitanEntity } from './titan.js';

export class RemotePlayer {
  constructor(scene, info) {
    // info: {id, name, team, level, gen, loadout, mode, titan}
    this.scene = scene;
    this.id = info.id;
    this.name = info.name;
    this.team = info.team;
    this.loadout = info.loadout;
    this.mode = info.mode || 'pilot';

    this.mesh = makePilotMesh(teamColor(info.team));
    this.mesh.traverse(o => { if (o.isMesh) { o.userData.playerId = info.id; if (!o.userData.part) o.userData.part = 'pilot'; } });
    this.nameTag = makeNameSprite(`${info.name} [${info.level}]`, info.team === 'imc' ? '#4da3ff' : '#ffb24d');
    this.nameTag.position.y = 2.2;
    this.mesh.add(this.nameTag);
    scene.add(this.mesh);

    this.titan = null;          // TitanEntity
    this.titanTarget = { pos: new THREE.Vector3(), yaw: 0 };
    this.target = { pos: new THREE.Vector3(0, -100, 0), yaw: 0 };
    this.mesh.position.copy(this.target.pos);
    this.cloaked = false;
    this.vortexActive = false;
    this.titanVortexActive = false;
    this.dead = false;
    this.lastState = null;
  }

  ensureTitan(chassisId) {
    if (this.titan) return this.titan;
    this.titan = new TitanEntity(this.scene, chassisId, teamColor(this.team), this.id);
    return this.titan;
  }

  removeTitan() {
    if (this.titan) { this.titan.dispose(); this.titan = null; }
  }

  applyState(s) {
    this.lastState = s;
    if (s.pos) this.target.pos.fromArray(s.pos);
    if (s.yaw != null) this.target.yaw = s.yaw;
    this.mode = s.mode || this.mode;
    this.cloaked = !!s.cloak;
    this.vortexActive = !!s.vortex;
    if (s.titan && this.titan) {
      this.titanTarget.pos.fromArray(s.titan.pos);
      this.titanTarget.yaw = s.titan.yaw;
      this.titanVortexActive = !!s.titan.vortex;
    }
  }

  update(dt) {
    // pilot body: hidden while embarked or dead
    const showPilot = this.mode === 'pilot' && !this.dead;
    this.mesh.visible = showPilot;
    if (showPilot) {
      const before = this.mesh.position.clone();
      this.mesh.position.lerp(this.target.pos, Math.min(1, dt * 14));
      const moved = this.mesh.position.distanceTo(before);
      this.walkPhase = (this.walkPhase || 0) + moved * 5.5;
      animateWalk(this.mesh, this.walkPhase, Math.min(0.7, (moved / Math.max(dt, 0.001)) * 0.09));
      this.mesh.rotation.y += shortestAngle(this.mesh.rotation.y, this.target.yaw) * Math.min(1, dt * 14);
      const op = this.cloaked ? 0.12 : 1;
      this.mesh.traverse(o => {
        if (o.isMesh && o.material) {
          o.material.transparent = this.cloaked;
          o.material.opacity = op;
        }
      });
      this.nameTag.visible = !this.cloaked;
    }
    if (this.titan && !this.titan.falling) {
      const tBefore = this.titan.pos.clone();
      this.titan.pos.lerp(this.titanTarget.pos, Math.min(1, dt * 12));
      const tMoved = this.titan.pos.distanceTo(tBefore);
      this.titanWalkPhase = (this.titanWalkPhase || 0) + tMoved * 1.6;
      animateWalk(this.titan.mesh, this.titanWalkPhase, Math.min(0.4, (tMoved / Math.max(dt, 0.001)) * 0.045));
      this.titan.yaw += shortestAngle(this.titan.yaw, this.titanTarget.yaw) * Math.min(1, dt * 12);
      this.titan.updateMesh();
      this.titan.updateDoomFlash(dt);
    }
  }

  pilotCenter() { return this.mesh.position.clone().add(new THREE.Vector3(0, 1.1, 0)); }

  dispose() {
    this.scene.remove(this.mesh);
    this.removeTitan();
  }
}

function shortestAngle(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
