/* LavaDodge: Overheat 3D — iPhone remake in three.js.
 * Same rules as the 2D remake; the board, Olaf, lava and effects are 3D,
 * the HUD / menus are drawn on a 2D canvas on top. Original game by William Yao (2017).
 */
import * as THREE from 'three';
import { GLTFLoader } from './lib/loaders/GLTFLoader.js';

// ---------- Tunables (balance lives here) ----------
const COLS = 6, ROWS = 6;
const BAL = {
  levelEvery: 12, maxLevel: 20,
  spawnStart: 1.0, spawnMin: 0.3, spawnStep: 0.05,
  warnStart: 1.15, warnMin: 0.55, warnStep: 0.035,
  lavaTime: 0.75, coolTime: 0.35, moveTime: 0.12,
  heatBase: 3.0, heatPerLevel: 0.18, heatAdjLava: 5, iceCool: 38,
  iceEvery: [3.6, 5.4], iceLife: 7, iceMax: 2,
  ptsPerSec: 10, icePts: 25, closePts: 5,
  lavaGrace: 0.08,
};

// ---------- Canvases / layout ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const glCanvas = document.getElementById('three');
const safeEl = document.getElementById('safe');
let W = 0, H = 0, DPR = 1, L = {};

function readSafe() {
  const cs = getComputedStyle(safeEl);
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0, right: parseFloat(cs.paddingRight) || 0 };
}

function layout() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const s = readSafe();
  const top = Math.max(s.top, 10) + 6, hud = 78, bottom = Math.max(s.bottom, 10) + 6;
  const avail = H - top - hud - bottom;
  const board = Math.min(W - 20 - s.left - s.right, avail * 0.62, 560);
  const rest = avail - board;
  const btn = Math.max(40, Math.min(board / 6 * 1.2, rest / 3.4, 92));
  const boardY = top + hud + 6;
  const padCy = Math.min(H - bottom - btn * 1.6, boardY + board + 10 + Math.max(btn * 1.6, rest / 2));
  L = {
    top, hud, board, boardY, btn, boardCx: W / 2, boardCy: boardY + board / 2,
    pad: {
      up: { x: W / 2, y: padCy - btn * 1.05, dir: [0, -1] },
      down: { x: W / 2, y: padCy + btn * 1.05, dir: [0, 1] },
      left: { x: W / 2 - btn * 1.15, y: padCy, dir: [-1, 0] },
      right: { x: W / 2 + btn * 1.15, y: padCy, dir: [1, 0] },
    },
    sound: { x: W - s.right - 30, y: top + 20, r: 19 },
    pause: { x: W - s.right - 74, y: top + 20, r: 19 },
    safe: s,
  };
  if (R) resize3D();
}

// ---------- Storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

// ---------- 2D images (UI) ----------
const IMG = {};
let loaded = 0; const total = 9;
function loadImg(name, src) {
  return new Promise(res => { const i = new Image(); i.onload = i.onerror = () => { loaded++; res(i); }; i.src = src; IMG[name] = i; });
}
const imgReady = Promise.all(['olaf_burnt', 'btn_up', 'btn_down', 'btn_left', 'btn_right', 'tile', 'lava', 'crack'].map(n => loadImg(n, 'assets/img/' + n + '.png')));

// ---------- Audio (Web Audio for low latency on iOS) ----------
const Audio = {
  ctx: null, bufs: {}, music: null, master: null, musicGain: null,
  muted: store.get('ld_muted', false), unlocked: false, wantMusic: false,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 1; this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.45; this.musicGain.connect(this.master);
    ['music', 'move', 'game-over'].forEach(n => {
      fetch('assets/sfx/' + n + '.mp3').then(r => r.arrayBuffer())
        .then(b => new Promise((ok, bad) => this.ctx.decodeAudioData(b, ok, bad)))
        .then(buf => { this.bufs[n] = buf; if (n === 'music' && this.wantMusic) this.startMusic(); })
        .catch(() => {});
    });
  },
  unlock() {
    this.init(); if (!this.ctx) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
    if (!this.unlocked) { const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0); this.unlocked = true; }
  },
  play(name, vol, rate) {
    if (!this.ctx || !this.bufs[name]) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = this.bufs[name]; s.playbackRate.value = rate || 1; g.gain.value = vol == null ? 1 : vol;
    s.connect(g); g.connect(this.master); s.start();
  },
  startMusic() {
    this.wantMusic = true;
    if (!this.ctx || !this.bufs.music || this.music) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.bufs.music; s.loop = true; s.connect(this.musicGain); s.start(); this.music = s;
  },
  stopMusic() { this.wantMusic = false; if (this.music) { try { this.music.stop(); } catch (e) {} this.music = null; } },
  tone(freqs, dur, type, vol) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = type || 'sine'; o.frequency.value = f;
      const st = t0 + i * dur * 0.6;
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(vol || 0.18, st + 0.01); g.gain.exponentialRampToValueAtTime(0.001, st + dur);
      o.connect(g); g.connect(this.master); o.start(st); o.stop(st + dur + 0.02);
    });
  },
  sizzle(vol) {
    if (!this.ctx) return;
    const len = 0.22, b = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8; g.gain.value = vol || 0.12;
    s.buffer = b; s.connect(f); f.connect(g); g.connect(this.master); s.start();
  },
  toggle() { this.muted = !this.muted; store.set('ld_muted', this.muted); if (this.master) this.master.gain.value = this.muted ? 0 : 1; },
};

// ---------- RNG ----------
function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
let rng = Math.random;
const ri = n => Math.floor(rng() * n);
const rr = (a, b) => a + rng() * (b - a);
function todayKey() { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

// ---------- Game state ----------
let scene = 'loading'; // loading | title | play | paused | dying | over
let G = null, time = 0;
const floaters = [];
let shake = 0, flash = 0, banner = null;

function newGame(daily) {
  rng = daily ? mulberry32(todayKey()) : Math.random;
  G = {
    daily, t: 0, score: 0, bonus: 0, level: 1, heat: 0,
    hazards: [], ice: [], nextSpawn: 1.2, nextIce: 3,
    p: { c: 2, r: 3, mv: null, queue: null, land: 0, bumpT: 0, bump: [0, 0], face: 0, idleT: 0 },
    stats: { ice: 0, close: 0 }, iceCombo: 0, lastIce: -99, cause: '',
  };
  floaters.length = 0; FX.clear(); Board.reset(); IceView.clear();
  banner = { text: daily ? 'DAILY RUN' : 'GO!', t: 0 };
  scene = 'play';
  Audio.startMusic();
}

const level = t => Math.min(BAL.maxLevel, 1 + Math.floor(t / BAL.levelEvery));
const spawnInterval = lv => Math.max(BAL.spawnMin, BAL.spawnStart - BAL.spawnStep * (lv - 1));
const warnTime = lv => Math.max(BAL.warnMin, BAL.warnStart - BAL.warnStep * (lv - 1));

function phase(h, t) {
  const a = t - h.t0;
  if (a < 0) return 'wait';
  if (a < h.warn) return 'crack';
  if (a < h.warn + BAL.lavaTime) return 'lava';
  if (a < h.warn + BAL.lavaTime + BAL.coolTime) return 'cool';
  return 'done';
}
function lavaAt(list, c, r, t, margin) {
  for (const h of list) {
    if (h.c !== c || h.r !== r) continue;
    const s = h.t0 + h.warn - margin, e = h.t0 + h.warn + BAL.lavaTime + margin;
    if (t >= s && t < e) return true;
  }
  return false;
}
// Fairness: a human-speed path must exist off the lava for the next few seconds.
function survivable(list, pc, pr, now) {
  const step = 0.2, steps = 16, react = 2;
  let cur = new Set([pc + pr * COLS]);
  for (let k = 1; k <= steps; k++) {
    const t = now + k * step, nxt = new Set();
    for (const id of cur) {
      const c = id % COLS, r = (id / COLS) | 0;
      const opts = k <= react ? [[0, 0]] : [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of opts) {
        const nc = c + dx, nr = r + dy;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        if (!lavaAt(list, nc, nr, t, 0.08) && !lavaAt(list, nc, nr, t - step / 2, 0.08)) nxt.add(nc + nr * COLS);
      }
    }
    if (!nxt.size) return false;
    cur = nxt;
  }
  return true;
}

const PATTERNS = {
  single: { min: 1, w: lv => 6 - Math.min(4, lv * 0.4) },
  scatter: { min: 2, w: lv => 2 + lv * 0.25 },
  hunt: { min: 3, w: lv => 2 + lv * 0.2 },
  line: { min: 3, w: lv => 1.5 + lv * 0.15 },
  plus: { min: 4, w: lv => 1.2 + lv * 0.1 },
  block: { min: 5, w: lv => 1.2 + lv * 0.1 },
  ring: { min: 6, w: () => 0.9 },
  sweep: { min: 7, w: () => 0.8 },
  checker: { min: 9, w: () => 0.5 },
};
function pickPattern(lv) {
  const opts = Object.keys(PATTERNS).filter(k => lv >= PATTERNS[k].min);
  let sum = 0; const ws = opts.map(k => (sum += Math.max(0.1, PATTERNS[k].w(lv))));
  const x = rng() * sum;
  return opts[ws.findIndex(w => x < w)];
}
const inB = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
function cellsFor(kind, lv, p) {
  const out = [];
  const add = (c, r, d, w) => { if (inB(c, r) && !out.some(o => o[0] === c && o[1] === r)) out.push([c, r, d || 0, w || 0]); };
  switch (kind) {
    case 'single': add(ri(COLS), ri(ROWS)); break;
    case 'scatter': { const n = 2 + Math.min(3, Math.floor(lv / 4)) + ri(2); for (let i = 0; i < n * 3 && out.length < n; i++) add(ri(COLS), ri(ROWS)); break; }
    case 'hunt': add(p.c, p.r); if (lv >= 6) { const d = [[1, 0], [-1, 0], [0, 1], [0, -1]][ri(4)]; add(p.c + d[0], p.r + d[1]); } break;
    case 'line': {
      const row = rng() < 0.5, i = rng() < 0.55 ? (row ? p.r : p.c) : ri(row ? ROWS : COLS), gap = lv < 8 ? ri(COLS) : -1;
      for (let k = 0; k < COLS; k++) if (k !== gap) row ? add(k, i, k * 0.04) : add(i, k, k * 0.04);
      break;
    }
    case 'plus': {
      const c = rng() < 0.5 ? p.c : ri(COLS), r = rng() < 0.5 ? p.r : ri(ROWS), rad = lv >= 10 ? 2 : 1;
      add(c, r); for (let k = 1; k <= rad; k++) { add(c + k, r); add(c - k, r); add(c, r + k); add(c, r - k); }
      break;
    }
    case 'block': {
      const s = lv >= 11 && rng() < 0.4 ? 3 : 2, c = ri(COLS - s + 1), r = ri(ROWS - s + 1);
      for (let x = 0; x < s; x++) for (let y = 0; y < s; y++) add(c + x, r + y);
      break;
    }
    case 'ring': for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) if (x || y) add(p.c + x, p.r + y, 0, 0.15); break;
    case 'sweep': {
      const horiz = rng() < 0.5, rev = rng() < 0.5;
      for (let k = 0; k < 6; k++) { const idx = rev ? 5 - k : k, gap = ri(6); for (let j = 0; j < 6; j++) if (j !== gap) horiz ? add(idx, j, k * 0.32, 0.1) : add(j, idx, k * 0.32, 0.1); }
      break;
    }
    case 'checker': { const par = ri(2); for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) if ((x + y) % 2 === par) add(x, y, 0, 0.35); break; }
  }
  return out;
}

function makeCracks() {
  const cx = 0.5 + rr(-0.12, 0.12), cy = 0.5 + rr(-0.12, 0.12), branches = [], n = 4 + ri(3);
  for (let b = 0; b < n; b++) {
    let a = (b / n) * Math.PI * 2 + rr(-0.4, 0.4), x = cx, y = cy; const pts = [[x, y]];
    for (let s = 0; s < 4; s++) { a += rr(-0.6, 0.6); const len = rr(0.09, 0.14); x += Math.cos(a) * len; y += Math.sin(a) * len; pts.push([Math.max(0.04, Math.min(0.96, x)), Math.max(0.04, Math.min(0.96, y))]); }
    branches.push(pts);
  }
  return branches;
}

function spawnWave() {
  const lv = G.level, warn = warnTime(lv);
  const occupied = (c, r) => G.hazards.some(h => h.c === c && h.r === r && phase(h, G.t) !== 'cool');
  let wave = null;
  for (let attempt = 0; attempt < 7 && !wave; attempt++) {
    const kind = attempt < 5 ? pickPattern(lv) : 'single';
    const cells = cellsFor(kind, lv, G.p).filter(([c, r]) => !occupied(c, r));
    if (!cells.length) continue;
    const hs = cells.map(([c, r, d, w]) => ({ c, r, t0: G.t + d, warn: warn + w, cracks: makeCracks(), erupted: false }));
    if (survivable(G.hazards.concat(hs), G.p.c, G.p.r, G.t)) wave = { kind, hs };
  }
  if (!wave) { G.nextSpawn = G.t + 0.25; return; }
  G.hazards.push(...wave.hs);
  G.nextSpawn = G.t + spawnInterval(lv) * (1 + Math.min(1.6, 0.12 * (wave.hs.length - 1))) * rr(0.85, 1.15);
}

function spawnIce() {
  G.nextIce = G.t + rr(BAL.iceEvery[0], BAL.iceEvery[1]);
  if (G.ice.length >= BAL.iceMax) return;
  for (let i = 0; i < 20; i++) {
    const c = ri(COLS), r = ri(ROWS);
    if (Math.abs(c - G.p.c) + Math.abs(r - G.p.r) < 2) continue;
    if (G.ice.some(o => o.c === c && o.r === r) || G.hazards.some(h => h.c === c && h.r === r)) continue;
    G.ice.push({ c, r, t0: G.t, id: Math.random() });
    return;
  }
}

function tryMove(dx, dy) {
  if (scene !== 'play') return;
  const p = G.p;
  if (p.mv) { p.queue = [dx, dy]; return; }
  const nc = p.c + dx, nr = p.r + dy;
  if (!inB(nc, nr)) { p.land = 0.12; p.bump = [dx, dy]; p.bumpT = 0.12; return; }
  p.mv = { fc: p.c, fr: p.r, dx, dy, t: 0 };
  p.c = nc; p.r = nr; p.idleT = 0;
  p.face = Math.atan2(dx, dy); // face the hop direction (0 = toward the camera)
  Audio.play('move', 0.55, 0.95 + Math.random() * 0.1);
}

// World position of a cell center (top surface at y = 0).
const cellX = c => c - (COLS - 1) / 2;
const cellZ = r => r - (ROWS - 1) / 2;

function playerWorld() {
  const p = G.p;
  let c = p.c, r = p.r, hop = 0;
  if (p.mv) {
    const k = Math.min(1, p.mv.t / BAL.moveTime), e = 1 - (1 - k) * (1 - k);
    c = p.mv.fc + p.mv.dx * e; r = p.mv.fr + p.mv.dy * e;
    hop = Math.sin(Math.PI * k) * 0.42;
  }
  let bx = 0, bz = 0;
  if (p.bumpT > 0) { const b = Math.sin((p.bumpT / 0.12) * Math.PI) * 0.08; bx = p.bump[0] * b; bz = p.bump[1] * b; }
  return { x: cellX(c) + bx, z: cellZ(r) + bz, hop };
}
function playerCell() { return [G.p.c, G.p.r]; } // counts as escaped the instant a hop starts

function floatText(wx, wy, wz, text, color, size) { floaters.push({ wx, wy, wz, text, color, size: size || 20, life: 0 }); }

// ---------- Update ----------
function update(dt) {
  time += dt;
  FX.update(dt);
  for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.life += dt; f.wy += 0.9 * dt; if (f.life > 0.9) floaters.splice(i, 1); }
  shake = Math.max(0, shake - dt * 30); flash = Math.max(0, flash - dt * 2.5);
  if (banner) { banner.t += dt; if (banner.t > 1.4) banner = null; }

  if (scene === 'dying') { G.deathT += dt; if (G.deathT > 1.3) { scene = 'over'; G.overT = 0; } return; }
  if (scene === 'over') { G.overT += dt; return; }
  if (scene !== 'play') return;

  G.t += dt;
  const p = G.p;
  if (p.mv) {
    p.mv.t += dt;
    if (p.mv.t >= BAL.moveTime) {
      p.mv = null; p.land = 0.14;
      const w = playerWorld(); FX.dust(w.x, w.z);
      if (p.queue) { const q = p.queue; p.queue = null; tryMove(q[0], q[1]); }
    }
  } else p.idleT += dt;
  p.land = Math.max(0, p.land - dt);
  if (p.bumpT > 0) p.bumpT -= dt;

  const lv = level(G.t);
  if (lv > G.level) { G.level = lv; banner = { text: 'HEAT ' + lv, t: 0 }; flash = 0.5; Audio.tone([523, 659, 784, 1047], 0.14, 'triangle', 0.12); }
  if (G.t >= G.nextSpawn) spawnWave();
  if (G.t >= G.nextIce) spawnIce();

  const [pc, pr] = playerCell();
  let adj = 0, sizzle = false;
  for (let i = G.hazards.length - 1; i >= 0; i--) {
    const h = G.hazards[i], ph = phase(h, G.t);
    if (ph === 'lava') {
      if (!h.erupted) {
        h.erupted = true; sizzle = true;
        FX.erupt(cellX(h.c), cellZ(h.r));
        G.ice = G.ice.filter(o => !(o.c === h.c && o.r === h.r));
        if (Math.abs(h.c - pc) + Math.abs(h.r - pr) === 1) {
          G.bonus += BAL.closePts; G.stats.close++; shake = Math.max(shake, 3);
          floatText(cellX(h.c), 0.6, cellZ(h.r), 'CLOSE! +' + BAL.closePts, '#ffe066', 16);
        }
      }
      if (h.c === pc && h.r === pr && G.t - (h.t0 + h.warn) >= BAL.lavaGrace) return die('lava');
      if (Math.abs(h.c - pc) + Math.abs(h.r - pr) === 1) adj++;
    } else if (ph === 'done') G.hazards.splice(i, 1);
  }
  if (sizzle) Audio.sizzle(0.08);

  for (let i = G.ice.length - 1; i >= 0; i--) {
    const o = G.ice[i];
    if (G.t - o.t0 > BAL.iceLife) { G.ice.splice(i, 1); continue; }
    if (o.c === p.c && o.r === p.r && (!p.mv || p.mv.t > BAL.moveTime * 0.5)) {
      G.ice.splice(i, 1);
      G.iceCombo = G.t - G.lastIce < 8 ? Math.min(3, G.iceCombo + 1) : 1; G.lastIce = G.t;
      const pts = BAL.icePts * G.iceCombo;
      G.bonus += pts; G.stats.ice++; G.heat = Math.max(0, G.heat - BAL.iceCool);
      FX.iceBurst(cellX(o.c), cellZ(o.r));
      floatText(cellX(o.c), 0.9, cellZ(o.r), (G.iceCombo > 1 ? 'x' + G.iceCombo + ' ' : '') + 'CHILL +' + pts, '#bff3ff', 18);
      Audio.tone([880, 1320, 1760].slice(0, 1 + G.iceCombo), 0.12, 'sine', 0.16);
    }
  }

  G.heat += dt * (BAL.heatBase + BAL.heatPerLevel * (G.level - 1) + adj * BAL.heatAdjLava);
  if (G.heat >= 100) { G.heat = 100; return die('heat'); }
  if (G.heat > 70 && Math.random() < dt * 6) { const w = playerWorld(); FX.sweat(w.x, w.z); }
  G.score = Math.floor(G.t * (BAL.ptsPerSec + (G.level - 1))) + G.bonus;
}

function die(cause) {
  G.cause = cause; scene = 'dying'; G.deathT = 0; shake = 10;
  Audio.stopMusic(); Audio.play('game-over', 0.8);
  const w = playerWorld(); FX.smoke(w.x, w.z, cause === 'heat');
  const key = G.daily ? 'ld_daily3d_' + todayKey() : 'ld_best3d';
  G.prevBest = store.get(key, 0); G.newBest = G.score > G.prevBest;
  if (G.newBest) store.set(key, G.score);
}

// =====================================================================
// 3D scene
// =====================================================================
let R = null, S3, cam, sun;
const texLoader = new THREE.TextureLoader();
function tex(src, srgb = true) { const t = texLoader.load(src); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

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
  sun.position.set(-4, 10, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.02;
  S3.add(sun);

  Board.build(); IceView.build(); FX.build(); Olaf.build();
  resize3D();
}

function resize3D() {
  R.setSize(W, H, false);
  cam.aspect = W / H;
  fitCamera();
}

// Camera framing: tilted view, sized so the board fills the 2D layout's board area.
let camMode = 'title', camBlend = 0;
function fitCamera() {
  const tilt = THREE.MathUtils.degToRad(50);
  const fovV = THREE.MathUtils.degToRad(cam.fov);
  const pxPerUnit = (L.board * 0.98) / COLS;
  // distance so that 1 world unit at the board center spans pxPerUnit pixels horizontally
  const dist = H / (2 * Math.tan(fovV / 2) * pxPerUnit);
  cam.userData.play = { dist, tilt };
  cam.clearViewOffset();
  cam.setViewOffset(W, H, 0, H / 2 - L.boardCy + 6, W, H);
  cam.updateProjectionMatrix();
}
function placeCamera() {
  const pd = cam.userData.play;
  if (!pd) return;
  let yaw = 0, dist = pd.dist, tilt = pd.tilt; const look = new THREE.Vector3(0, 0.2 * (1 - camBlend), 0.15 - 0.95 * (1 - camBlend));
  const targetBlend = camMode === 'play' ? 1 : 0;
  camBlend += (targetBlend - camBlend) * 0.08;
  if (camBlend < 0.999) { // title: slow orbit, a little closer
    const ty = Math.sin(time * 0.25) * 0.5, td = pd.dist * 0.62, tt = THREE.MathUtils.degToRad(32);
    yaw = ty * (1 - camBlend); dist = td + (pd.dist - td) * camBlend; tilt = tt + (pd.tilt - tt) * camBlend;
  }
  const y = Math.sin(tilt) * dist, h = Math.cos(tilt) * dist;
  cam.position.set(look.x + Math.sin(yaw) * h, look.y + y, look.z + Math.cos(yaw) * h);
  if (shake > 0) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * shake * 0.01, (Math.random() - 0.5) * shake * 0.01, 0));
  cam.lookAt(look);
}

// ---------- Board ----------
const Board = {
  tiles: [], base: null, lavaLights: [],
  build() {
    const top = tex('assets/img/tile.png');
    const sideTex = tex('assets/img/tile.png'); sideTex.repeat.set(1, 0.3);
    const lavaMap = tex('assets/img/lava.png'); lavaMap.wrapS = lavaMap.wrapT = THREE.RepeatWrapping;
    this.lavaMap = lavaMap;
    const geo = new THREE.BoxGeometry(0.96, 0.5, 0.96);
    geo.translate(0, -0.25, 0);
    const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, color: 0x8a7a6a, roughness: 0.95 });
    const bottomMat = new THREE.MeshStandardMaterial({ color: 0x3d2a1a, roughness: 1 });
    const lavaGeo = new THREE.PlaneGeometry(0.96, 0.96); lavaGeo.rotateX(-Math.PI / 2);
    const crackGeo = new THREE.PlaneGeometry(0.96, 0.96); crackGeo.rotateX(-Math.PI / 2);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const topMat = new THREE.MeshStandardMaterial({ map: top, roughness: 0.9, emissive: 0xff5a00, emissiveIntensity: 0 });
      const mesh = new THREE.Mesh(geo, [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat]);
      mesh.position.set(cellX(c), 0, cellZ(r));
      mesh.receiveShadow = true; mesh.castShadow = true;
      S3.add(mesh);
      // crack overlay: per-tile canvas texture (lines + fiery border)
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const ct = new THREE.CanvasTexture(cv); ct.colorSpace = THREE.SRGBColorSpace;
      const crackMesh = new THREE.Mesh(crackGeo, new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, toneMapped: false }));
      crackMesh.position.y = 0.006; crackMesh.visible = false; crackMesh.renderOrder = 2;
      mesh.add(crackMesh);
      // lava surface
      const lavaMat = new THREE.MeshStandardMaterial({ map: lavaMap, emissiveMap: lavaMap, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.4, transparent: true });
      const lava = new THREE.Mesh(lavaGeo, lavaMat);
      lava.position.set(cellX(c), -0.3, cellZ(r)); lava.visible = false;
      S3.add(lava);
      this.tiles.push({ c, r, mesh, topMat, crackMesh, cv, cx2: cv.getContext('2d'), ct, lava, lavaMat, hz: null });
    }
    // dirt island under the board
    const baseGeo = new THREE.CylinderGeometry(4.6, 3.2, 1.6, 8, 1);
    const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1, flatShading: true }));
    base.rotation.y = Math.PI / 8; base.position.y = -1.32; base.receiveShadow = true;
    S3.add(base);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(6.3, 0.5, 6.3), new THREE.MeshStandardMaterial({ color: 0x3d2a1a, roughness: 1 }));
    rim.position.y = -0.31; rim.receiveShadow = true; S3.add(rim);
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(4.65, 4.65, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0x5aa83c, roughness: 1, flatShading: true }));
    grass.rotation.y = Math.PI / 8; grass.position.y = -0.55; grass.receiveShadow = true; S3.add(grass);
    // pooled lava lights (fixed count avoids shader recompiles)
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff6a1a, 0, 2.6, 1.6); l.position.y = 0.4; S3.add(l); this.lavaLights.push(l); }
  },
  reset() {
    for (const t of this.tiles) { t.mesh.position.y = 0; t.topMat.emissiveIntensity = 0; t.crackMesh.visible = false; t.lava.visible = false; t.hz = null; }
  },
  drawCrack(tile, h, k) {
    const g = tile.cx2, S = 128;
    g.clearRect(0, 0, S, S);
    // fiery border, stronger as it gets closer to erupting
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
  update() {
    const t = G ? G.t : 0, map = {};
    if (G) for (const h of G.hazards) { const ph = phase(h, t); if (ph !== 'wait' && ph !== 'done') map[h.c + h.r * COLS] = { h, ph }; }
    let li = 0;
    this.lavaMap.offset.set(time * 0.03, time * 0.02);
    for (const tile of this.tiles) {
      const m = map[tile.c + tile.r * COLS];
      if (!m) {
        tile.mesh.position.set(cellX(tile.c), tile.mesh.position.y * 0.8, cellZ(tile.r));
        tile.topMat.emissiveIntensity *= 0.85; tile.crackMesh.visible = false; tile.lava.visible = false;
        continue;
      }
      const h = m.h, a = t - h.t0;
      if (m.ph === 'crack') {
        const k = a / h.warn, late = k > 0.65;
        const pulse = late ? 0.5 + 0.5 * Math.sin(time * 30) : 0;
        const j = late ? (Math.random() - 0.5) * 0.05 * (k - 0.65) / 0.35 * 2 : 0;
        tile.mesh.position.set(cellX(tile.c) + j, -k * 0.03, cellZ(tile.r) + j * 0.6);
        tile.topMat.emissiveIntensity = 0.08 + k * 0.4 + pulse * 0.25;
        tile.crackMesh.visible = true; this.drawCrack(tile, h, k);
        tile.lava.visible = false;
      } else {
        const la = a - h.warn, cool = m.ph === 'cool';
        const ck = cool ? (la - BAL.lavaTime) / BAL.coolTime : 0;
        tile.crackMesh.visible = false;
        // tile drops into the ground, lava wells up in its place
        const drop = cool ? -0.55 * (1 - ck) : -0.55 * Math.min(1, la / 0.08);
        tile.mesh.position.set(cellX(tile.c), drop, cellZ(tile.r));
        tile.topMat.emissiveIntensity = cool ? 0.4 * (1 - ck) : 0.6;
        tile.lava.visible = true;
        const rise = cool ? 0.02 - 0.3 * ck : -0.3 + Math.min(1, la / 0.1) * 0.34 + Math.sin(time * 9 + tile.c) * 0.015;
        tile.lava.position.y = rise;
        const pop = cool ? 1 : 1 + Math.max(0, 0.12 - la) * 1.6;
        tile.lava.scale.set(pop, 1, pop);
        tile.lavaMat.emissiveIntensity = cool ? 1.6 * (1 - ck) : 1.5 + 0.4 * Math.sin(time * 12 + tile.r);
        tile.lavaMat.opacity = cool ? 1 - ck : 1;
        if (!cool && li < this.lavaLights.length) {
          const l = this.lavaLights[li++]; l.position.x = cellX(tile.c); l.position.z = cellZ(tile.r); l.intensity = 2.2 + Math.sin(time * 14) * 0.4;
        }
      }
    }
    for (; li < this.lavaLights.length; li++) this.lavaLights[li].intensity = 0;
  },
};

// ---------- Ice cubes ----------
const IceView = {
  pool: [],
  build() {
    const geo = new THREE.BoxGeometry(0.44, 0.44, 0.44);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8f6ff, emissive: 0x5fd0ff, emissiveIntensity: 0.7, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85 });
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff }));
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.add(edge.clone()); m.visible = false; S3.add(m); this.pool.push(m);
    }
  },
  clear() { for (const m of this.pool) m.visible = false; },
  update() {
    this.pool.forEach((m, i) => {
      const o = G && G.ice[i];
      if (!o) { m.visible = false; return; }
      const age = G.t - o.t0, left = BAL.iceLife - age;
      m.visible = !(left < 2 && Math.floor(age * 8) % 2);
      const s = Math.min(1, age * 5);
      m.scale.setScalar(s);
      m.position.set(cellX(o.c), 0.38 + Math.sin(time * 4 + o.c) * 0.06, cellZ(o.r));
      m.rotation.set(0.5, time * 1.6 + i, 0.3);
    });
  },
};

// ---------- Olaf ----------
const CHAR = new THREE.Color(0x222222);
const Olaf = {
  root: null, model: null, mats: [], baseColors: [], height: 1.05, ready: false,
  build() {
    // root (position) > tilt (lean toward hop, world axes) > yaw (facing) > pivot (squash/stretch at the feet)
    this.root = new THREE.Group(); S3.add(this.root);
    this.tilt = new THREE.Group(); this.root.add(this.tilt);
    this.yaw = new THREE.Group(); this.tilt.add(this.yaw);
    this.pivot = new THREE.Group(); this.yaw.add(this.pivot);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.012; S3.add(this.shadow);
    new GLTFLoader().load('assets/olaf.glb', g => this.useModel(g.scene), undefined, () => this.useModel(this.procedural()));
  },
  useModel(obj) {
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    const s = this.height / size.y;
    obj.scale.setScalar(s);
    obj.position.set(-ctr.x * s, -box.min.y * s, -ctr.z * s);
    obj.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach(m => { if (m.emissive) { this.mats.push(m); this.baseColors.push(m.color.clone()); } });
      }
    });
    this.pivot.add(obj); this.model = obj; this.ready = true;
  },
  procedural() { // fallback if the GLB is missing: built from primitives in Olaf's colors
    const g = new THREE.Group(), M = (c, r) => new THREE.MeshStandardMaterial({ color: c, roughness: r || 0.6 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 24), M(0xf0a63a)); body.position.y = 0.55; body.scale.set(1, 0.92, 0.9); g.add(body);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.12, 16, 40), M(0x3d8bfd)); band.position.y = 0.62; band.rotation.x = Math.PI / 2; band.scale.set(1.08, 1, 1.2); g.add(band);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), M(0xffffff, 0.3)); eye.position.set(sx * 0.15, 0.64, 0.4); g.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), M(0x111111)); pupil.position.set(sx * 0.15, 0.64, 0.5); g.add(pupil);
      const stache = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), M(0xffffff, 0.9)); stache.position.set(sx * 0.13, 0.46, 0.36); stache.scale.set(1.3, 0.8, 0.8); g.add(stache);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), M(0x3d8bfd)); foot.position.set(sx * 0.17, 0.08, 0.08); foot.scale.set(1, 0.6, 1.4); g.add(foot);
    }
    return g;
  },
  update(dt) {
    if (!this.ready) return;
    let x = 0, z = 0, hop = 0, sx = 1, sy = 1, lx = 0, lz = 0, char = 0, heatGlow = 0;
    if (G && scene !== 'title') {
      const w = playerWorld(), p = G.p; x = w.x; z = w.z; hop = w.hop;
      if (scene === 'dying' || scene === 'over') {
        const d = Math.min(G.deathT || 1.3, 1.3);
        hop = Math.sin(Math.min(1, d / 0.5) * Math.PI) * 0.6;
        const sq = d > 0.5 ? Math.max(0.6, 1 - (d - 0.5) * 0.6) : 1; sx = 1 + (1 - sq) * 0.5; sy = sq;
        char = Math.min(1, d * 2.5);
      } else {
        if (p.mv) {
          const k = Math.min(1, p.mv.t / BAL.moveTime), s = Math.sin(Math.PI * k);
          sx = 1 - 0.14 * s; sy = 1 + 0.18 * s; lx = p.mv.dx * 0.3 * s; lz = p.mv.dy * 0.3 * s;
          if (k < 0.2) { sx = 1 + 0.15 * (1 - k / 0.2); sy = 1 - 0.12 * (1 - k / 0.2); }
        } else if (p.land > 0) { const e = p.land / 0.14; sx = 1 + 0.22 * e; sy = 1 - 0.2 * e; }
        else { sy = 1 + 0.035 * Math.sin(time * 5.5); sx = 1 - 0.02 * Math.sin(time * 5.5); }
        // turn partway toward left/right hops (face stays visible), drift back when idle
        // turn to face the way he's moving (shortest way round) and keep facing it
        let d = p.face - this.yaw.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw.rotation.y += d * Math.min(1, dt * 28);
        if (G.heat > 70) heatGlow = (G.heat - 70) / 30 * (0.6 + 0.4 * Math.sin(time * 10));
      }
    } else { // title: hop in place on the middle of the board
      const k = (time * 1.3) % 1; hop = k < 0.35 ? Math.sin(k / 0.35 * Math.PI) * 0.35 : 0;
      if (k > 0.35 && k < 0.47) { const e = 1 - (k - 0.35) / 0.12; sx = 1 + 0.2 * e; sy = 1 - 0.18 * e; }
      x = 0; z = 0.5; this.yaw.rotation.y += (Math.sin(time * 0.8) * 0.5 - this.yaw.rotation.y) * 0.05;
    }
    this.root.position.set(x, hop, z);
    this.pivot.scale.set(sx, sy, sx);
    this.tilt.rotation.set(lz, 0, -lx); // lean into the hop
    this.shadow.position.set(x, 0.012, z);
    const sk = 1 - Math.min(0.5, hop);
    this.shadow.scale.setScalar(sk); this.shadow.material.opacity = 0.28 * sk;
    // burnt / overheating tint
    this.mats.forEach((m, i) => {
      m.color.copy(this.baseColors[i]).lerp(CHAR, char * 0.75);
      m.emissive.setRGB(heatGlow * 0.6, heatGlow * 0.1, 0);
    });
  },
};

// ---------- Particles (pooled small meshes) ----------
const FX = {
  pool: [], live: [],
  build() {
    const geo = new THREE.IcosahedronGeometry(0.06, 0);
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
      m.visible = false; S3.add(m); this.pool.push(m);
    }
  },
  clear() { for (const q of this.live) q.m.visible = false; this.pool.push(...this.live.map(q => q.m)); this.live = []; },
  emit(x, y, z, n, color, spd, up, size, life, grav) {
    for (let i = 0; i < n; i++) {
      const m = this.pool.pop(); if (!m) return;
      const a = Math.random() * Math.PI * 2, v = spd * (0.4 + Math.random() * 0.6);
      m.material.color.set(color); m.visible = true; m.position.set(x, y, z);
      this.live.push({ m, vx: Math.cos(a) * v, vy: up * (0.5 + Math.random() * 0.8), vz: Math.sin(a) * v, life: 0, max: life * (0.6 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.7), grav });
    }
  },
  dust(x, z) { this.emit(x, 0.05, z, 6, 0xe8dcc4, 0.9, 0.6, 1.1, 0.35, 3); },
  erupt(x, z) { this.emit(x, 0.1, z, 9, 0xffa020, 0.8, 3.2, 1, 0.6, 9); },
  iceBurst(x, z) { this.emit(x, 0.35, z, 14, 0xaee8ff, 1.6, 2, 1, 0.5, 5); },
  sweat(x, z) { this.emit(x, 0.95, z, 1, 0x7cc8ff, 0.6, 1.5, 0.9, 0.45, 6); },
  smoke(x, z, heat) { this.emit(x, 0.6, z, 18, heat ? 0xff7840 : 0x555555, 0.7, 1.8, 2.2, 1.0, -0.5); },
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const q = this.live[i]; q.life += dt;
      q.vy -= q.grav * dt; q.m.position.x += q.vx * dt; q.m.position.y += q.vy * dt; q.m.position.z += q.vz * dt;
      const a = 1 - q.life / q.max; q.m.material.opacity = Math.max(0, a); q.m.scale.setScalar(q.size * (0.5 + a * 0.5));
      if (q.life > q.max) { q.m.visible = false; this.pool.push(q.m); this.live.splice(i, 1); }
    }
  },
};

function render3D(dt) {
  camMode = (scene === 'title' || scene === 'loading') ? 'title' : 'play';
  if (camMode === 'title') { Board.update(); } else Board.update();
  IceView.update(); Olaf.update(dt);
  placeCamera();
  R.render(S3, cam);
}
const _v = new THREE.Vector3();
function toScreen(x, y, z) { _v.set(x, y, z).project(cam); return { x: (_v.x * 0.5 + 0.5) * W, y: (-_v.y * 0.5 + 0.5) * H }; }

// =====================================================================
// 2D overlay (HUD, pad, menus) — same look as the 2D remake
// =====================================================================
const FONT = '"Arial Rounded MT Bold", "SF Pro Rounded", ui-rounded, "Helvetica Neue", Arial, sans-serif';
function text(str, x, y, size, fill, opts) {
  opts = opts || {};
  ctx.font = (opts.weight || '900') + ' ' + size + 'px ' + FONT;
  ctx.textAlign = opts.align || 'center'; ctx.textBaseline = 'middle';
  if (opts.stroke !== false) { ctx.lineJoin = 'round'; ctx.lineWidth = opts.lw || Math.max(3, size * 0.18); ctx.strokeStyle = opts.stroke || '#000'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = fill; ctx.fillText(str, x, y);
}
function rrect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function pill(b, label, top, bot, pressed) {
  const y = b.y + (pressed ? 2 : 0);
  ctx.save();
  rrect(b.x - b.w / 2 - 3, y - b.h / 2 - 3, b.w + 6, b.h + 6, (b.h + 6) / 2); ctx.fillStyle = '#fff'; ctx.fill();
  const g = ctx.createLinearGradient(0, y - b.h / 2, 0, y + b.h / 2); g.addColorStop(0, top); g.addColorStop(1, bot);
  rrect(b.x - b.w / 2, y - b.h / 2, b.w, b.h, b.h / 2); ctx.fillStyle = g; ctx.fill();
  rrect(b.x - b.w / 2 + 8, y - b.h / 2 + 4, b.w - 16, b.h * 0.38, b.h * 0.2); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
  text(label, b.x, y + 1, Math.min(26, b.h * 0.46), '#fff', { stroke: 'rgba(0,0,0,0.25)', lw: 4 });
  ctx.restore();
}
function iconBtn(b, kind) {
  ctx.save();
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  const s = b.r / 19;
  if (kind === 'pause') { ctx.fillRect(b.x - 6 * s, b.y - 7 * s, 4 * s, 14 * s); ctx.fillRect(b.x + 2 * s, b.y - 7 * s, 4 * s, 14 * s); }
  else {
    ctx.beginPath(); ctx.moveTo(b.x - 9 * s, b.y - 3.5 * s); ctx.lineTo(b.x - 5 * s, b.y - 3.5 * s); ctx.lineTo(b.x + 1 * s, b.y - 8 * s);
    ctx.lineTo(b.x + 1 * s, b.y + 8 * s); ctx.lineTo(b.x - 5 * s, b.y + 3.5 * s); ctx.lineTo(b.x - 9 * s, b.y + 3.5 * s); ctx.closePath(); ctx.fill();
    if (Audio.muted) { ctx.beginPath(); ctx.moveTo(b.x + 4 * s, b.y - 4 * s); ctx.lineTo(b.x + 10 * s, b.y + 4 * s); ctx.moveTo(b.x + 10 * s, b.y - 4 * s); ctx.lineTo(b.x + 4 * s, b.y + 4 * s); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(b.x + 2 * s, b.y, 5 * s, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(b.x + 2 * s, b.y, 9 * s, -0.9, 0.9); ctx.stroke(); }
  }
  ctx.restore();
}
function panel(x, y, w, h) {
  ctx.save();
  rrect(x - 6, y - 6, w + 12, h + 12, 26); ctx.fillStyle = '#00b4ee'; ctx.fill();
  rrect(x, y, w, h, 20); ctx.fillStyle = '#c8f6fd'; ctx.fill();
  ctx.restore();
}

function drawHud() {
  const s = L.safe, x0 = Math.max(16, s.left + 14), y0 = L.top;
  text(String(G.score), x0, y0 + 20, 32, '#fff', { align: 'left', lw: 6 });
  const best = store.get(G.daily ? 'ld_daily3d_' + todayKey() : 'ld_best3d', 0);
  text((G.daily ? 'DAILY BEST ' : 'BEST ') + Math.max(best, G.newBest ? G.score : 0), x0 + 2, y0 + 44, 13, '#ffe9a8', { align: 'left', lw: 4 });
  iconBtn(L.pause, 'pause'); iconBtn(L.sound, 'sound');
  const lx = L.pause.x - 62;
  rrect(lx - 30, y0 + 6, 60, 26, 13); ctx.fillStyle = '#d9480f'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
  text('HEAT ' + G.level, lx, y0 + 19.5, 13, '#fff', { lw: 3 });
  const bw = W - x0 * 2, bh = 14, by = y0 + 60;
  rrect(x0, by, bw, bh, 7); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
  const f = G.heat / 100;
  if (f > 0) {
    const g = ctx.createLinearGradient(x0, 0, x0 + bw, 0); g.addColorStop(0, '#4dabf7'); g.addColorStop(0.5, '#ffd43b'); g.addColorStop(1, '#f03e3e');
    ctx.save(); rrect(x0, by, bw, bh, 7); ctx.clip(); ctx.fillStyle = g; ctx.fillRect(x0, by, bw * f, bh); ctx.restore();
  }
  rrect(x0, by, bw, bh, 7); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
  if (f > 0.7 && Math.floor(time * 6) % 2) text('OVERHEATING!', W / 2, by + bh / 2, 12, '#fff', { lw: 3 });
  else text('HEAT', W / 2, by + bh / 2, 11, '#fff', { lw: 3 });
}
function drawPad() {
  for (const k of ['up', 'down', 'left', 'right']) {
    const b = L.pad[k], img = IMG['btn_' + k], s = L.btn * (pressed[k] ? 0.92 : 1);
    ctx.save();
    ctx.beginPath(); ctx.ellipse(b.x, b.y + s * 0.47, s * 0.42, s * 0.1, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
    ctx.imageSmoothingEnabled = false; ctx.drawImage(img, b.x - s / 2, b.y - s / 2, s, s);
    ctx.restore();
  }
}
function drawFloaters() {
  for (const f of floaters) {
    const p = toScreen(f.wx, f.wy, f.wz);
    ctx.globalAlpha = Math.min(1, (0.9 - f.life) * 3); text(f.text, p.x, p.y, f.size, f.color, { lw: 4 }); ctx.globalAlpha = 1;
  }
}
function drawVignette() {
  if (!G || G.heat < 55) return;
  const k = (G.heat - 55) / 45 * (0.75 + 0.25 * Math.sin(time * 8));
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(255,40,0,0)'); g.addColorStop(1, 'rgba(255,40,0,' + 0.45 * k + ')');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function drawBanner() {
  if (!banner) return;
  const k = banner.t, s = k < 0.2 ? 0.6 + k * 2 : 1, a = k > 1.0 ? 1 - (k - 1) / 0.4 : 1;
  ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.translate(W / 2, L.boardCy - L.board * 0.1); ctx.scale(s, s);
  text(banner.text, 0, 0, 52, banner.text.indexOf('HEAT') === 0 ? '#ff922b' : '#fff', { lw: 9 }); ctx.restore();
}
function heatTint() {
  if (!G || scene === 'title') return;
  const a = Math.min(0.3, (G.level - 1) * 0.025);
  if (a > 0) { ctx.fillStyle = 'rgba(255,90,20,' + a + ')'; ctx.fillRect(0, 0, W, H); }
}

const UI = {};
function drawTitle() {
  const cx = W / 2, top = L.top + Math.max(6, H * 0.03);
  ctx.save(); ctx.translate(cx, top + 50); ctx.rotate(-0.04);
  text('LAVA', -2, 0, Math.min(72, W * 0.19), '#ffb12b', { lw: 12 });
  text('DODGE', 0, Math.min(64, W * 0.17), Math.min(72, W * 0.19), '#ff6b1a', { lw: 12 });
  ctx.restore();
  ctx.save(); ctx.translate(cx + Math.min(110, W * 0.28), top + 50 + Math.min(64, W * 0.17) + 30); ctx.rotate(-0.12);
  text('3D', 0, 0, 34, '#fff', { lw: 8, stroke: '#c92a2a' }); ctx.restore();
  text('OVERHEAT', cx, top + 50 + Math.min(64, W * 0.17) + 44, 22, '#fff', { lw: 6, stroke: '#c92a2a' });
  const bw = Math.min(250, W * 0.62), bh = 58, by = H - L.safe.bottom - 210;
  UI.play = { x: cx, y: by, w: bw, h: bh };
  UI.daily = { x: cx, y: by + 78, w: bw, h: bh };
  pill(UI.play, 'PLAY', '#34e07f', '#13a24f', pressedUI === 'play');
  pill(UI.daily, 'DAILY RUN', '#4fe3ff', '#0aa6d6', pressedUI === 'daily');
  const best = store.get('ld_best3d', 0), dbest = store.get('ld_daily3d_' + todayKey(), 0);
  text('BEST ' + best + (dbest ? '   ·   TODAY ' + dbest : ''), cx, by + 134, 16, '#fff', { lw: 5 });
  text('Swipe or tap arrows · dodge the cracks · grab ice to stay cool', cx, by + 164, 12, '#fff', { lw: 4, weight: '700' });
  iconBtn(L.sound, 'sound');
}
function drawPlayUI() {
  heatTint(); drawFloaters(); drawPad(); drawHud(); drawVignette(); drawBanner();
  if (flash > 0) { ctx.fillStyle = 'rgba(255,200,120,' + flash * 0.35 + ')'; ctx.fillRect(0, 0, W, H); }
}
function drawPaused() {
  drawPlayUI();
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
  const pw = Math.min(300, W - 40), ph = 250, px = (W - pw) / 2, py = (H - ph) / 2;
  panel(px, py, pw, ph);
  text('PAUSED', W / 2, py + 48, 38, '#fff', { lw: 7 });
  UI.resume = { x: W / 2, y: py + 122, w: pw - 70, h: 54 }; UI.quit = { x: W / 2, y: py + 192, w: pw - 70, h: 50 };
  pill(UI.resume, 'RESUME', '#34e07f', '#13a24f', pressedUI === 'resume'); pill(UI.quit, 'MENU', '#a5b4fc', '#6c7ae0', pressedUI === 'quit');
}
function drawOver() {
  drawPlayUI();
  const k = Math.min(1, G.overT / 0.3), e = 1 - Math.pow(1 - k, 3);
  ctx.fillStyle = 'rgba(0,0,0,' + 0.45 * k + ')'; ctx.fillRect(0, 0, W, H);
  const pw = Math.min(320, W - 36), ph = 400, px = (W - pw) / 2, py = (H - ph) / 2 + (1 - e) * 60;
  ctx.save(); ctx.globalAlpha = k;
  panel(px, py, pw, ph);
  if (IMG.olaf_burnt.naturalWidth) { ctx.save(); ctx.translate(W / 2, py + 4); ctx.rotate(Math.sin(time * 3) * 0.05); ctx.drawImage(IMG.olaf_burnt, -46, -92, 92, 92); ctx.restore(); }
  text(G.cause === 'heat' ? 'OVERHEATED!' : 'TOASTED!', W / 2, py + 34, 30, '#ff6b1a', { lw: 7 });
  text(String(G.score), W / 2, py + 96, 60, '#fff', { lw: 10 });
  if (G.newBest) { const s = 1 + 0.06 * Math.sin(time * 8); ctx.save(); ctx.translate(W / 2, py + 142); ctx.scale(s, s); text('NEW BEST!', 0, 0, 22, '#ffd43b', { lw: 6 }); ctx.restore(); }
  else text('BEST ' + G.prevBest, W / 2, py + 142, 20, '#1c7ed6', { stroke: false });
  [['Survived', Math.floor(G.t) + 's'], ['Heat level', String(G.level)], ['Ice cubes', String(G.stats.ice)], ['Close calls', String(G.stats.close)]].forEach(([a, b], i) => {
    const y = py + 182 + i * 28;
    text(a, px + 34, y, 17, '#155e75', { align: 'left', stroke: false, weight: '700' });
    text(b, px + pw - 34, y, 18, '#0b3a4a', { align: 'right', stroke: false });
  });
  UI.restart = { x: W / 2, y: py + ph - 92, w: pw - 70, h: 56 }; UI.menu = { x: W / 2, y: py + ph - 30, w: pw - 120, h: 40 };
  pill(UI.restart, 'RESTART', '#34e07f', '#13a24f', pressedUI === 'restart'); pill(UI.menu, 'MENU', '#a5b4fc', '#6c7ae0', pressedUI === 'menu');
  if (G.daily) text('Daily run · same waves for everyone today', W / 2, py + ph + 26, 12, '#fff', { lw: 4, weight: '700' });
  ctx.restore();
}
function drawLoading() {
  ctx.fillStyle = 'rgba(124,199,224,0.85)'; ctx.fillRect(0, 0, W, H);
  text('LAVADODGE 3D', W / 2, H / 2 - 30, 36, '#ffb12b', { lw: 8 });
  const bw = Math.min(240, W - 80);
  rrect(W / 2 - bw / 2, H / 2 + 10, bw, 14, 7); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
  rrect(W / 2 - bw / 2, H / 2 + 10, bw * Math.min(1, loaded / total), 14, 7); ctx.fillStyle = '#ff922b'; ctx.fill();
}

// ---------- Input ----------
const pressed = {}; let pressedUI = null;
const inCircle = (x, y, b, pad) => Math.hypot(x - b.x, y - b.y) <= b.r + (pad || 8);
const inRect = (x, y, b) => b && Math.abs(x - b.x) <= b.w / 2 + 6 && Math.abs(y - b.y) <= b.h / 2 + 6;
const touches = new Map();
function padHit(x, y) {
  let best = null, bd = 1e9;
  for (const k in L.pad) { const b = L.pad[k], d = Math.hypot(x - b.x, y - b.y); if (d < L.btn * 0.75 && d < bd) { bd = d; best = k; } }
  return best;
}
canvas.addEventListener('pointerdown', e => {
  e.preventDefault(); Audio.unlock();
  const x = e.clientX, y = e.clientY;
  if (scene === 'play') {
    if (inCircle(x, y, L.pause)) { scene = 'paused'; return; }
    if (inCircle(x, y, L.sound)) { Audio.toggle(); return; }
    const k = padHit(x, y);
    if (k) { pressed[k] = true; tryMove(L.pad[k].dir[0], L.pad[k].dir[1]); touches.set(e.pointerId, { pad: k }); return; }
    touches.set(e.pointerId, { sx: x, sy: y }); return;
  }
  if (scene === 'title' && inCircle(x, y, L.sound)) { Audio.toggle(); return; }
  for (const k in UI) if (inRect(x, y, UI[k]) && uiActive(k)) { pressedUI = k; return; }
}, { passive: false });
canvas.addEventListener('pointermove', e => {
  const t = touches.get(e.pointerId);
  if (!t || t.pad || scene !== 'play') return;
  const dx = e.clientX - t.sx, dy = e.clientY - t.sy, th = Math.max(18, L.board / 6 * 0.3);
  if (Math.abs(dx) < th && Math.abs(dy) < th) return;
  if (Math.abs(dx) > Math.abs(dy)) tryMove(Math.sign(dx), 0); else tryMove(0, Math.sign(dy));
  t.sx = e.clientX; t.sy = e.clientY;
});
canvas.addEventListener('pointerup', e => {
  Audio.unlock();
  const t = touches.get(e.pointerId); if (t && t.pad) pressed[t.pad] = false; touches.delete(e.pointerId);
  if (pressedUI) { const k = pressedUI; pressedUI = null; if (inRect(e.clientX, e.clientY, UI[k])) uiAction(k); }
});
canvas.addEventListener('pointercancel', e => { const t = touches.get(e.pointerId); if (t && t.pad) pressed[t.pad] = false; touches.delete(e.pointerId); pressedUI = null; });
function uiActive(k) {
  if (scene === 'title') return k === 'play' || k === 'daily';
  if (scene === 'paused') return k === 'resume' || k === 'quit';
  if (scene === 'over') return (k === 'restart' || k === 'menu') && G.overT > 0.4;
  return false;
}
function uiAction(k) {
  for (const key in UI) delete UI[key];
  if (k === 'play') newGame(false);
  else if (k === 'daily') newGame(true);
  else if (k === 'resume') scene = 'play';
  else if (k === 'restart') newGame(G.daily);
  else if (k === 'quit' || k === 'menu') { scene = 'title'; Audio.stopMusic(); Board.reset(); IceView.clear(); FX.clear(); G = null; }
}
window.addEventListener('keydown', e => {
  const m = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }[e.key];
  Audio.unlock();
  if (m && scene === 'play') { e.preventDefault(); if (!e.repeat) tryMove(m[0], m[1]); }
  else if ((e.key === ' ' || e.key === 'Enter') && (scene === 'title' || (scene === 'over' && G.overT > 0.4))) newGame(scene === 'over' ? G.daily : false);
  else if (e.key === 'Escape' || e.key === 'p') { if (scene === 'play') scene = 'paused'; else if (scene === 'paused') scene = 'play'; }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (scene === 'play') scene = 'paused'; if (Audio.ctx) Audio.ctx.suspend(); }
  else if (Audio.ctx) Audio.ctx.resume();
});
document.addEventListener('gesturestart', e => e.preventDefault());
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 200));

// ---------- Main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt);
  render3D(dt);
  ctx.clearRect(0, 0, W, H);
  if (scene === 'loading') drawLoading();
  else if (scene === 'title') drawTitle();
  else if (scene === 'paused') drawPaused();
  else if (scene === 'over') drawOver();
  else drawPlayUI();
  requestAnimationFrame(frame);
}
layout();
init3D();
const modelReady = new Promise(res => { const chk = () => (Olaf.ready ? res() : setTimeout(chk, 50)); chk(); });
Promise.all([imgReady, modelReady]).then(() => { loaded = total; scene = 'title'; });
requestAnimationFrame(frame);

window.__ld = { get scene() { return scene; }, get G() { return G; }, BAL, newGame, tryMove, step: update, survivable };
