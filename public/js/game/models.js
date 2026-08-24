// Character models built from primitives — detailed, stylized, no asset files.
import * as THREE from 'three';

export function teamColor(team) { return team === 'imc' ? 0x4da3ff : 0xffb24d; }

// Drive a walk cycle on a mesh built with leg pivot groups (userData.anim).
// phase advances with distance travelled; amp scales with speed.
export function animateWalk(mesh, phase, amp) {
  const a = mesh.userData.anim;
  if (!a) return;
  const swing = Math.sin(phase) * amp;
  if (a.lLeg) a.lLeg.rotation.x = swing;
  if (a.rLeg) a.rLeg.rotation.x = -swing;
  if (a.lArm) a.lArm.rotation.x = -swing * 0.5;
  if (a.rArm) a.rArm.rotation.x = swing * 0.5;
}

const M = (color, emissive = 0, intensity = 1) =>
  new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: intensity });

function box(g, mat, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}
function cyl(g, mat, r1, r2, h, x, y, z, rx = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 10), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx; m.rotation.z = rz;
  g.add(m);
  return m;
}

// ============ PILOT (~1.8m, origin at feet) ============
export function makePilotMesh(color) {
  const g = new THREE.Group();
  const suit = M(0x33383f);
  const suitDark = M(0x22262c);
  const armor = M(color);
  const glow = M(0x101418, color, 0.9);

  // legs: articulated pivot groups (hip at y=0.84) for walk animation
  const anim = {};
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.12, 0.84, 0);
    box(leg, suitDark, 0.15, 0.12, 0.26, 0, -0.78, 0.02);              // boot
    box(leg, suit, 0.13, 0.34, 0.15, 0, -0.55, 0);                     // shin
    box(leg, suit, 0.15, 0.34, 0.18, 0, -0.22, 0.01);                  // thigh
    box(leg, armor, 0.16, 0.12, 0.19, 0, -0.12, 0.01);                 // thigh plate
    g.add(leg);
    anim[s < 0 ? 'lLeg' : 'rLeg'] = leg;
  }
  g.userData.anim = anim;
  box(g, suitDark, 0.34, 0.14, 0.24, 0, 0.84, 0);                      // pelvis / belt
  // torso
  box(g, suit, 0.42, 0.42, 0.26, 0, 1.12, 0);                          // torso
  box(g, armor, 0.36, 0.26, 0.08, 0, 1.18, 0.15);                      // chest plate
  box(g, glow, 0.1, 0.05, 0.02, 0, 1.24, 0.2);                         // chest light
  // shoulders + arms (posed holding rifle)
  for (const s of [-1, 1]) {
    box(g, armor, 0.16, 0.13, 0.2, s * 0.28, 1.3, 0);                  // pauldron
    box(g, suit, 0.11, 0.3, 0.13, s * 0.29, 1.1, 0.06, 0, -0.5);       // upper arm
    box(g, suit, 0.1, 0.11, 0.3, s * 0.26, 0.97, 0.24);                // forearm forward
  }
  // rifle held across
  const rifle = box(g, suitDark, 0.07, 0.1, 0.62, 0.08, 1.0, 0.4);
  box(g, suitDark, 0.05, 0.07, 0.16, 0.08, 0.93, 0.28);                // mag
  // head
  const head = box(g, suit, 0.24, 0.24, 0.26, 0, 1.62, 0);
  head.userData.part = 'head';
  box(g, glow, 0.2, 0.07, 0.03, 0, 1.65, 0.14).userData.part = 'head'; // visor
  box(g, suitDark, 0.26, 0.06, 0.28, 0, 1.74, 0);                      // helmet rim
  // jetpack with glowing nozzles
  box(g, armor, 0.3, 0.34, 0.12, 0, 1.14, -0.19);
  for (const s of [-1, 1]) {
    cyl(g, suitDark, 0.045, 0.06, 0.14, s * 0.09, 0.95, -0.19);
    box(g, glow, 0.06, 0.03, 0.06, s * 0.09, 0.87, -0.19);             // nozzle glow
  }

  g.traverse(o => { if (o.isMesh) { o.userData.hittable = true; o.castShadow = true; } });
  return g;
}

// ============ TITAN (~4.6m, origin at feet) ============
const CHASSIS_SHAPE = {
  atlas:   { torsoW: 2.2, torsoH: 1.6, legH: 2.1, armW: 0.6,  color: 0x5a6470, trim: 0x454e59 },
  stryder: { torsoW: 1.7, torsoH: 1.3, legH: 2.5, armW: 0.45, color: 0x6b6f5a, trim: 0x52564a },
  ogre:    { torsoW: 2.9, torsoH: 1.9, legH: 1.9, armW: 0.9,  color: 0x4a4f58, trim: 0x383d45 },
  ronin:   { torsoW: 1.6, torsoH: 1.35, legH: 2.45, armW: 0.42, color: 0x3f4a55, trim: 0x2e3640 }
};

export function makeTitanMesh(chassisId, color) {
  const s = CHASSIS_SHAPE[chassisId] || CHASSIS_SHAPE.atlas;
  const g = new THREE.Group();
  const body = M(s.color);
  const trim = M(s.trim);
  const dark = M(0x191d23);
  const accent = M(color);
  const eyeGlow = M(0x0c1410, 0x7dff8a, 1.2);
  const teamGlow = M(0x101418, color, 0.9);

  const legH = s.legH, torsoY = legH + s.torsoH / 2;

  // ---- legs: articulated pivot groups (hip at y=legH) for stride animation ----
  const anim = {};
  for (const side of [-1, 1]) {
    const lx = side * s.torsoW * 0.32;
    const leg = new THREE.Group();
    leg.position.set(lx, legH, 0);
    box(leg, body, s.torsoW * 0.26, legH * 0.5, 0.78, 0, -legH * 0.28, 0.05, 0, 0.12);   // thigh (slight lean)
    const knee = new THREE.Mesh(new THREE.SphereGeometry(s.torsoW * 0.15, 8, 6), trim);
    knee.position.set(0, -legH * 0.52, 0.1); leg.add(knee);
    box(leg, trim, s.torsoW * 0.2, legH * 0.5, 0.6, 0, -legH * 0.76, -0.02, 0, -0.1);    // shin
    box(leg, dark, s.torsoW * 0.32, 0.34, 1.25, 0, 0.17 - legH, 0.18);                    // foot
    box(leg, accent, s.torsoW * 0.12, 0.1, 0.5, 0, 0.4 - legH, 0.45);                     // toe stripe
    g.add(leg);
    anim[side < 0 ? 'lLeg' : 'rLeg'] = leg;
  }
  g.userData.anim = anim;
  // pelvis
  box(g, trim, s.torsoW * 0.8, 0.55, 1.0, 0, legH + 0.05, 0);
  // ---- torso: lower + angled upper ----
  box(g, body, s.torsoW, s.torsoH * 0.72, 1.45, 0, torsoY - s.torsoH * 0.1, 0);
  box(g, body, s.torsoW * 0.86, s.torsoH * 0.5, 1.2, 0, torsoY + s.torsoH * 0.32, 0.12, 0, -0.12);
  // cockpit hatch + team stripe
  box(g, accent, s.torsoW * 0.38, s.torsoH * 0.44, 0.16, 0, torsoY + s.torsoH * 0.02, 0.76);
  box(g, teamGlow, s.torsoW * 0.3, 0.06, 0.05, 0, torsoY - s.torsoH * 0.24, 0.8);
  // sensor head with glowing eye
  box(g, trim, s.torsoW * 0.34, 0.44, 0.7, 0, torsoY + s.torsoH * 0.68, 0.25);
  box(g, eyeGlow, s.torsoW * 0.24, 0.12, 0.06, 0, torsoY + s.torsoH * 0.68, 0.62);
  // antenna
  cyl(g, dark, 0.025, 0.025, 0.9, -s.torsoW * 0.28, torsoY + s.torsoH * 0.95, -0.1);
  // ---- shoulders + arms ----
  for (const side of [-1, 1]) {
    const ax = side * (s.torsoW / 2 + s.armW * 0.7);
    box(g, accent, s.armW * 1.6, 1.0, 1.25, ax, torsoY + s.torsoH * 0.38, 0);            // pauldron
    box(g, teamGlow, s.armW * 1.62, 0.08, 0.5, ax, torsoY + s.torsoH * 0.62, 0.2);       // pauldron lamp
    box(g, body, s.armW, 1.1, 0.66, ax, torsoY - 0.1, 0.05);                             // upper arm
    box(g, trim, s.armW * 0.85, 1.0, 0.56, ax, torsoY - 0.95, 0.22, 0, 0.15);            // forearm
    if (side < 0) box(g, dark, s.armW * 0.7, 0.45, 0.5, ax, torsoY - 1.5, 0.42);         // left fist
  }
  // ---- right-arm weapon ----
  const gx = s.torsoW / 2 + s.armW * 0.7;
  if (chassisId === 'ronin') {
    // Leadwall shotgun (short, wide) + broadsword on the back
    box(g, dark, 0.5, 0.5, 1.1, gx, torsoY - 1.2, 0.55);
    cyl(g, dark, 0.16, 0.16, 0.7, gx, torsoY - 1.15, 1.35, Math.PI / 2);
    const blade = M(0x9aa8ba, 0x7ad7ff, 0.25);
    box(g, blade, 0.08, 3.6, 0.4, -s.torsoW * 0.42, torsoY + 0.6, -0.85, 0, 0, 0.22);      // sword blade
    box(g, dark, 0.14, 0.7, 0.16, -s.torsoW * 0.32, torsoY - 1.15, -0.85, 0, 0, 0.22);     // hilt
    box(g, M(0x8a2b2b), 0.2, 0.12, 0.5, -s.torsoW * 0.35, torsoY - 0.85, -0.85, 0, 0, 0.22); // guard
  } else {
    box(g, dark, 0.5, 0.55, 1.6, gx, torsoY - 1.2, 0.7);                                  // receiver
    cyl(g, dark, 0.12, 0.12, 1.3, gx, torsoY - 1.15, 1.7, Math.PI / 2);                   // barrel
    cyl(g, trim, 0.17, 0.17, 0.25, gx, torsoY - 1.15, 2.3, Math.PI / 2);                  // muzzle brake
  }
  // ---- back: thrusters + rodeo panel ----
  for (const side of [-1, 1]) {
    cyl(g, trim, 0.22, 0.28, 0.7, side * s.torsoW * 0.24, torsoY + s.torsoH * 0.3, -0.85, 0.35);
    box(g, M(0x140f0a, 0xff8a3d, 0.8), 0.26, 0.1, 0.26, side * s.torsoW * 0.24, torsoY + s.torsoH * 0.12, -1.0);
  }
  box(g, M(0x6a2424), s.torsoW * 0.46, s.torsoH * 0.44, 0.14, 0, torsoY, -0.8);           // rodeo weak panel

  g.traverse(o => { if (o.isMesh) { o.userData.hittable = true; o.castShadow = true; } });
  return g;
}

// ============ DROPSHIP (for the deployment intro) ============
// Hollow cabin with an open rear ramp so the camera can ride inside.
export function makeDropship(color) {
  const g = new THREE.Group();
  const hull = M(0x3a4250);
  const cabin = M(0x232a35);
  const dark = M(0x1c2026);
  const glow = M(0x140f0a, 0xff8a3d, 1.6);
  const redLight = M(0x1a0808, 0xff3030, 1.3);

  // hollow fuselage: floor / ceiling / side walls / front wall (rear stays open)
  box(g, cabin, 5.5, 0.25, 12, 0, -1.1, 0);                    // floor
  box(g, cabin, 5.5, 0.25, 12, 0, 1.25, 0);                    // ceiling
  box(g, cabin, 0.25, 2.4, 12, -2.65, 0.05, 0);                // left wall
  box(g, cabin, 0.25, 2.4, 12, 2.65, 0.05, 0);                 // right wall
  box(g, cabin, 5.5, 2.4, 0.25, 0, 0.05, 5.9);                 // front bulkhead
  // exterior shell accents
  box(g, dark, 4.2, 1.4, 4, 0, -0.4, 6.5);                     // nose
  box(g, hull, 14, 0.5, 4.2, 0, 0.9, -1);                      // wing
  for (const s of [-1, 1]) {
    box(g, dark, 2.2, 2.2, 3.4, s * 7.2, 0.9, -1);             // engine pods
    box(g, glow, 1.6, 1.6, 0.3, s * 7.2, 0.9, -2.9);           // engine glow
  }
  box(g, dark, 1.4, 2.4, 5, 0, 1.9, -5);                       // tail (above the open ramp)
  box(g, M(0x101418, color, 0.9), 3.2, 0.5, 0.4, 0, -1.35, 4); // belly stripe (team)
  // cabin interior: jump-light + seat benches + rear ramp lip
  box(g, redLight, 0.5, 0.12, 0.5, 0, 1.1, -4.5);              // red jump light by the ramp
  for (const s of [-1, 1]) {
    box(g, dark, 0.7, 0.4, 8, s * 2.1, -0.75, 0.5);            // bench
    box(g, redLight, 0.06, 0.06, 8, s * 2.55, 0.7, 0.5);       // wall light strips
  }
  box(g, dark, 5.5, 0.18, 1.6, 0, -1.25, -6.4, 0, 0.28);       // lowered rear ramp
  // dim warm cabin light so squadmates are readable
  const cabinLight = new THREE.PointLight(0xffc9a0, 14, 11);
  cabinLight.position.set(0, 0.8, 0.5);
  g.add(cabinLight);
  return g;
}

// Name tag sprite above a player.
export function makeNameSprite(text, colorCss) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 30px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = colorCss;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 5;
  ctx.strokeText(text, 128, 42);
  ctx.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(3.2, 0.8, 1);
  return sprite;
}

// Per-weapon body/accent tints so every gun reads as its own piece of hardware.
const WEAPON_TINTS = {
  r101: [0x2b313a, 0x3d4756], smart_pistol: [0x22303a, 0x2a7a8a], eva8: [0x38302a, 0x7a5a3a],
  r97: [0x2a3230, 0x3a6a5a], longbow: [0x232833, 0x37476a], g2a4: [0x33302a, 0x6a5f3a],
  hemlok: [0x2c2a33, 0x5a4a7a], car: [0x2a2e35, 0x4a6a8a], spitfire: [0x30332a, 0x5a6a3a],
  kraber: [0x262a30, 0x704a3a], p2011: [0x2b313a, 0x4a4f58], re45: [0x2d2a2a, 0x7a3a3a],
  wingman: [0x322c26, 0x8a6a3a], archer: [0x2a3038, 0x3a5a7a], sidewinder: [0x332d28, 0x8a5a2a],
  mag_launcher: [0x28313a, 0x2a6a8a], charge_rifle: [0x2a2a38, 0x5a3a8a]
};

// First-person viewmodel gun attached to the camera — silhouette varies by weapon.
export function makeViewmodel(def) {
  const g = new THREE.Group();
  const tint = WEAPON_TINTS[def?.id] || [0x2b313a, 0x3d4756];
  const mat = M(tint[0]);
  const dark = M(0x181c22);
  const accent = M(tint[1]);
  const t = (def?.type || 'Assault Rifle').toLowerCase();

  // family parameters: barrel length/thickness, body size, extras
  let barrelLen = 0.34, barrelR = 0.018, bodyLen = 0.34, wide = false, scope = false, tube = false;
  if (t.includes('sniper')) { barrelLen = 0.55, bodyLen = 0.4; scope = true; }
  else if (t.includes('shotgun')) { barrelLen = 0.3; barrelR = 0.032; wide = true; }
  else if (t.includes('smg') || t.includes('machine pistol')) { barrelLen = 0.16; bodyLen = 0.26; }
  else if (t.includes('pistol') || t.includes('revolver')) { barrelLen = 0.14; bodyLen = 0.18; }
  else if (t.includes('lmg')) { barrelLen = 0.42; barrelR = 0.024; wide = true; }
  else if (t.includes('launcher') || t.includes('rocket') || t.includes('gl') || def?.projectile) { tube = true; }
  else if (def?.beam || def?.chargeTime) { scope = false; barrelLen = 0.4; barrelR = 0.03; }

  if (tube) {
    // shoulder tube launcher
    cyl(g, dark, 0.06, 0.06, 0.85, 0.24, -0.16, -0.5, Math.PI / 2);
    cyl(g, accent, 0.07, 0.07, 0.16, 0.24, -0.16, -0.84, Math.PI / 2);
    box(g, mat, 0.06, 0.14, 0.1, 0.24, -0.27, -0.3);
    box(g, M(0x101418, 0xff6a2b, 0.8), 0.02, 0.03, 0.06, 0.24, -0.1, -0.4);   // sight glow
  } else {
    const bodyEnd = -0.24 - bodyLen;
    box(g, mat, wide ? 0.09 : 0.07, 0.11, bodyLen, 0.22, -0.21, -0.24 - bodyLen / 2);
    cyl(g, dark, barrelR, barrelR, barrelLen, 0.22, -0.185, bodyEnd - barrelLen / 2, Math.PI / 2);
    box(g, accent, wide ? 0.075 : 0.055, 0.06, bodyLen * 0.6, 0.22, -0.215, bodyEnd + bodyLen * 0.15);
    box(g, dark, 0.05, 0.16, 0.07, 0.22, -0.31, -0.26, 0, 0.25);              // grip
    box(g, accent, 0.045, 0.13, 0.06, 0.22, -0.31, -0.24 - bodyLen * 0.55, 0, -0.15);  // mag
    if (scope) {
      cyl(g, dark, 0.03, 0.03, 0.16, 0.22, -0.12, -0.44, Math.PI / 2);
      box(g, M(0x0a1a2a, 0x4da3ff, 0.7), 0.02, 0.02, 0.01, 0.22, -0.12, -0.52);
    } else {
      box(g, dark, 0.02, 0.045, 0.09, 0.22, -0.135, -0.42);
      box(g, new THREE.MeshBasicMaterial({ color: 0xff5540 }), 0.008, 0.008, 0.01, 0.22, -0.128, -0.465);
    }
  }
  box(g, M(0x39424e), 0.07, 0.07, 0.3, 0.28, -0.32, -0.12, -0.35);            // arm hint
  return g;
}
