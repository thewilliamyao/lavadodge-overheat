/* LavaDodge: Overheat 3D — three.js renderer. Game rules, menus and multiplayer
 * live in ../shared/ (loaded as classic scripts before this module). Original game by William Yao (2017).
 */
import * as THREE from 'three';
import { GLTFLoader } from './lib/loaders/GLTFLoader.js';

const LD = window.LD;
const { COLS, ROWS, BAL } = LD;
LD.keyBest = 'ld_best3d'; LD.keyDaily = 'ld_daily3d_';

// ---------- 2D images for the HUD / menus ----------
const IMG = LD.IMG = {};
let loaded = 0; const total = 10;
function loadImg(name, src) { return new Promise(res => { const i = new Image(); i.onload = i.onerror = () => { loaded++; res(i); }; i.src = src; IMG[name] = i; }); }
const imgReady = Promise.all(['olaf_burnt', 'btn_up', 'btn_down', 'btn_left', 'btn_right', 'tile', 'lava', 'crack'].map(n => loadImg(n, 'assets/img/' + n + '.png')));

const glCanvas = document.getElementById('three');
let L = {}, R, S3, cam, sun;
const time = () => LD.ui.time;
const cellX = c => c - (COLS - 1) / 2, cellZ = r => r - (ROWS - 1) / 2;
const texLoader = new THREE.TextureLoader();
function tex(src) { const t = texLoader.load(src); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

function init3D() {
  R = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  R.outputColorSpace = THREE.SRGBColorSpace;
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05;
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  S3 = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  S3.add(new THREE.HemisphereLight(0xdff4ff, 0x6b4a2a, 1.25));
  sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(-4, 10, 5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.02;
  S3.add(sun);
  Board.build(); IceView.build(); FX.build();
}

// ---------- camera ----------
let camBlend = 0;
function fitCamera() {
  if (!R) return;
  R.setSize(L.W, L.H, false);
  cam.aspect = L.W / L.H;
  // same-phone: look almost straight down so the board reads the same from both sides
  const tilt = THREE.MathUtils.degToRad(L.local ? 78 : 50);
  const fovV = THREE.MathUtils.degToRad(cam.fov), pxPerUnit = (L.board * 0.98) / COLS;
  cam.userData.play = { dist: L.H / (2 * Math.tan(fovV / 2) * pxPerUnit), tilt };
  cam.clearViewOffset();
  cam.setViewOffset(L.W, L.H, 0, L.H / 2 - L.boardCy + (L.local ? 0 : 6), L.W, L.H);
  cam.updateProjectionMatrix();
}
function placeCamera(inGame) {
  const pd = cam.userData.play; if (!pd) return;
  camBlend += ((inGame ? 1 : 0) - camBlend) * 0.08;
  let yaw = 0, dist = pd.dist, tilt = pd.tilt;
  const look = new THREE.Vector3(0, 0.2 * (1 - camBlend), 0.15 - 0.95 * (1 - camBlend));
  if (camBlend < 0.999) { // title: slow orbit around Olaf, a little closer
    const ty = Math.sin(time() * 0.25) * 0.5, td = pd.dist * 0.62, tt = THREE.MathUtils.degToRad(32);
    yaw = ty * (1 - camBlend); dist = td + (pd.dist - td) * camBlend; tilt = tt + (pd.tilt - tt) * camBlend;
  }
  const y = Math.sin(tilt) * dist, h = Math.cos(tilt) * dist;
  cam.position.set(look.x + Math.sin(yaw) * h, look.y + y, look.z + Math.cos(yaw) * h);
  const sh = LD.ui.shake; if (sh > 0) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * sh * 0.01, (Math.random() - 0.5) * sh * 0.01, 0));
  cam.lookAt(look);
}

// ---------- board ----------
const Board = {
  tiles: [], lavaLights: [],
  build() {
    const top = tex('assets/img/tile.png');
    const sideTex = tex('assets/img/tile.png'); sideTex.repeat.set(1, 0.3);
    const lavaMap = tex('assets/img/lava.png'); lavaMap.wrapS = lavaMap.wrapT = THREE.RepeatWrapping; this.lavaMap = lavaMap;
    const geo = new THREE.BoxGeometry(0.96, 0.5, 0.96); geo.translate(0, -0.25, 0);
    const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, color: 0x8a7a6a, roughness: 0.95 });
    const bottomMat = new THREE.MeshStandardMaterial({ color: 0x3d2a1a, roughness: 1 });
    const flat = () => { const g = new THREE.PlaneGeometry(0.96, 0.96); g.rotateX(-Math.PI / 2); return g; };
    const lavaGeo = flat(), crackGeo = flat();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const topMat = new THREE.MeshStandardMaterial({ map: top, roughness: 0.9, emissive: 0xff5a00, emissiveIntensity: 0 });
      const mesh = new THREE.Mesh(geo, [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat]);
      mesh.position.set(cellX(c), 0, cellZ(r)); mesh.receiveShadow = true; mesh.castShadow = true; S3.add(mesh);
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const ct = new THREE.CanvasTexture(cv); ct.colorSpace = THREE.SRGBColorSpace;
      const crackMesh = new THREE.Mesh(crackGeo, new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, toneMapped: false }));
      crackMesh.position.y = 0.006; crackMesh.visible = false; crackMesh.renderOrder = 2; mesh.add(crackMesh);
      const lavaMat = new THREE.MeshStandardMaterial({ map: lavaMap, emissiveMap: lavaMap, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.4, transparent: true });
      const lava = new THREE.Mesh(lavaGeo, lavaMat); lava.position.set(cellX(c), -0.3, cellZ(r)); lava.visible = false; S3.add(lava);
      this.tiles.push({ c, r, mesh, topMat, crackMesh, cv, cx2: cv.getContext('2d'), ct, lava, lavaMat });
    }
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 3.2, 1.6, 8, 1), new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1, flatShading: true }));
    base.rotation.y = Math.PI / 8; base.position.y = -1.32; base.receiveShadow = true; S3.add(base);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(6.3, 0.5, 6.3), new THREE.MeshStandardMaterial({ color: 0x3d2a1a, roughness: 1 }));
    rim.position.y = -0.31; rim.receiveShadow = true; S3.add(rim);
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(4.65, 4.65, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0x5aa83c, roughness: 1, flatShading: true }));
    grass.rotation.y = Math.PI / 8; grass.position.y = -0.55; grass.receiveShadow = true; S3.add(grass);
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff6a1a, 0, 2.6, 1.6); l.position.y = 0.4; S3.add(l); this.lavaLights.push(l); }
  },
  reset() { for (const t of this.tiles) { t.mesh.position.y = 0; t.topMat.emissiveIntensity = 0; t.crackMesh.visible = false; t.lava.visible = false; } },
  drawCrack(tile, h, k) {
    const g = tile.cx2, S = 128;
    g.clearRect(0, 0, S, S);
    if (IMG.crack.naturalWidth) { g.globalAlpha = Math.min(1, 0.5 + k * 0.7); g.drawImage(IMG.crack, 0, 0, S, S); g.globalAlpha = 1; }
    const prog = Math.min(1, Math.pow(k * 1.15, 0.7)) * 4;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [0, 1]) {
      g.strokeStyle = pass ? 'rgba(255,' + (200 - k * 80 | 0) + ',60,' + (0.4 + k * 0.6) + ')' : '#1a0d05';
      g.lineWidth = pass ? 2.5 : 7;
      for (const br of h.cracks) {
        g.beginPath(); g.moveTo(br[0][0] * S, br[0][1] * S);
        for (let s = 1; s < br.length; s++) {
          const f = Math.min(1, Math.max(0, prog - (s - 1))); if (f <= 0) break;
          g.lineTo((br[s - 1][0] + (br[s][0] - br[s - 1][0]) * f) * S, (br[s - 1][1] + (br[s][1] - br[s - 1][1]) * f) * S);
        }
        g.stroke();
      }
    }
    tile.ct.needsUpdate = true;
  },
  update(G) {
    const t = G ? G.t : 0, map = {}, tm = time();
    if (G) for (const h of G.hazards) { const ph = LD.phase(h, t); if (ph !== 'wait' && ph !== 'done') map[h.c + h.r * COLS] = { h, ph }; }
    let li = 0;
    this.lavaMap.offset.set(tm * 0.03, tm * 0.02);
    for (const tile of this.tiles) {
      const m = map[tile.c + tile.r * COLS];
      if (!m) {
        tile.mesh.position.set(cellX(tile.c), tile.mesh.position.y * 0.8, cellZ(tile.r));
        tile.topMat.emissiveIntensity *= 0.85; tile.crackMesh.visible = false; tile.lava.visible = false;
        continue;
      }
      const h = m.h, a = t - h.t0;
      if (m.ph === 'crack') {
        const k = a / h.warn, late = k > 0.65, pulse = late ? 0.5 + 0.5 * Math.sin(tm * 30) : 0;
        const j = late ? (Math.random() - 0.5) * 0.05 * (k - 0.65) / 0.35 * 2 : 0;
        tile.mesh.position.set(cellX(tile.c) + j, -k * 0.03, cellZ(tile.r) + j * 0.6);
        tile.topMat.emissiveIntensity = 0.08 + k * 0.4 + pulse * 0.25;
        tile.crackMesh.visible = true; this.drawCrack(tile, h, k); tile.lava.visible = false;
      } else {
        const la = a - h.warn, cool = m.ph === 'cool', ck = cool ? (la - BAL.lavaTime) / BAL.coolTime : 0;
        tile.crackMesh.visible = false;
        tile.mesh.position.set(cellX(tile.c), cool ? -0.55 * (1 - ck) : -0.55 * Math.min(1, la / 0.08), cellZ(tile.r));
        tile.topMat.emissiveIntensity = cool ? 0.4 * (1 - ck) : 0.6;
        tile.lava.visible = true;
        tile.lava.position.y = cool ? 0.02 - 0.3 * ck : -0.3 + Math.min(1, la / 0.1) * 0.34 + Math.sin(tm * 9 + tile.c) * 0.015;
        const pop = cool ? 1 : 1 + Math.max(0, 0.12 - la) * 1.6; tile.lava.scale.set(pop, 1, pop);
        tile.lavaMat.emissiveIntensity = cool ? 1.6 * (1 - ck) : 1.5 + 0.4 * Math.sin(tm * 12 + tile.r);
        tile.lavaMat.opacity = cool ? 1 - ck : 1;
        if (!cool && li < this.lavaLights.length) { const l = this.lavaLights[li++]; l.position.x = cellX(tile.c); l.position.z = cellZ(tile.r); l.intensity = 2.2 + Math.sin(tm * 14) * 0.4; }
      }
    }
    for (; li < this.lavaLights.length; li++) this.lavaLights[li].intensity = 0;
  },
};

// ---------- ice cubes ----------
const IceView = {
  pool: [],
  build() {
    const geo = new THREE.BoxGeometry(0.44, 0.44, 0.44);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8f6ff, emissive: 0x5fd0ff, emissiveIntensity: 0.7, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85 });
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff }));
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.add(edge.clone()); m.visible = false; S3.add(m); this.pool.push(m); }
  },
  update(G) {
    const tm = time();
    this.pool.forEach((m, i) => {
      const o = G && G.ice[i];
      if (!o) { m.visible = false; return; }
      const age = G.t - o.t0, left = BAL.iceLife - age;
      m.visible = !(left < 2 && Math.floor(age * 8) % 2);
      m.scale.setScalar(Math.min(1, age * 5));
      m.position.set(cellX(o.c), 0.38 + Math.sin(tm * 4 + o.c) * 0.06, cellZ(o.r));
      m.rotation.set(0.5, tm * 1.6 + i, 0.3);
    });
  },
};

// ---------- Olafs ----------
const CHAR = new THREE.Color(0x222222);
let olafTemplate = null;
// Player 2: same model, texture hue-shifted so the blue goggles and feet turn purple.
function purpleTexture(map) {
  const img = map.image, c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const r = a[i], gg = a[i + 1], b = a[i + 2];
    if (b > r + 25 && b > gg + 5) { a[i] = Math.min(255, b * 0.8 + r * 0.2 + 30); a[i + 1] = gg * 0.55; }
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = map.colorSpace; t.flipY = map.flipY; t.wrapS = map.wrapS; t.wrapT = map.wrapT;
  return t;
}
function makeOlaf(id) {
  const o = { id, mats: [], base: [] };
  o.root = new THREE.Group(); o.tilt = new THREE.Group(); o.yaw = new THREE.Group(); o.pivot = new THREE.Group();
  o.root.add(o.tilt); o.tilt.add(o.yaw); o.yaw.add(o.pivot); S3.add(o.root);
  o.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  o.shadow.rotation.x = -Math.PI / 2; o.shadow.position.y = 0.012; S3.add(o.shadow);
  const model = olafTemplate.clone(true);
  model.traverse(m => {
    if (!m.isMesh) return;
    m.castShadow = true;
    const ms = (Array.isArray(m.material) ? m.material : [m.material]).map(src => {
      const mat = src.clone();
      if (id === 1 && mat.map && mat.map.image) mat.map = purpleTexture(mat.map);
      else if (id === 1 && !mat.map) mat.color.offsetHSL(0.12, 0, 0);
      o.mats.push(mat); o.base.push(mat.color.clone());
      return mat;
    });
    m.material = Array.isArray(m.material) ? ms : ms[0];
  });
  o.pivot.add(model);
  return o;
}
function fitModel(obj, height) {
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const s = height / size.y; obj.scale.setScalar(s); obj.position.set(-ctr.x * s, -box.min.y * s, -ctr.z * s);
  const g = new THREE.Group(); g.add(obj); return g;
}
function proceduralOlaf() { // fallback if the GLB is missing
  const g = new THREE.Group(), M = (c, r) => new THREE.MeshStandardMaterial({ color: c, roughness: r || 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 24), M(0xf0a63a)); body.position.y = 0.55; g.add(body);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.12, 16, 40), M(0x3d8bfd)); band.position.y = 0.62; band.rotation.x = Math.PI / 2; g.add(band);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), M(0xffffff, 0.3)); eye.position.set(sx * 0.15, 0.64, 0.4); g.add(eye);
    const st = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), M(0xffffff, 0.9)); st.position.set(sx * 0.13, 0.46, 0.36); g.add(st);
    const ft = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), M(0x3d8bfd)); ft.position.set(sx * 0.17, 0.08, 0.08); ft.scale.set(1, 0.6, 1.4); g.add(ft);
  }
  return g;
}
const olafReady = new Promise(res => {
  new GLTFLoader().load('assets/olaf.glb', g => { olafTemplate = fitModel(g.scene, 1.05); loaded++; res(); },
    undefined, () => { olafTemplate = fitModel(proceduralOlaf(), 1.05); loaded++; res(); });
});
const olafs = [];
function poseOlaf(o, p, dt) {
  const tm = time();
  let x = 0, z = 0, hop = 0, sx = 1, sy = 1, lx = 0, lz = 0, char = 0, glow = 0;
  if (p) {
    const a = LD.playerAnim(p); x = cellX(a.c); z = cellZ(a.r); hop = a.hop * 0.42;
    if (!p.alive) {
      const d = Math.min(p.deathT, 1.3); hop = Math.sin(Math.min(1, d / 0.5) * Math.PI) * 0.6;
      const sq = d > 0.5 ? Math.max(0.6, 1 - (d - 0.5) * 0.6) : 1; sx = 1 + (1 - sq) * 0.5; sy = sq; char = Math.min(1, d * 2.5);
    } else {
      if (p.mv) {
        const k = a.k, s = Math.sin(Math.PI * k);
        sx = 1 - 0.14 * s; sy = 1 + 0.18 * s; lx = p.mv.dx * 0.3 * s; lz = p.mv.dy * 0.3 * s;
        if (k < 0.2) { sx = 1 + 0.15 * (1 - k / 0.2); sy = 1 - 0.12 * (1 - k / 0.2); }
      } else if (p.land > 0) { const e = p.land / 0.14; sx = 1 + 0.22 * e; sy = 1 - 0.2 * e; }
      else { sy = 1 + 0.035 * Math.sin(tm * 5.5 + p.id); sx = 1 - 0.02 * Math.sin(tm * 5.5 + p.id); }
      let d = p.face - o.yaw.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      o.yaw.rotation.y += d * Math.min(1, dt * 28);           // face the way he's moving
      if (p.heat > 70) glow = (p.heat - 70) / 30 * (0.6 + 0.4 * Math.sin(tm * 10));
    }
  } else { // title: hop in place
    const k = (tm * 1.3) % 1; hop = k < 0.35 ? Math.sin(k / 0.35 * Math.PI) * 0.35 : 0;
    if (k > 0.35 && k < 0.47) { const e = 1 - (k - 0.35) / 0.12; sx = 1 + 0.2 * e; sy = 1 - 0.18 * e; }
    z = 0.5; o.yaw.rotation.y += (Math.sin(tm * 0.8) * 0.5 - o.yaw.rotation.y) * 0.05;
  }
  o.root.position.set(x, hop, z);
  o.pivot.scale.set(sx, sy, sx);
  o.tilt.rotation.set(lz, 0, -lx);
  o.shadow.position.set(x, 0.012, z);
  const sk = 1 - Math.min(0.5, hop); o.shadow.scale.setScalar(sk); o.shadow.material.opacity = 0.28 * sk;
  o.mats.forEach((m, i) => { m.color.copy(o.base[i]).lerp(CHAR, char * 0.75); if (m.emissive) m.emissive.setRGB(glow * 0.6, glow * 0.1, 0); });
}

// ---------- particles ----------
const FX = {
  pool: [], live: [],
  build() {
    const geo = new THREE.IcosahedronGeometry(0.06, 0);
    for (let i = 0; i < 120; i++) { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false })); m.visible = false; S3.add(m); this.pool.push(m); }
  },
  clear() { for (const q of this.live) { q.m.visible = false; this.pool.push(q.m); } this.live = []; },
  emit(x, y, z, n, color, spd, up, size, life, grav) {
    for (let i = 0; i < n; i++) {
      const m = this.pool.pop(); if (!m) return;
      const a = Math.random() * Math.PI * 2, v = spd * (0.4 + Math.random() * 0.6);
      m.material.color.set(color); m.visible = true; m.position.set(x, y, z);
      this.live.push({ m, vx: Math.cos(a) * v, vy: up * (0.5 + Math.random() * 0.8), vz: Math.sin(a) * v, life: 0, max: life * (0.6 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.7), grav });
    }
  },
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const q = this.live[i]; q.life += dt; q.vy -= q.grav * dt;
      q.m.position.x += q.vx * dt; q.m.position.y += q.vy * dt; q.m.position.z += q.vz * dt;
      const a = 1 - q.life / q.max; q.m.material.opacity = Math.max(0, a); q.m.scale.setScalar(q.size * (0.5 + a * 0.5));
      if (q.life > q.max) { q.m.visible = false; this.pool.push(q.m); this.live.splice(i, 1); }
    }
  },
};
const at = p => { const a = LD.playerAnim(p); return [cellX(a.c), cellZ(a.r)]; };
LD.on('land', p => { const [x, z] = at(p); FX.emit(x, 0.05, z, 6, 0xe8dcc4, 0.9, 0.6, 1.1, 0.35, 3); });
LD.on('erupt', h => FX.emit(cellX(h.c), 0.1, cellZ(h.r), 9, 0xffa020, 0.8, 3.2, 1, 0.6, 9));
LD.on('ice', (p, c, r) => FX.emit(cellX(c), 0.35, cellZ(r), 14, 0xaee8ff, 1.6, 2, 1, 0.5, 5));
LD.on('death', (p, cause) => { const [x, z] = at(p); FX.emit(x, 0.6, z, 18, cause === 'heat' ? 0xff7840 : 0x555555, 0.7, 1.8, 2.2, 1.0, -0.5); });
LD.on('newgame', () => { FX.clear(); Board.reset(); });

// ---------- renderer hooks for the shared UI ----------
const _v = new THREE.Vector3();
LD.renderer = {
  tag: '3D',
  ready: Promise.all([imgReady, olafReady]).then(() => { olafs.push(makeOlaf(0), makeOlaf(1)); }),
  progress: () => loaded / total,
  layout(l) { L = l; fitCamera(); },
  reset() { Board.reset(); FX.clear(); },
  cellToScreen(c, r, h) {
    _v.set(cellX(c), h, cellZ(r)).project(cam);
    return { x: (_v.x * 0.5 + 0.5) * L.W, y: (-_v.y * 0.5 + 0.5) * L.H };
  },
  draw(ctx, scene, dt) {
    ctx.clearRect(0, 0, L.W, L.H);
    if (!olafs.length) return;
    const G = LD.G, inGame = !!G && !['title', 'menu2p', 'hosting', 'joining', 'loading'].includes(scene);
    FX.update(dt);
    Board.update(inGame ? G : null); IceView.update(inGame ? G : null);
    olafs.forEach((o, i) => {
      const p = inGame ? G.players[i] : (i === 0 ? null : undefined);
      o.root.visible = o.shadow.visible = p !== undefined;
      if (p !== undefined) poseOlaf(o, p, dt);
    });
    placeCamera(inGame);
    R.render(S3, cam);
  },
};
init3D();
LD.start();
window.__ld = LD;
