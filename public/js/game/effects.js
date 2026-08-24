// Lightweight visual effects: tracers, explosions, jump jets, smoke, shields.
import * as THREE from 'three';

// Shared geometries for high-frequency effects — never disposed (see update()).
const SPARK_GEO = new THREE.BoxGeometry(0.09, 0.09, 0.09);
const STREAK_GEO = new THREE.BoxGeometry(0.05, 0.05, 0.05);
const SPHERE_GEO = new THREE.SphereGeometry(1, 12, 10);
const SPHERE_LO_GEO = new THREE.SphereGeometry(1, 8, 6);
const CONE_GEO = new THREE.ConeGeometry(0.09, 0.55, 7);
for (const g of [SPARK_GEO, STREAK_GEO, SPHERE_GEO, SPHERE_LO_GEO, CONE_GEO]) g.userData.shared = true;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];   // {obj, life, ttl, update?}
  }

  add(obj, ttl, update) {
    this.scene.add(obj);
    this.items.push({ obj, life: 0, ttl, update });
  }

  tracer(from, to, color = 0xffe08a) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.add(line, 0.07, (it, t) => { mat.opacity = 0.9 * (1 - t); });
  }

  beam(from, to, color = 0x7ad7ff) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, linewidth: 3 });
    this.add(new THREE.Line(geo, mat), 0.25, (it, t) => { mat.opacity = 1 - t; });
  }

  explosion(pos, radius = 4, color = 0xff8a3d) {
    // fireball
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const s = new THREE.Mesh(SPHERE_GEO, mat);
    s.position.copy(pos);
    this.add(s, 0.45, (it, t) => {
      s.scale.setScalar(0.3 + t * radius);
      mat.opacity = 0.85 * (1 - t);
    });
    // inner white core
    const cMat = new THREE.MeshBasicMaterial({ color: 0xfff2cc, transparent: true, opacity: 1 });
    const core = new THREE.Mesh(SPHERE_LO_GEO, cMat);
    core.position.copy(pos);
    this.add(core, 0.2, (it, t) => { core.scale.setScalar(0.2 + t * radius * 0.5); cMat.opacity = 1 - t; });
    // shockwave ring
    this.shockwave(pos, radius * 2.2, color);
    // debris sparks
    this.sparks(pos, Math.min(10, 4 + radius), color);
    const light = new THREE.PointLight(color, 80, radius * 7);
    light.position.copy(pos);
    this.add(light, 0.35, (it, t) => { light.intensity = 80 * (1 - t); });
    if (this.onShake) this.onShake(pos, radius);
  }

  shockwave(pos, maxR = 8, color = 0xffc27a) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 28), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, Math.max(0.15, pos.y - 1), pos.z);
    this.add(ring, 0.5, (it, t) => {
      ring.scale.setScalar(0.5 + t * maxR);
      mat.opacity = 0.6 * (1 - t);
    });
  }

  sparks(pos, count = 6, color = 0xffc27a) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(
        SPARK_GEO,
        new THREE.MeshBasicMaterial({ color: Math.random() < 0.4 ? 0xfff2cc : color, transparent: true })
      );
      m.position.copy(pos);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 14, Math.random() * 9 + 2, (Math.random() - 0.5) * 14);
      this.add(m, 0.5 + Math.random() * 0.3, (it, t) => {
        vel.y -= 28 * 0.016;
        m.position.addScaledVector(vel, 0.016);
        m.material.opacity = 1 - t;
      });
    }
  }

  // titanfall drop-point marker: glowing sky beam + pulsing ground ring
  dropMarker(pos, color = 0xff6a2b, ttl = 4) {
    const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.6, 130, 12, 1, true), beamMat);
    beam.position.set(pos.x, 65, pos.z);
    this.add(beam, ttl, (it, t) => {
      beamMat.opacity = (0.3 + Math.sin(it.life * 9) * 0.12) * (1 - t * t);
    });
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.0, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.15, pos.z);
    this.add(ring, ttl, (it, t) => {
      ring.scale.setScalar(1 + Math.sin(it.life * 5) * 0.12);
      ringMat.opacity = 0.7 * (1 - t * t);
    });
  }

  // Ronin sword slash: glowing arc sweep
  slash(pos, yaw) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x9ad7ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const arc = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.6, 24, 1, 0, Math.PI * 0.85), mat);
    arc.position.copy(pos);
    arc.rotation.order = 'YXZ';
    arc.rotation.set(0.4, yaw, 0);
    this.add(arc, 0.28, (it, t) => {
      arc.rotation.z = -t * 2.4;
      arc.scale.setScalar(1 + t * 0.6);
      mat.opacity = 0.85 * (1 - t);
    });
    const light = new THREE.PointLight(0x9ad7ff, 30, 12);
    light.position.copy(pos);
    this.add(light, 0.2, (it, t) => { light.intensity = 30 * (1 - t); });
  }

  // bullet impact on world geometry
  impact(pos) {
    this.sparks(pos, 3, 0xffd27a);
    const light = new THREE.PointLight(0xffd27a, 6, 4);
    light.position.copy(pos);
    this.add(light, 0.08);
  }

  muzzle(pos, color = 0xffd27a) {
    const light = new THREE.PointLight(color, 12, 8);
    light.position.copy(pos);
    this.add(light, 0.06);
  }

  smoke(pos, radius, ttl, color = 0x3a4a55, electric = true) {
    const group = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(
        SPHERE_LO_GEO,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 })
      );
      m.scale.setScalar(radius * (0.3 + Math.random() * 0.4));
      m.position.set((Math.random() - 0.5) * radius, Math.random() * radius * 0.7, (Math.random() - 0.5) * radius);
      group.add(m);
    }
    group.position.copy(pos);
    this.add(group, ttl, (it, t) => {
      group.children.forEach((m, i) => {
        m.material.opacity = 0.35 * (1 - t);
        if (electric && Math.random() < 0.05) m.material.color.setHex(Math.random() < 0.5 ? 0x9ad7ff : color);
      });
    });
    return group;
  }

  shieldDome(getPos, radius, color, ttlCheck) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide, wireframe: true });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 10), mat);
    this.add(dome, Infinity, (it) => {
      if (!ttlCheck()) { it.ttl = 0; return; }
      dome.position.copy(getPos());
    });
    return dome;
  }

  particleWall(pos, yaw, color = 0x7ad7ff, ttl = 8) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 7), mat);
    wall.position.copy(pos);
    wall.position.y += 3.5;
    wall.rotation.y = yaw;
    this.add(wall, ttl, (it, t) => { mat.opacity = 0.3 * (1 - t * 0.5); });
    return wall;
  }

  jumpJet(pos) {
    const light = new THREE.PointLight(0x8ad7ff, 8, 5);
    light.position.copy(pos);
    this.add(light, 0.15);
  }

  // jetpack burst: twin blue flame cones + downward sparks + light
  jets(pos) {
    const light = new THREE.PointLight(0x7ad7ff, 20, 7);
    light.position.copy(pos);
    this.add(light, 0.22, (it, t) => { light.intensity = 20 * (1 - t); });
    for (const side of [-0.12, 0.12]) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x9ae2ff, transparent: true, opacity: 0.9 });
      const cone = new THREE.Mesh(CONE_GEO, mat);
      cone.rotation.x = Math.PI;
      cone.position.copy(pos).add(new THREE.Vector3(side, -0.25, 0));
      this.add(cone, 0.3, (it, t) => {
        cone.scale.setScalar(1 + t * 0.8);
        cone.position.y -= 0.01;
        mat.opacity = 0.9 * (1 - t);
      });
    }
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(STREAK_GEO,
        new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true }));
      m.position.copy(pos);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 3, -6 - Math.random() * 4, (Math.random() - 0.5) * 3);
      this.add(m, 0.35, (it, t) => { m.position.addScaledVector(vel, 0.016); m.material.opacity = 1 - t; });
    }
  }

  // titan dash: horizontal thruster streaks
  dashTrail(pos, dir) {
    const light = new THREE.PointLight(0xffa050, 24, 10);
    light.position.copy(pos);
    this.add(light, 0.25, (it, t) => { light.intensity = 24 * (1 - t); });
    for (let i = 0; i < 5; i++) {
      const from = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 3, (Math.random() - 0.5) * 2));
      this.tracer(from, from.clone().addScaledVector(dir, -4 - Math.random() * 3), 0xffb27a);
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life += dt;
      const t = it.ttl === Infinity ? 0 : it.life / it.ttl;
      if (it.update) it.update(it, Math.min(1, t));
      if (it.life >= it.ttl) {
        this.scene.remove(it.obj);
        it.obj.traverse?.(o => {
          if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
          o.material?.dispose?.();
        });
        this.items.splice(i, 1);
      }
    }
  }
}
