// Procedural, seed-deterministic maps: every client builds identical geometry.
import * as THREE from 'three';
import { UNIT_BOX, UNIT_CYL } from './models.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const THEMES = {
  city:       { ground: 0x41464f, wall: 0x5a6678, accent: 0x7e8fa8, fog: 0x232c3d, sky: 0x2e3d5c, hMin: 8, hMax: 34 },
  canyon:     { ground: 0x6a563e, wall: 0x8a6f52, accent: 0xa8886a, fog: 0x3d2f1e, sky: 0x4a3c28, hMin: 6, hMax: 20 },
  industrial: { ground: 0x424a46, wall: 0x5c7168, accent: 0x7e9a8c, fog: 0x1e2b25, sky: 0x2a3f35, hMin: 10, hMax: 28 }
};

// facade texture with randomly lit windows (also used as emissive map for glow)
function makeWindowTexture(rng, facadeCss, litCss) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = facadeCss; x.fillRect(0, 0, 128, 256);
  // subtle vertical panel seams for facade texture variation
  for (let i = 0; i <= 6; i++) {
    x.fillStyle = 'rgba(0,0,0,0.10)';
    x.fillRect(3 + i * 20, 0, 2, 256);
  }
  for (let wy = 0; wy < 14; wy++) {
    // faint floor slab line
    x.fillStyle = 'rgba(0,0,0,0.12)';
    x.fillRect(0, 7 + wy * 17, 128, 1);
    for (let wx = 0; wx < 6; wx++) {
      // window frame, then pane: dark, warm-lit, or cool-lit
      x.fillStyle = 'rgba(0,0,0,0.55)';
      x.fillRect(7 + wx * 20, 9 + wy * 17, 14, 11);
      const r = rng();
      x.fillStyle = r < 0.22 ? litCss : r < 0.3 ? '#9fd4ff' : 'rgba(8,12,18,0.85)';
      x.fillRect(8 + wx * 20, 10 + wy * 17, 12, 9);
    }
  }
  // rooftop parapet band + darker street-level base
  x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(0, 0, 128, 6);
  x.fillStyle = 'rgba(6,9,13,0.9)'; x.fillRect(0, 242, 128, 14);
  x.fillStyle = litCss; x.globalAlpha = 0.8;
  x.fillRect(30, 245, 10, 9); x.fillRect(88, 245, 10, 9);   // lit doorways
  x.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;   // kills shimmering line moiré at grazing angles
  return tex;
}

// dark asphalt strip with faded center dashes, tiled along the road
function makeRoadTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#26292e'; x.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 400; i++) {
    x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + Math.random() * 0.03})`;
    x.fillRect(Math.random() * 128, Math.random() * 64, 1, 1);
  }
  x.fillStyle = 'rgba(210,205,160,0.4)';
  x.fillRect(10, 29, 40, 5); x.fillRect(74, 29, 40, 5);     // center dashes
  x.fillStyle = 'rgba(200,200,200,0.18)';
  x.fillRect(0, 2, 128, 2); x.fillRect(0, 60, 128, 2);      // edge lines
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeGroundTexture(baseCss) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = baseCss; x.fillRect(0, 0, 512, 512);
  // fine asphalt speckle — subtle, seamless (no border strokes)
  for (let i = 0; i < 5000; i++) {
    x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.015 + Math.random() * 0.025})`;
    x.fillRect(Math.random() * 512, Math.random() * 512, 1, 1);
  }
  // faint large stains for variation
  for (let i = 0; i < 14; i++) {
    const gr = x.createRadialGradient(0, 0, 2, 0, 0, 30 + Math.random() * 50);
    gr.addColorStop(0, 'rgba(0,0,0,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.save();
    x.translate(Math.random() * 512, Math.random() * 512);
    x.fillStyle = gr; x.fillRect(-80, -80, 160, 160);
    x.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function cssHex(hex) { return '#' + hex.toString(16).padStart(6, '0'); }

export function buildWorld(scene, mapDef) {
  const rng = mulberry32(mapDef.seed);
  const theme = THEMES[mapDef.theme] || THEMES.city;
  const size = mapDef.size;
  const half = size / 2;

  scene.background = new THREE.Color(theme.sky);
  scene.fog = new THREE.Fog(theme.fog, 60, size * 1.4);

  // gradient sky dome + stars (replaces the flat background color at the horizon)
  {
    const skyC = document.createElement('canvas');
    skyC.width = 32; skyC.height = 256;
    const sx = skyC.getContext('2d');
    const top = new THREE.Color(theme.sky).multiplyScalar(0.35);
    const mid = new THREE.Color(theme.sky);
    const hor = new THREE.Color(theme.sky).lerp(new THREE.Color(0xc07038), 0.55);
    const grad = sx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#' + top.getHexString());
    grad.addColorStop(0.55, '#' + mid.getHexString());
    grad.addColorStop(0.85, '#' + hor.getHexString());
    grad.addColorStop(1, '#' + hor.clone().multiplyScalar(0.7).getHexString());
    sx.fillStyle = grad; sx.fillRect(0, 0, 32, 256);
    const skyTex = new THREE.CanvasTexture(skyC);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(size * 1.9, 24, 14),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
    );
    scene.add(dome);
    const starPts = [];
    for (let i = 0; i < 350; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.4;
      const r = size * 1.8;
      starPts.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th));
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPts, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.4, fog: false, transparent: true, opacity: 0.8 })));
  }

  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(80, 140, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -size * 0.8; sc.right = size * 0.8; sc.top = size * 0.8; sc.bottom = -size * 0.8;
  sc.near = 20; sc.far = 420;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9fb8d8, 0x3a3028, 1.15));

  // sky sun disc + frontier moon (fog disabled so they stay crisp)
  const skySprite = (colorStops, scale, pos) => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64);
    for (const [stop, col] of colorStops) gr.addColorStop(stop, col);
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c), transparent: true, fog: false,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    sp.scale.setScalar(scale);
    sp.position.copy(pos);
    scene.add(sp);
  };
  skySprite([[0, '#fff8e8'], [0.25, '#ffd9a0cc'], [1, 'rgba(255,170,80,0)']], 260, new THREE.Vector3(400, 480, 220));
  skySprite([[0, '#aebfd8cc'], [0.5, '#8095b666'], [1, 'rgba(120,140,180,0)']], 340, new THREE.Vector3(-500, 320, -480));

  // distant mountain silhouette ring (visual-only, sits between map walls and sky dome)
  {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const x = c.getContext('2d');
    const ridge = (baseY, jag, css) => {
      x.fillStyle = css;
      x.beginPath(); x.moveTo(0, 256);
      let y = baseY;
      const y0 = y;
      for (let px = 0; px <= 1024; px += 16) {
        // wrap-friendly: blend back toward the start height at the seam
        y = px > 960 ? y + (y0 - y) * 0.35 : Math.max(40, Math.min(230, y + (rng() - 0.5) * jag));
        x.lineTo(px, y);
      }
      x.lineTo(1024, 256); x.closePath(); x.fill();
    };
    const far = new THREE.Color(theme.fog).lerp(new THREE.Color(theme.sky), 0.5);
    const near = new THREE.Color(theme.fog).multiplyScalar(0.8);
    ridge(120, 55, '#' + far.getHexString());
    ridge(175, 70, '#' + near.getHexString());
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = 3;
    const mtn = new THREE.Mesh(
      new THREE.CylinderGeometry(size * 1.5, size * 1.5, size * 0.42, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    mtn.position.y = size * 0.14;
    scene.add(mtn);
  }

  // drifting cloud layer (soft canvas blobs, slow rotation via world.update)
  const clouds = new THREE.Group();
  {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    for (const [bx, by, br] of [[45, 70, 34], [70, 62, 30], [90, 72, 24], [58, 78, 26]]) {
      const gr = x.createRadialGradient(bx, by, 2, bx, by, br);
      gr.addColorStop(0, 'rgba(235,240,248,0.55)');
      gr.addColorStop(0.7, 'rgba(215,224,238,0.25)');
      gr.addColorStop(1, 'rgba(210,220,235,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    }
    const cloudTex = new THREE.CanvasTexture(c);
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTex, transparent: true, opacity: 0.5 + rng() * 0.25,
        fog: false, depthWrite: false
      }));
      sp.raycast = () => {};
      const a = rng() * Math.PI * 2, r = size * (0.35 + rng() * 0.85);
      sp.position.set(Math.cos(a) * r, 130 + rng() * 110, Math.sin(a) * r);
      sp.scale.set(90 + rng() * 110, 26 + rng() * 26, 1);
      clouds.add(sp);
    }
    scene.add(clouds);
  }

  const colliders = [];      // {min:THREE.Vector3, max:THREE.Vector3}
  const meshes = [];         // raycastable world meshes

  // ground (textured)
  const groundTex = makeGroundTexture(cssHex(theme.ground));
  groundTex.repeat.set(size / 26, size / 26);
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(size * 2, 1, size * 2),
    new THREE.MeshLambertMaterial({ color: 0xffffff, map: groundTex })
  );
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);
  meshes.push(ground);
  ground.userData.world = true;

  const wallMat = new THREE.MeshLambertMaterial({ color: theme.wall });
  const accMat = new THREE.MeshLambertMaterial({ color: theme.accent });
  const trimMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.wall).multiplyScalar(0.55) });
  // two window-facade variants for tall structures
  const winMats = [0, 1].map(() => {
    const tex = makeWindowTexture(rng, cssHex(theme.wall), '#ffd98a');
    return new THREE.MeshLambertMaterial({
      color: 0xffffff, map: tex,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22
    });
  });

  function addBox(x, y, z, w, h, d, mat) {
    // sink slightly so bottom faces never sit coplanar with the ground (z-fighting lines)
    const ys = y - 0.03;
    const m = new THREE.Mesh(UNIT_BOX, mat);
    m.scale.set(w, h, d);
    m.position.set(x, ys, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    meshes.push(m);
    m.userData.world = true;
    colliders.push({
      min: new THREE.Vector3(x - w / 2, ys - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, ys + h / 2, z + d / 2)
    });
    return m;
  }

  // perimeter walls
  const WH = 26, WT = 4;
  addBox(0, WH / 2, -half - WT / 2, size + WT * 2, WH, WT, wallMat);
  addBox(0, WH / 2, half + WT / 2, size + WT * 2, WH, WT, wallMat);
  addBox(-half - WT / 2, WH / 2, 0, WT, WH, size + WT * 2, wallMat);
  addBox(half + WT / 2, WH / 2, 0, WT, WH, size + WT * 2, wallMat);

  // street grid along the cell boundaries (visual-only planes above the ground)
  const cells = 6;
  const cell = size / cells;
  {
    const roadTex = makeRoadTexture();
    roadTex.repeat.set(size / 32, 1);
    const roadMat = new THREE.MeshLambertMaterial({ map: roadTex, transparent: true, opacity: 0.96 });
    const roadGeo = new THREE.PlaneGeometry(size, 7);
    roadGeo.userData.shared = true;
    for (let i = 1; i < cells; i++) {
      for (const vertical of [false, true]) {
        const road = new THREE.Mesh(roadGeo, roadMat);
        road.rotation.x = -Math.PI / 2;
        if (vertical) road.rotation.z = Math.PI / 2;
        road.position.set(vertical ? -half + cell * i : 0, 0.06, vertical ? 0 : -half + cell * i);
        road.receiveShadow = true;
        road.raycast = () => {};   // decorative: never blocks shots (ground box handles that)
        scene.add(road);
      }
    }
  }

  // city blocks — leave two spawn plazas at map ends (z axis)
  for (let gx = 0; gx < cells; gx++) {
    for (let gz = 0; gz < cells; gz++) {
      const cx = -half + cell * (gx + 0.5);
      const cz = -half + cell * (gz + 0.5);
      if (gz === 0 || gz === cells - 1) {           // spawn rows: low cover only
        if (rng() < 0.5) {
          addBox(cx + (rng() - 0.5) * 8, 1.5, cz + (rng() - 0.5) * 8, 6 + rng() * 4, 3, 4 + rng() * 3, accMat);
        }
        continue;
      }
      if (rng() < 0.18) continue;                    // open plaza
      const n = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const w = cell * (0.28 + rng() * 0.3);
        const d = cell * (0.28 + rng() * 0.3);
        const h = theme.hMin + rng() * (theme.hMax - theme.hMin);
        const ox = (rng() - 0.5) * (cell - w) * 0.8;
        const oz = (rng() - 0.5) * (cell - d) * 0.8;
        const mat = h > 14 && rng() < 0.75 ? winMats[rng() < 0.5 ? 0 : 1]
                  : (rng() < 0.3 ? accMat : wallMat);
        const b = addBox(cx + ox, h / 2, cz + oz, w, h, d, mat);
        // corner trim columns give tall slabs an architectural edge (visual-only, inside the collider)
        if (h > 10) {
          for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            const col = new THREE.Mesh(UNIT_BOX, trimMat);
            col.scale.set(0.5, h, 0.5);
            col.position.set(cx + ox + sx * (w / 2 - 0.18), h / 2 - 0.03, cz + oz + sz * (d / 2 - 0.18));
            col.castShadow = true;
            scene.add(col);
          }
          // rooftop parapet cap
          const cap = new THREE.Mesh(UNIT_BOX, trimMat);
          cap.scale.set(w + 0.24, 0.35, d + 0.24);
          cap.position.set(cx + ox, h - 0.1, cz + oz);
          scene.add(cap);
        }
        // rooftop lip for wall-run visual interest
        if (rng() < 0.4) addBox(cx + ox, h + 1.05, cz + oz, w * 0.5, 2, d * 0.5, accMat);
        // rooftop details: AC units + antenna (visual only)
        if (h > 12 && rng() < 0.6) {
          const ac = new THREE.Mesh(UNIT_BOX, new THREE.MeshLambertMaterial({ color: 0x2c333d }));
          ac.scale.set(1.6, 1, 1.6);
          ac.position.set(cx + ox + (rng() - 0.5) * w * 0.5, h + 0.52, cz + oz + (rng() - 0.5) * d * 0.5);
          scene.add(ac);
          if (rng() < 0.5) {
            const ant = new THREE.Mesh(UNIT_CYL, new THREE.MeshLambertMaterial({ color: 0x1c2026 }));
            ant.scale.set(0.05, 4, 0.05);
            ant.position.set(cx + ox, h + 2, cz + oz);
            scene.add(ant);
            const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshLambertMaterial({ color: 0x200606, emissive: 0xff2030, emissiveIntensity: 2 }));
            beacon.position.set(cx + ox, h + 4, cz + oz);
            scene.add(beacon);
          }
        }
      }
      // occasional wall-run rails between blocks
      if (rng() < 0.35) {
        addBox(cx, 5, cz, cell * 0.9, 10, 1.2, accMat);
      } else if (rng() < 0.35) {
        addBox(cx, 5, cz, 1.2, 10, cell * 0.9, accMat);
      }
    }
  }

  // ---------- environment props ----------
  const propMats = [
    new THREE.MeshLambertMaterial({ color: 0x8a4a3a }),   // rust red container
    new THREE.MeshLambertMaterial({ color: 0x3a6a5a }),   // teal container
    new THREE.MeshLambertMaterial({ color: 0x6a6a3a }),   // olive container
    accMat
  ];
  const lampHead = new THREE.MeshLambertMaterial({ color: 0x202020, emissive: 0xffd98a, emissiveIntensity: 1.4 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x1c2026 });

  function addCylinderProp(x, z, r, h, mat) {
    const m = new THREE.Mesh(UNIT_CYL, mat);
    m.scale.set(r, h, r);
    m.position.set(x, h / 2 - 0.03, z);
    scene.add(m); meshes.push(m); m.userData.world = true;
    colliders.push({
      min: new THREE.Vector3(x - r, 0, z - r),
      max: new THREE.Vector3(x + r, h, z + r)
    });
    return m;
  }
  function addStreetLamp(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), darkMat);
    pole.position.set(x, 3, z);
    scene.add(pole);
    const head = new THREE.Mesh(UNIT_BOX, lampHead);
    head.scale.set(0.9, 0.18, 0.35);
    head.position.set(x + 0.35, 6, z);
    scene.add(head);
  }

  // scatter props along street lanes (cell boundaries stay clear for grunts: offset ±4 keeps a path)
  for (let i = 0; i < 26; i++) {
    const gx = 1 + Math.floor(rng() * (cells - 1));
    const gz = 1 + Math.floor(rng() * (cells - 2));
    const bx = -half + cell * gx + (rng() < 0.5 ? -5.5 : 5.5);
    const bz = -half + cell * (gz + 0.5) + (rng() - 0.5) * cell * 0.5;
    const kind = rng();
    if (kind < 0.45) {
      // shipping containers (sometimes stacked)
      const mat = propMats[Math.floor(rng() * propMats.length)];
      const rot = rng() < 0.5;
      addBox(bx, 1.3, bz, rot ? 6.2 : 2.6, 2.6, rot ? 2.6 : 6.2, mat);
      if (rng() < 0.4) addBox(bx + (rng() - 0.5) * 1.5, 3.95, bz + (rng() - 0.5) * 1.5, rot ? 6.2 : 2.6, 2.6, rot ? 2.6 : 6.2, propMats[Math.floor(rng() * propMats.length)]);
    } else if (kind < 0.65) {
      // crate cluster
      for (let c2 = 0; c2 < 3; c2++) addBox(bx + (rng() - 0.5) * 3, 0.7, bz + (rng() - 0.5) * 3, 1.4, 1.4, 1.4, rng() < 0.5 ? accMat : darkMat);
    } else if (kind < 0.85) {
      // storage silo / tank
      addCylinderProp(bx, bz, 1.6 + rng() * 1.2, 5 + rng() * 5, theme === THEMES.canyon ? propMats[0] : accMat);
    } else if (theme === THEMES.canyon) {
      // rock formation
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(2 + rng() * 2.5, 0), wallMat);
      rock.position.set(bx, 1 + rng(), bz);
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      scene.add(rock); meshes.push(rock); rock.userData.world = true;
      colliders.push({ min: new THREE.Vector3(bx - 2.4, 0, bz - 2.4), max: new THREE.Vector3(bx + 2.4, 3.4, bz + 2.4) });
    } else {
      addStreetLamp(bx, bz);
    }
  }
  // street lamps along the two mid avenues
  for (let i = 1; i < 6; i++) {
    addStreetLamp(-half + cell * i + 4, -cell * 0.5 - 4);
    addStreetLamp(-half + cell * i - 4, cell * 0.5 + 4);
  }
  // elevated crossover pipes between random blocks (wall-run / cover)
  for (let i = 0; i < 5; i++) {
    const gx = 1 + Math.floor(rng() * (cells - 2));
    const gz = 1 + Math.floor(rng() * (cells - 2));
    const px = -half + cell * (gx + 0.5), pz = -half + cell * gz;
    const pipe = new THREE.Mesh(UNIT_CYL, darkMat);
    pipe.scale.set(0.5, cell * 0.96, 0.5);
    pipe.rotation.z = Math.PI / 2;
    const py = 7 + rng() * 5;
    pipe.position.set(px, py, pz);
    pipe.rotation.y = rng() < 0.5 ? 0 : Math.PI / 2;
    scene.add(pipe); meshes.push(pipe); pipe.userData.world = true;
    const alongX = Math.abs(pipe.rotation.y) < 0.1;
    colliders.push({
      min: new THREE.Vector3(px - (alongX ? cell * 0.48 : 0.5), py - 0.5, pz - (alongX ? 0.5 : cell * 0.48)),
      max: new THREE.Vector3(px + (alongX ? cell * 0.48 : 0.5), py + 0.5, pz + (alongX ? 0.5 : cell * 0.48))
    });
  }

  // spawn points at both ends
  const spawns = { imc: [], militia: [] };
  for (let i = 0; i < 8; i++) {
    const x = -half + (i + 0.5) * (size / 8);
    spawns.imc.push(new THREE.Vector3(x, 1.0, -half + cell * 0.5));
    spawns.militia.push(new THREE.Vector3(x, 1.0, half - cell * 0.5));
  }

  // slow ambient motion (called from the game loop)
  function update(dt) {
    clouds.rotation.y += dt * 0.0035;
  }

  return { colliders, meshes, spawns, size, theme, update };
}

// ---------- collision: swept AABB, axis-separated ----------
// Moves pos by vel*dt against colliders. half = half-extents. Returns flags.
export function moveWithCollisions(pos, vel, dt, half, colliders) {
  const res = { onGround: false, wall: null, hitCeiling: false };
  const p = pos;

  const overlaps = (axis) => {
    for (const c of colliders) {
      if (p.x + half.x > c.min.x && p.x - half.x < c.max.x &&
          p.y + half.y > c.min.y && p.y - half.y < c.max.y &&
          p.z + half.z > c.min.z && p.z - half.z < c.max.z) return c;
    }
    return null;
  };

  // X
  p.x += vel.x * dt;
  let c = overlaps('x');
  if (c) {
    if (vel.x > 0) p.x = c.min.x - half.x - 0.001; else p.x = c.max.x + half.x + 0.001;
    res.wall = { normal: new THREE.Vector3(vel.x > 0 ? -1 : 1, 0, 0), box: c };
    vel.x = 0;
  }
  // Z
  p.z += vel.z * dt;
  c = overlaps('z');
  if (c) {
    if (vel.z > 0) p.z = c.min.z - half.z - 0.001; else p.z = c.max.z + half.z + 0.001;
    res.wall = { normal: new THREE.Vector3(0, 0, vel.z > 0 ? -1 : 1), box: c };
    vel.z = 0;
  }
  // Y
  p.y += vel.y * dt;
  c = overlaps('y');
  if (c) {
    if (vel.y > 0) { p.y = c.min.y - half.y - 0.001; res.hitCeiling = true; }
    else { p.y = c.max.y + half.y + 0.001; res.onGround = true; }
    vel.y = 0;
  }
  // ground plane
  if (p.y - half.y < 0) { p.y = half.y; if (vel.y < 0) vel.y = 0; res.onGround = true; }
  return res;
}

// Probe for a wall next to the player (for wall-running). dir: THREE.Vector3 side direction.
export function probeWall(pos, dir, dist, colliders) {
  const px = pos.x + dir.x * dist, pz = pos.z + dir.z * dist;
  for (const c of colliders) {
    if (px > c.min.x && px < c.max.x &&
        pos.y > c.min.y && pos.y < c.max.y &&
        pz > c.min.z && pz < c.max.z) {
      // pick normal: which face are we nearest
      const dx = Math.min(Math.abs(px - c.min.x), Math.abs(px - c.max.x));
      const dz = Math.min(Math.abs(pz - c.min.z), Math.abs(pz - c.max.z));
      const n = new THREE.Vector3();
      if (dx < dz) n.set(pos.x < (c.min.x + c.max.x) / 2 ? -1 : 1, 0, 0);
      else n.set(0, 0, pos.z < (c.min.z + c.max.z) / 2 ? -1 : 1);
      return { box: c, normal: n };
    }
  }
  return null;
}
