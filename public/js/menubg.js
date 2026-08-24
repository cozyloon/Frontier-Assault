// Animated Three.js background for the menu screens: rotating titan showcase.
import * as THREE from 'three';
import { makeTitanMesh } from './game/models.js';

let renderer, scene, camera, titan, dust, raf = null, t0 = performance.now();
let active = false;

export function initMenuBg() {
  const canvas = document.createElement('canvas');
  canvas.id = 'menu-bg';
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '0', display: 'none' });
  document.body.prepend(canvas);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0d13, 8, 90);

  camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(0, 3.2, 11);

  // ---- sky dome: nebula gradient painted on a canvas ----
  const skyC = document.createElement('canvas');
  skyC.width = 32; skyC.height = 256;
  const sx = skyC.getContext('2d');
  const grad = sx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#05070d');
  grad.addColorStop(0.45, '#0d1526');
  grad.addColorStop(0.72, '#25314e');
  grad.addColorStop(0.86, '#68402a');
  grad.addColorStop(1, '#b4552b');
  sx.fillStyle = grad; sx.fillRect(0, 0, 32, 256);
  const skyTex = new THREE.CanvasTexture(skyC);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(180, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  scene.add(sky);

  // stars
  const starPts = [];
  for (let i = 0; i < 500; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.45;
    const r = 160;
    starPts.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) + 4, r * Math.sin(ph) * Math.sin(th));
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPts, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.5, fog: false, transparent: true, opacity: 0.85 })));

  // distant city skyline silhouettes against the horizon glow
  const skyline = new THREE.Group();
  const silMat = new THREE.MeshBasicMaterial({ color: 0x070a10, fog: false });
  for (let i = 0; i < 60; i++) {
    const ang = (i / 60) * Math.PI * 2 + Math.random() * 0.1;
    const dist = 120 + Math.random() * 30;
    const w = 6 + Math.random() * 14, h = 8 + Math.random() * 34;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6), silMat);
    b.position.set(Math.cos(ang) * dist, h / 2 - 2, Math.sin(ang) * dist);
    b.lookAt(0, h / 2 - 2, 0);
    skyline.add(b);
  }
  scene.add(skyline);

  // drifting dropship lights
  const ships = [];
  for (let i = 0; i < 3; i++) {
    const ship = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb24d : 0x8ad7ff, fog: false }));
    ship.userData = { r: 90 + i * 18, y: 26 + i * 9, speed: 0.02 + i * 0.008, phase: i * 2.1 };
    scene.add(ship);
    ships.push(ship);
  }
  window.__menuShips = ships;

  // dramatic rim lighting
  const key = new THREE.PointLight(0xff6a2b, 260, 40); key.position.set(6, 6, 4); scene.add(key);
  const fill = new THREE.PointLight(0x4da3ff, 160, 40); fill.position.set(-7, 3, -3); scene.add(fill);
  scene.add(new THREE.AmbientLight(0x223044, 2.2));

  // pedestal + titan
  const SHOW_X = 6.5;   // showcase sits right of the centered UI panels
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.8, 0.4, 40),
    new THREE.MeshLambertMaterial({ color: 0x161c26 })
  );
  pedestal.position.set(SHOW_X, -0.2, 0);
  scene.add(pedestal);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.6, 0.05, 8, 60),
    new THREE.MeshBasicMaterial({ color: 0xff6a2b })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(SHOW_X, 0.02, 0);
  scene.add(ring);

  titan = makeTitanMesh('atlas', 0xff6a2b);
  titan.position.x = SHOW_X;
  scene.add(titan);

  // floating dust
  const pts = [];
  for (let i = 0; i < 220; i++) pts.push((Math.random() - 0.5) * 30, Math.random() * 14, (Math.random() - 0.5) * 30);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x7a8aa5, size: 0.045, transparent: true, opacity: 0.7 }));
  scene.add(dust);

  // ground grid glow
  const grid = new THREE.GridHelper(60, 40, 0x1e2a3d, 0x141c2a);
  grid.position.y = -0.4;
  scene.add(grid);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function loop(t) {
  raf = requestAnimationFrame(loop);
  const s = (t - t0) / 1000;
  titan.rotation.y = s * 0.25;
  camera.position.x = Math.sin(s * 0.11) * 1.6;
  camera.position.y = 3.2 + Math.sin(s * 0.17) * 0.3;
  camera.lookAt(3.2, 2.6, 0);
  dust.rotation.y = s * 0.014;
  for (const ship of window.__menuShips || []) {
    const u = ship.userData;
    const a = s * u.speed + u.phase;
    ship.position.set(Math.cos(a) * u.r, u.y + Math.sin(s * 0.5 + u.phase) * 1.5, Math.sin(a) * u.r);
  }
  renderer.render(scene, camera);
}

export function setMenuBgActive(on) {
  if (!renderer) return;
  if (on && !active) { active = true; renderer.domElement.style.display = ''; raf = requestAnimationFrame(loop); }
  else if (!on && active) { active = false; cancelAnimationFrame(raf); renderer.domElement.style.display = 'none'; }
}
