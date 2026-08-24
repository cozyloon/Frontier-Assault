// Client rendering + hit registration for server-simulated AI grunts.
import * as THREE from 'three';
import { teamColor, animateWalk, makeDropship, UNIT_BOX } from './models.js';
import { sfx } from './audio.js';

// drop pod: capsule that slams down and stays as a battlefield prop
function makePod(color) {
  const g = new THREE.Group();
  const hull = new THREE.MeshLambertMaterial({ color: 0x39424e });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c2026 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.1, 2.4, 8), hull);
  body.position.y = 1.35; g.add(body);
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.8, 8), dark);
  top.position.y = 2.95; g.add(top);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.97, 0.3, 8),
    new THREE.MeshLambertMaterial({ color: 0x101418, emissive: color, emissiveIntensity: 0.9 }));
  stripe.position.y = 1.9; g.add(stripe);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.5), dark);
    const a = i * Math.PI / 2;
    fin.position.set(Math.cos(a) * 1.0, 0.6, Math.sin(a) * 1.0);
    fin.rotation.y = -a;
    g.add(fin);
  }
  return g;
}

function makeGruntMesh(color) {
  const g = new THREE.Group();
  const suit = new THREE.MeshLambertMaterial({ color: 0x4a4740 });
  const accent = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x25231f });
  const glow = new THREE.MeshLambertMaterial({ color: 0x101418, emissive: color, emissiveIntensity: 0.85 });
  const part = (parent, mat, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(UNIT_BOX, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z); parent.add(m); return m;
  };
  // articulated legs (hip pivot at y=0.72)
  const anim = {};
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.1, 0.72, 0);
    part(leg, suit, 0.14, 0.62, 0.2, 0, -0.31, 0);
    part(leg, accent, 0.15, 0.09, 0.21, 0, -0.18, 0.01); // knee band
    part(leg, dark, 0.15, 0.1, 0.26, 0, -0.66, 0.03);    // boot
    g.add(leg);
    anim[s < 0 ? 'lLeg' : 'rLeg'] = leg;
  }
  g.userData.anim = anim;
  part(g, suit, 0.44, 0.5, 0.28, 0, 0.95, 0);            // torso
  part(g, accent, 0.34, 0.14, 0.3, 0, 1.1, 0.02);        // chest strap
  part(g, dark, 0.12, 0.1, 0.07, -0.1, 0.95, 0.15);      // chest pouch
  part(g, dark, 0.3, 0.34, 0.12, 0, 1.0, -0.19);         // backpack
  part(g, dark, 0.02, 0.3, 0.02, 0.12, 1.32, -0.2);      // radio antenna
  part(g, dark, 0.09, 0.09, 0.55, 0.16, 0.98, 0.25);     // rifle
  part(g, suit, 0.24, 0.24, 0.24, 0, 1.42, 0);           // head
  part(g, glow, 0.2, 0.05, 0.02, 0, 1.45, 0.13);         // team-lit visor
  part(g, dark, 0.26, 0.08, 0.26, 0, 1.55, 0);           // helmet
  part(g, accent, 0.27, 0.03, 0.27, 0, 1.52, 0);         // helmet team band
  g.scale.setScalar(0.92);                                // grunts are a touch smaller than pilots
  return g;
}

export class GruntManager {
  constructor(game) {
    this.game = game;
    this.grunts = new Map();   // id -> {mesh, target(Vector3), team, hp}
  }

  applySnapshot(list) {
    const seen = new Set();
    for (const s of list) {
      seen.add(s.id);
      let g = this.grunts.get(s.id);
      if (!g) {
        const mesh = makeGruntMesh(teamColor(s.team));
        mesh.traverse(o => { if (o.isMesh) { o.userData.gruntId = s.id; o.userData.hittable = true; o.castShadow = true; } });
        mesh.position.set(s.x, 0, s.z);
        this.game.scene.add(mesh);
        g = { mesh, target: new THREE.Vector3(s.x, 0, s.z), team: s.team, hp: s.hp };
        this.grunts.set(s.id, g);
        this.game.refreshTargets();
      }
      g.hp = s.hp;
      g.target.set(s.x, 0, s.z);
    }
    // remove stragglers not in snapshot (killed while we missed the event)
    for (const [id, g] of this.grunts) {
      if (!seen.has(id)) this.remove(id, false);
    }
  }

  remove(id, boom = true) {
    const g = this.grunts.get(id);
    if (!g) return;
    if (boom) {
      this.game.effects.sparks(g.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), 5, 0xff6a5a);
      sfx.play('death', this.game.distToCamera(g.mesh.position));
    }
    this.game.scene.remove(g.mesh);
    this.grunts.delete(id);
    this.game.refreshTargets();
  }

  // deployment animation: 'pod' slams down from orbit, 'ship' flies over and drops the squad
  playDeploy(method, pos, team) {
    const fx = this.game.effects;
    const p = new THREE.Vector3(pos[0], 0, pos[1]);
    const color = teamColor(team);
    if (method === 'pod') {
      const pod = makePod(color);
      pod.position.set(p.x, 150, p.z);
      pod.rotation.y = Math.random() * Math.PI;
      fx.add(pod, 25, (it) => {
        if (pod.position.y > 0.01) {
          pod.position.y = Math.max(0.01, pod.position.y - 85 * 0.016);
          if (Math.random() < 0.5) fx.tracer(
            pod.position.clone().add(new THREE.Vector3(0, 3.4, 0)),
            pod.position.clone().add(new THREE.Vector3(0, 6.5, 0)), 0xffa040);
          if (pod.position.y <= 0.01 && !pod.userData.landed) {
            pod.userData.landed = true;
            fx.shockwave(p.clone().add(new THREE.Vector3(0, 0.4, 0)), 10, 0xcfa96a);
            fx.sparks(p.clone().add(new THREE.Vector3(0, 1, 0)), 6, 0xffb27a);
            sfx.play('titanfall', this.game.distToCamera(p));
          }
        }
      });
    } else {
      const ship = makeDropship(color);
      ship.scale.setScalar(0.55);
      ship.rotation.y = Math.PI / 2;
      const y = 24;
      fx.add(ship, 5.5, (it, t) => {
        ship.position.set(p.x - 130 + 260 * t, y + Math.sin(it.life * 3) * 0.4, p.z);
        // squad fast-ropes out as the ship crosses the drop point
        if (t > 0.45 && t < 0.6 && Math.random() < 0.3) {
          fx.jets(new THREE.Vector3(p.x, y - 3 - Math.random() * 14, p.z));
        }
      });
      sfx.play('titanfall', Math.max(20, this.game.distToCamera(p)));
    }
  }

  fireFx(from, to) {
    const a = new THREE.Vector3().fromArray(from);
    const b = new THREE.Vector3().fromArray(to);
    this.game.effects.tracer(a, b, 0xffe9a0);
    sfx.play('shot_smg', this.game.distToCamera(a));
  }

  update(dt) {
    for (const g of this.grunts.values()) {
      const before = g.mesh.position.clone();
      g.mesh.position.lerp(g.target, Math.min(1, dt * 4));
      const moved = g.mesh.position.distanceTo(before);
      const d = g.target.clone().sub(g.mesh.position);
      if (d.lengthSq() > 0.05) g.mesh.rotation.y = Math.atan2(d.x, d.z);
      // walk cycle driven by actual movement
      g.walkPhase = (g.walkPhase || 0) + moved * 4.5;
      animateWalk(g.mesh, g.walkPhase, Math.min(0.55, (moved / Math.max(dt, 0.001)) * 0.18));
    }
  }

  // enemy grunt entries for lock-on / AoE / titan AI targeting
  enemyEntries(myTeam) {
    const out = [];
    for (const [id, g] of this.grunts) {
      if (g.team === myTeam) continue;
      out.push({ id, pos: g.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), isTitan: false, isGrunt: true });
    }
    return out;
  }

  meshes() { return [...this.grunts.values()].map(g => g.mesh); }

  dispose() { for (const id of [...this.grunts.keys()]) this.remove(id, false); }
}
