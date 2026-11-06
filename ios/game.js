/* LavaDodge: Overheat — iPhone remake.
 * Plain canvas + Web Audio, no dependencies. Original game by William Yao (2017).
 */
(function () {
  'use strict';

  // ---------- Tunables (balance lives here) ----------
  const COLS = 6, ROWS = 6;
  const BAL = {
    levelEvery: 12,          // seconds per heat level
    maxLevel: 20,
    spawnStart: 1.0,         // seconds between hazard waves at level 1
    spawnMin: 0.3,
    spawnStep: 0.05,
    warnStart: 1.15,         // crack warning time at level 1
    warnMin: 0.55,
    warnStep: 0.035,
    lavaTime: 0.75,          // how long a tile stays deadly
    coolTime: 0.35,          // fade-out, harmless
    moveTime: 0.11,          // hop duration
    heatBase: 3.0,           // heat %/s at level 1
    heatPerLevel: 0.18,
    heatAdjLava: 5,          // extra %/s per lava tile next to you
    iceCool: 38,             // heat removed per ice cube
    iceEvery: [3.6, 5.4],
    iceLife: 7,
    iceMax: 2,
    ptsPerSec: 10,
    icePts: 25,
    closePts: 5,
  };

  // ---------- Canvas / layout ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const safeEl = document.getElementById('safe');
  let W = 0, H = 0, DPR = 1, L = {};

  function readSafe() {
    const cs = getComputedStyle(safeEl);
    return {
      top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0, right: parseFloat(cs.paddingRight) || 0,
    };
  }

  function layout() {
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const s = readSafe();
    const top = Math.max(s.top, 10) + 6;
    const hud = 78;
    const bottom = Math.max(s.bottom, 10) + 6;
    const avail = H - top - hud - bottom;
    const board = Math.floor(Math.min(W - 28 - s.left - s.right, avail * 0.6, 540) / COLS) * COLS;
    const tile = board / COLS;
    const rest = avail - board - 14;
    const btn = Math.max(40, Math.min(tile * 1.2, rest / 3.25, 92));
    const boardX = Math.round((W - board) / 2);
    const boardY = Math.round(top + hud + 4);
    const padCy = boardY + board + 14 + Math.max(btn * 1.6, rest / 2);
    L = {
      top, hud, board, tile, boardX, boardY, btn,
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
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 200));

  // ---------- Storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // ---------- Assets ----------
  const IMG = {};
  const imgList = ['olaf', 'olaf_burnt', 'olaf_sweat', 'ice', 'tile', 'lava', 'crack', 'btn_up', 'btn_down', 'btn_left', 'btn_right'];
  let loaded = 0;
  const total = imgList.length + 1;
  function loadImg(name, src) {
    return new Promise(res => {
      const i = new Image();
      i.onload = () => { loaded++; res(); };
      i.onerror = () => { loaded++; res(); };
      i.src = src; IMG[name] = i;
    });
  }
  const assetsReady = Promise.all(
    imgList.map(n => loadImg(n, 'assets/img/' + n + '.png')).concat([loadImg('bg', 'assets/img/bg.jpg')])
  );

  // ---------- Audio (Web Audio for low latency on iOS) ----------
  const Audio = {
    ctx: null, bufs: {}, music: null, master: null, musicGain: null,
    muted: store.get('ld_muted', false), unlocked: false,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.45;
      this.musicGain.connect(this.master);
      ['music', 'move', 'game-over'].forEach(n => {
        fetch('assets/sfx/' + n + '.mp3').then(r => r.arrayBuffer())
          .then(b => new Promise((ok, bad) => this.ctx.decodeAudioData(b, ok, bad)))
          .then(buf => { this.bufs[n] = buf; if (n === 'music' && this.wantMusic) this.startMusic(); })
          .catch(() => {});
      });
    },
    unlock() {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state !== 'running') this.ctx.resume();
      if (!this.unlocked) {
        const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
        s.buffer = b; s.connect(this.ctx.destination); s.start(0);
        this.unlocked = true;
      }
    },
    play(name, vol, rate) {
      if (!this.ctx || !this.bufs[name]) return;
      const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
      s.buffer = this.bufs[name]; s.playbackRate.value = rate || 1;
      g.gain.value = vol == null ? 1 : vol;
      s.connect(g); g.connect(this.master); s.start();
    },
    wantMusic: false,
    startMusic() {
      this.wantMusic = true;
      if (!this.ctx || !this.bufs.music || this.music) return;
      const s = this.ctx.createBufferSource();
      s.buffer = this.bufs.music; s.loop = true; s.connect(this.musicGain); s.start();
      this.music = s;
    },
    stopMusic() {
      this.wantMusic = false;
      if (this.music) { try { this.music.stop(); } catch (e) {} this.music = null; }
    },
    tone(freqs, dur, type, vol) { // tiny synth for pickups / level ups
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      freqs.forEach((f, i) => {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type || 'sine'; o.frequency.value = f;
        const st = t0 + i * dur * 0.6;
        g.gain.setValueAtTime(0, st);
        g.gain.linearRampToValueAtTime(vol || 0.18, st + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, st + dur);
        o.connect(g); g.connect(this.master); o.start(st); o.stop(st + dur + 0.02);
      });
    },
    sizzle(vol) {
      if (!this.ctx) return;
      const len = 0.22, b = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
      g.gain.value = vol || 0.12;
      s.buffer = b; s.connect(f); f.connect(g); g.connect(this.master); s.start();
    },
    toggle() {
      this.muted = !this.muted; store.set('ld_muted', this.muted);
      if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    },
  };

  // ---------- RNG ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  let rng = Math.random;
  const ri = n => Math.floor(rng() * n);
  const rr = (a, b) => a + rng() * (b - a);
  function todayKey() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  // ---------- Game state ----------
  let scene = 'loading'; // loading | title | play | paused | dying | over
  let G = null;
  let time = 0; // real clock for UI anims
  const particles = [], floaters = [];
  let shake = 0, flash = 0, banner = null;

  function newGame(daily) {
    rng = daily ? mulberry32(todayKey()) : Math.random;
    G = {
      daily, t: 0, score: 0, bonus: 0, level: 1, heat: 0,
      hazards: [], ice: [], nextSpawn: 1.2, nextIce: 3,
      p: { c: 2, r: 3, fc: 2, fr: 3, mv: null, queue: null, land: 0, lean: 0 },
      stats: { ice: 0, close: 0 }, iceCombo: 0, lastIce: -99,
      cause: '',
    };
    particles.length = 0; floaters.length = 0;
    banner = { text: daily ? 'DAILY RUN' : 'GO!', t: 0 };
    scene = 'play';
    Audio.startMusic();
  }

  const level = t => Math.min(BAL.maxLevel, 1 + Math.floor(t / BAL.levelEvery));
  const spawnInterval = lv => Math.max(BAL.spawnMin, BAL.spawnStart - BAL.spawnStep * (lv - 1));
  const warnTime = lv => Math.max(BAL.warnMin, BAL.warnStart - BAL.warnStep * (lv - 1));

  // Hazard phases. A hazard is deadly only during [t0+warn, t0+warn+lava).
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

  // Fairness: simulate a human (reaction delay, ~1 tile per 0.2s) and make sure
  // some path stays off lava for the next few seconds. Unfair waves are rejected.
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

  // ---------- Wave patterns ----------
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
    const out = []; // [c, r, extraDelay, extraWarn]
    const add = (c, r, d, w) => { if (inB(c, r) && !out.some(o => o[0] === c && o[1] === r)) out.push([c, r, d || 0, w || 0]); };
    switch (kind) {
      case 'single': add(ri(COLS), ri(ROWS)); break;
      case 'scatter': { const n = 2 + Math.min(3, Math.floor(lv / 4)) + ri(2); for (let i = 0; i < n * 3 && out.length < n; i++) add(ri(COLS), ri(ROWS)); break; }
      case 'hunt': add(p.c, p.r); if (lv >= 6) { const d = [[1, 0], [-1, 0], [0, 1], [0, -1]][ri(4)]; add(p.c + d[0], p.r + d[1]); } break;
      case 'line': {
        const row = rng() < 0.5, i = rng() < 0.55 ? (row ? p.r : p.c) : ri(row ? ROWS : COLS);
        const gap = lv < 8 ? ri(COLS) : -1;
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
      case 'ring': // trap around the player: stand still!
        for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) if (x || y) add(p.c + x, p.r + y, 0, 0.15);
        break;
      case 'sweep': {
        const horiz = rng() < 0.5, rev = rng() < 0.5;
        for (let k = 0; k < 6; k++) {
          const idx = rev ? 5 - k : k, gap = ri(6);
          for (let j = 0; j < 6; j++) if (j !== gap) horiz ? add(idx, j, k * 0.32, 0.1) : add(j, idx, k * 0.32, 0.1);
        }
        break;
      }
      case 'checker': {
        const par = ri(2);
        for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) if ((x + y) % 2 === par) add(x, y, 0, 0.35);
        break;
      }
    }
    return out;
  }

  function makeCracks() {
    const cx = 0.5 + rr(-0.12, 0.12), cy = 0.5 + rr(-0.12, 0.12);
    const branches = [], n = 4 + ri(3);
    for (let b = 0; b < n; b++) {
      let a = (b / n) * Math.PI * 2 + rr(-0.4, 0.4), x = cx, y = cy;
      const pts = [[x, y]];
      for (let s = 0; s < 4; s++) {
        a += rr(-0.6, 0.6); const len = rr(0.09, 0.14);
        x += Math.cos(a) * len; y += Math.sin(a) * len;
        pts.push([Math.max(0.04, Math.min(0.96, x)), Math.max(0.04, Math.min(0.96, y))]);
      }
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
    const big = wave.hs.length;
    G.nextSpawn = G.t + spawnInterval(lv) * (1 + Math.min(1.6, 0.12 * (big - 1))) * rr(0.85, 1.15);
  }

  function spawnIce() {
    G.nextIce = G.t + rr(BAL.iceEvery[0], BAL.iceEvery[1]);
    if (G.ice.length >= BAL.iceMax) return;
    for (let i = 0; i < 20; i++) {
      const c = ri(COLS), r = ri(ROWS);
      if (Math.abs(c - G.p.c) + Math.abs(r - G.p.r) < 2) continue;
      if (G.ice.some(o => o.c === c && o.r === r)) continue;
      if (G.hazards.some(h => h.c === c && h.r === r)) continue;
      G.ice.push({ c, r, t0: G.t });
      return;
    }
  }

  // ---------- Player movement ----------
  function tryMove(dx, dy) {
    if (scene !== 'play') return;
    const p = G.p;
    if (p.mv) { p.queue = [dx, dy]; return; }
    const nc = p.c + dx, nr = p.r + dy;
    if (!inB(nc, nr)) { p.land = 0.12; p.bump = [dx, dy]; p.bumpT = 0.12; return; } // bonk the wall
    p.mv = { fc: p.c, fr: p.r, dx, dy, t: 0 };
    p.c = nc; p.r = nr;
    Audio.play('move', 0.55, 0.95 + Math.random() * 0.1);
  }

  function playerPos() { // pixel center + hop height
    const p = G.p, T = L.tile;
    let c = p.c, r = p.r, hop = 0;
    if (p.mv) {
      const k = Math.min(1, p.mv.t / BAL.moveTime), e = 1 - (1 - k) * (1 - k);
      c = p.mv.fc + p.mv.dx * e; r = p.mv.fr + p.mv.dy * e;
      hop = Math.sin(Math.PI * k) * T * 0.32;
    }
    let bx = 0, by = 0;
    if (p.bumpT > 0) { const b = Math.sin((p.bumpT / 0.12) * Math.PI) * T * 0.08; bx = p.bump[0] * b; by = p.bump[1] * b; }
    return { x: L.boardX + (c + 0.5) * T + bx, y: L.boardY + (r + 0.5) * T + by, hop };
  }

  // Cell used for lava checks: origin for the first half of a hop, destination after.
  function playerCell() {
    const p = G.p;
    if (p.mv && p.mv.t < BAL.moveTime * 0.5) return [p.mv.fc, p.mv.fr];
    return [p.c, p.r];
  }

  // ---------- Effects ----------
  function puff(x, y, n, color, spd, size, up) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = spd * (0.4 + Math.random() * 0.6);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5 - (up || 0), life: 0, max: 0.35 + Math.random() * 0.3, size: size * (0.6 + Math.random() * 0.6), color });
    }
  }
  function floatText(x, y, text, color, size) { floaters.push({ x, y, text, color, size: size || 20, life: 0 }); }

  // ---------- Update ----------
  function update(dt) {
    time += dt;
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i]; q.life += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 120 * dt;
      if (q.life > q.max) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.life += dt; f.y -= 40 * dt; if (f.life > 0.9) floaters.splice(i, 1); }
    shake = Math.max(0, shake - dt * 30); flash = Math.max(0, flash - dt * 2.5);
    if (banner) { banner.t += dt; if (banner.t > 1.4) banner = null; }

    if (scene === 'dying') {
      G.deathT += dt;
      if (G.deathT > 1.3) { scene = 'over'; G.overT = 0; }
      return;
    }
    if (scene === 'over') { G.overT += dt; return; }
    if (scene !== 'play') return;

    G.t += dt;
    const p = G.p, T = L.tile;

    // hop animation
    if (p.mv) {
      p.mv.t += dt;
      if (p.mv.t >= BAL.moveTime) {
        p.mv = null; p.land = 0.14;
        const pp = playerPos();
        puff(pp.x, pp.y + T * 0.3, 5, 'rgba(235,225,205,', T * 1.2, T * 0.09, 10);
        if (p.queue) { const q = p.queue; p.queue = null; tryMove(q[0], q[1]); }
      }
    }
    p.land = Math.max(0, p.land - dt);
    if (p.bumpT > 0) p.bumpT -= dt;

    // difficulty
    const lv = level(G.t);
    if (lv > G.level) {
      G.level = lv; banner = { text: 'HEAT ' + lv, t: 0 }; flash = 0.5;
      Audio.tone([523, 659, 784, 1047], 0.14, 'triangle', 0.12);
    }
    if (G.t >= G.nextSpawn) spawnWave();
    if (G.t >= G.nextIce) spawnIce();

    // hazards
    const [pc, pr] = playerCell();
    let adj = 0;
    for (let i = G.hazards.length - 1; i >= 0; i--) {
      const h = G.hazards[i], ph = phase(h, G.t);
      if (ph === 'lava') {
        if (!h.erupted) {
          h.erupted = true;
          const x = L.boardX + (h.c + 0.5) * T, y = L.boardY + (h.r + 0.5) * T;
          puff(x, y, 6, 'rgba(255,170,40,', T * 1.6, T * 0.08, 30);
          G.ice = G.ice.filter(o => !(o.c === h.c && o.r === h.r));
          if (Math.abs(h.c - pc) + Math.abs(h.r - pr) === 1) {
            G.bonus += BAL.closePts; G.stats.close++; shake = Math.max(shake, 3);
            floatText(x, y - T * 0.3, 'CLOSE! +' + BAL.closePts, '#ffe066', 16);
          }
        }
        if (h.c === pc && h.r === pr) return die('lava');
        if (Math.abs(h.c - pc) + Math.abs(h.r - pr) === 1) adj++;
      } else if (ph === 'done') G.hazards.splice(i, 1);
    }
    // one sizzle per frame max
    if (G.hazards.some(h => h.erupted && !h.sizzled && (h.sizzled = true))) Audio.sizzle(0.08);

    // ice
    for (let i = G.ice.length - 1; i >= 0; i--) {
      const o = G.ice[i];
      if (G.t - o.t0 > BAL.iceLife) { G.ice.splice(i, 1); continue; }
      if (o.c === p.c && o.r === p.r && (!p.mv || p.mv.t > BAL.moveTime * 0.5)) {
        G.ice.splice(i, 1);
        G.iceCombo = G.t - G.lastIce < 8 ? Math.min(3, G.iceCombo + 1) : 1; G.lastIce = G.t;
        const pts = BAL.icePts * G.iceCombo;
        G.bonus += pts; G.stats.ice++; G.heat = Math.max(0, G.heat - BAL.iceCool);
        const x = L.boardX + (o.c + 0.5) * T, y = L.boardY + (o.r + 0.5) * T;
        puff(x, y, 12, 'rgba(170,230,255,', T * 2, T * 0.1, 40);
        floatText(x, y - T * 0.4, (G.iceCombo > 1 ? 'x' + G.iceCombo + ' ' : '') + 'CHILL +' + pts, '#bff3ff', 18);
        Audio.tone([880, 1320, 1760].slice(0, 1 + G.iceCombo), 0.12, 'sine', 0.16);
      }
    }

    // heat: always creeping up, faster next to lava; ice cools you down
    G.heat += dt * (BAL.heatBase + BAL.heatPerLevel * (G.level - 1) + adj * BAL.heatAdjLava);
    if (G.heat >= 100) { G.heat = 100; return die('heat'); }
    if (G.heat > 70 && Math.random() < dt * 6) {
      const pp = playerPos(); puff(pp.x + (Math.random() - 0.5) * T * 0.6, pp.y - T * 0.3, 1, 'rgba(120,200,255,', T, T * 0.06, 50);
    }

    G.score = Math.floor(G.t * (BAL.ptsPerSec + (G.level - 1))) + G.bonus;
  }

  function die(cause) {
    G.cause = cause; scene = 'dying'; G.deathT = 0; shake = 10;
    Audio.stopMusic(); Audio.play('game-over', 0.8);
    const pp = playerPos();
    puff(pp.x, pp.y - L.tile * 0.2, 14, cause === 'heat' ? 'rgba(255,120,60,' : 'rgba(90,90,90,', L.tile * 2, L.tile * 0.12, 60);
    const key = G.daily ? 'ld_daily_' + todayKey() : 'ld_best';
    G.prevBest = store.get(key, 0);
    G.newBest = G.score > G.prevBest;
    if (G.newBest) store.set(key, G.score);
    store.set('ld_games', store.get('ld_games', 0) + 1);
  }

  // ---------- Drawing helpers ----------
  const FONT = '"Arial Rounded MT Bold", "SF Pro Rounded", ui-rounded, "Helvetica Neue", Arial, sans-serif';
  function text(str, x, y, size, fill, opts) {
    opts = opts || {};
    ctx.font = (opts.weight || '900') + ' ' + size + 'px ' + FONT;
    ctx.textAlign = opts.align || 'center'; ctx.textBaseline = 'middle';
    if (opts.stroke !== false) {
      ctx.lineJoin = 'round'; ctx.lineWidth = opts.lw || Math.max(3, size * 0.18);
      ctx.strokeStyle = opts.stroke || '#000'; ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = fill; ctx.fillText(str, x, y);
  }
  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // glossy pill button, same look as the original RESTART button
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
    if (kind === 'pause') {
      ctx.fillRect(b.x - 6 * s, b.y - 7 * s, 4 * s, 14 * s); ctx.fillRect(b.x + 2 * s, b.y - 7 * s, 4 * s, 14 * s);
    } else {
      ctx.beginPath();
      ctx.moveTo(b.x - 9 * s, b.y - 3.5 * s); ctx.lineTo(b.x - 5 * s, b.y - 3.5 * s); ctx.lineTo(b.x + 1 * s, b.y - 8 * s);
      ctx.lineTo(b.x + 1 * s, b.y + 8 * s); ctx.lineTo(b.x - 5 * s, b.y + 3.5 * s); ctx.lineTo(b.x - 9 * s, b.y + 3.5 * s); ctx.closePath(); ctx.fill();
      if (Audio.muted) {
        ctx.beginPath(); ctx.moveTo(b.x + 4 * s, b.y - 4 * s); ctx.lineTo(b.x + 10 * s, b.y + 4 * s);
        ctx.moveTo(b.x + 10 * s, b.y - 4 * s); ctx.lineTo(b.x + 4 * s, b.y + 4 * s); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(b.x + 2 * s, b.y, 5 * s, -0.9, 0.9); ctx.stroke();
        ctx.beginPath(); ctx.arc(b.x + 2 * s, b.y, 9 * s, -0.9, 0.9); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawBackground() {
    const bg = IMG.bg;
    if (bg && bg.naturalWidth) {
      const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight);
      const w = bg.naturalWidth * s, h = bg.naturalHeight * s;
      ctx.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h);
    } else { ctx.fillStyle = '#7cc7e0'; ctx.fillRect(0, 0, W, H); }
    if (G && (scene === 'play' || scene === 'dying' || scene === 'paused' || scene === 'over')) {
      const a = Math.min(0.38, (G.level - 1) * 0.03);
      if (a > 0) { ctx.fillStyle = 'rgba(255,90,20,' + a + ')'; ctx.fillRect(0, 0, W, H); }
    }
  }

  function drawOlaf(x, y, size, img, sx, sy, rot, alpha) {
    if (!img || !img.naturalWidth) return;
    ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(sx, sy);
    ctx.drawImage(img, -size / 2, -size, size, size); // anchor at feet
    ctx.restore();
  }

  function drawBoard() {
    const T = L.tile, bx = L.boardX, by = L.boardY;
    ctx.save();
    rrect(bx - 8, by - 8, L.board + 16, L.board + 16, 16); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    rrect(bx - 5, by - 5, L.board + 10, L.board + 10, 13); ctx.fillStyle = '#3d2a1a'; ctx.fill();
    ctx.restore();

    const t = G.t, map = {};
    for (const h of G.hazards) { const k = h.c + h.r * COLS, ph = phase(h, t); if (ph !== 'wait') map[k] = { h, ph }; }

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = bx + c * T, y = by + r * T, m = map[c + r * COLS];
      if (!m) { ctx.drawImage(IMG.tile, x, y, T, T); continue; }
      const h = m.h, a = t - h.t0;
      if (m.ph === 'crack') {
        const k = a / h.warn, late = k > 0.7;
        const j = late ? (Math.random() - 0.5) * T * 0.05 * (k - 0.7) / 0.3 * 2 : 0;
        ctx.drawImage(IMG.tile, x + j, y + j * 0.6, T, T);
        // glow from below
        const pulse = late ? 0.5 + 0.5 * Math.sin(time * 40) : 0;
        const g = ctx.createRadialGradient(x + T / 2, y + T / 2, 0, x + T / 2, y + T / 2, T * 0.7);
        g.addColorStop(0, 'rgba(255,140,20,' + (0.15 + k * 0.45 + pulse * 0.15) + ')'); g.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x, y, T, T);
        // cracks grow
        const prog = Math.min(1, Math.pow(k * 1.15, 0.7)) * 4;
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const pass of [0, 1]) {
          ctx.strokeStyle = pass ? 'rgba(255,' + (200 - k * 80 | 0) + ',60,' + (0.4 + k * 0.6) + ')' : '#1a0d05';
          ctx.lineWidth = pass ? Math.max(1, T * 0.022) : Math.max(2, T * 0.06);
          for (const br of h.cracks) {
            ctx.beginPath(); ctx.moveTo(x + j + br[0][0] * T, y + j * 0.6 + br[0][1] * T);
            for (let s = 1; s < br.length; s++) {
              const f = Math.min(1, Math.max(0, prog - (s - 1))); if (f <= 0) break;
              const px = br[s - 1][0] + (br[s][0] - br[s - 1][0]) * f, py = br[s - 1][1] + (br[s][1] - br[s - 1][1]) * f;
              ctx.lineTo(x + j + px * T, y + j * 0.6 + py * T);
            }
            ctx.stroke();
          }
        }
        ctx.restore();
      } else if (m.ph === 'lava' || m.ph === 'cool') {
        ctx.drawImage(IMG.tile, x, y, T, T);
        const la = a - h.warn;
        const pop = m.ph === 'lava' ? 1 + Math.max(0, 0.12 - la) * 1.4 : 1;
        const alpha = m.ph === 'cool' ? 1 - (la - BAL.lavaTime) / BAL.coolTime : 1;
        ctx.save(); ctx.globalAlpha = alpha;
        const s = T * pop, o = (s - T) / 2;
        ctx.drawImage(IMG.lava, x - o, y - o, s, s);
        if (m.ph === 'lava') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(255,150,40,' + (0.12 + 0.1 * Math.sin(time * 12 + c * 1.7 + r)) + ')';
          ctx.fillRect(x, y, T, T);
          ctx.globalCompositeOperation = 'source-over';
          for (let b = 0; b < 3; b++) { // bubbles
            const ph2 = (time * 1.8 + b * 0.37 + (c * 7 + r * 3) * 0.13) % 1;
            ctx.beginPath(); ctx.arc(x + T * (0.2 + ((b * 0.31 + c * 0.17) % 0.6)), y + T * (0.75 - ph2 * 0.5), T * 0.05 * (1 - ph2), 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,230,120,' + (1 - ph2) + ')'; ctx.fill();
          }
        } else { ctx.fillStyle = 'rgba(40,30,30,0.45)'; ctx.fillRect(x, y, T, T); }
        ctx.restore();
      }
    }

    // ice cubes
    for (const o of G.ice) {
      const age = t - o.t0, left = BAL.iceLife - age;
      if (left < 2 && Math.floor(age * 8) % 2) continue; // blink before melting
      const s = T * 0.72 * Math.min(1, age * 5) * (1 + 0.04 * Math.sin(time * 5));
      const x = bx + (o.c + 0.5) * T, y = by + (o.r + 0.5) * T - Math.sin(time * 4 + o.c) * T * 0.04;
      ctx.drawImage(IMG.ice, x - s / 2, y - s / 2, s, s);
    }
  }

  function drawPlayer() {
    const p = G.p, T = L.tile, pp = playerPos();
    const size = T * 0.95;
    let sx = 1, sy = 1, rot = 0, img = IMG.olaf;
    if (scene === 'dying' || scene === 'over') {
      img = IMG.olaf_burnt;
      const d = G.deathT;
      const hop = Math.sin(Math.min(1, d / 0.5) * Math.PI) * T * 0.5;
      const sq = d > 0.5 ? Math.max(0.6, 1 - (d - 0.5) * 0.6) : 1;
      drawShadow(pp.x, pp.y + T * 0.38, T, hop);
      drawOlaf(pp.x, pp.y + T * 0.42 - hop, size, img, 1 + (1 - sq) * 0.5, sq, Math.sin(d * 30) * 0.06 * Math.max(0, 1 - d), 1);
      return;
    }
    if (G.heat > 70) img = IMG.olaf_sweat;
    if (p.mv) {
      const k = Math.min(1, p.mv.t / BAL.moveTime), s = Math.sin(Math.PI * k);
      sx = 1 - 0.14 * s; sy = 1 + 0.18 * s;       // stretch in the air
      rot = p.mv.dx * 0.22 * s;                    // lean into the hop
      if (k < 0.2) { sx = 1 + 0.15 * (1 - k / 0.2); sy = 1 - 0.12 * (1 - k / 0.2); } // take-off squash
    } else if (p.land > 0) {
      const e = p.land / 0.14; sx = 1 + 0.22 * e; sy = 1 - 0.2 * e; // landing squash
    } else {
      sy = 1 + 0.035 * Math.sin(time * 5.5); sx = 1 - 0.02 * Math.sin(time * 5.5); // idle breathing
    }
    drawShadow(pp.x, pp.y + T * 0.38, T, pp.hop);
    drawOlaf(pp.x, pp.y + T * 0.42 - pp.hop, size, img, sx, sy, rot);
  }
  // Fiery border around cracking tiles (the original game's crack.png look).
  // Drawn above Olaf so a crack under him is always visible.
  function drawCrackBorders() {
    const T = L.tile, t = G.t;
    for (const h of G.hazards) {
      if (phase(h, t) !== 'crack') continue;
      const k = (t - h.t0) / h.warn, late = k > 0.65;
      const pulse = late ? 0.5 + 0.5 * Math.sin(time * 30) : 0;
      const grow = 1 + (late ? 0.06 * pulse : 0);
      const s = T * grow, x = L.boardX + h.c * T - (s - T) / 2, y = L.boardY + h.r * T - (s - T) / 2;
      ctx.save();
      ctx.globalAlpha = Math.min(1, 0.55 + k * 0.6);
      ctx.drawImage(IMG.crack, x, y, s, s);
      if (late) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * pulse; ctx.drawImage(IMG.crack, x, y, s, s); }
      ctx.restore();
    }
  }

  function drawShadow(x, y, T, hop) {
    const k = 1 - Math.min(0.5, hop / T);
    ctx.beginPath(); ctx.ellipse(x, y, T * 0.3 * k, T * 0.09 * k, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.3 * k) + ')'; ctx.fill();
  }

  function drawFx() {
    for (const q of particles) {
      const a = 1 - q.life / q.max;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = q.color + a + ')'; ctx.fill();
    }
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, (0.9 - f.life) * 3);
      text(f.text, f.x, f.y, f.size, f.color, { lw: 4 });
      ctx.globalAlpha = 1;
    }
  }

  function drawHud() {
    const s = L.safe, x0 = Math.max(16, s.left + 14), y0 = L.top;
    text(String(G.score), x0, y0 + 20, 32, '#fff', { align: 'left', lw: 6 });
    const best = store.get(G.daily ? 'ld_daily_' + todayKey() : 'ld_best', 0);
    text((G.daily ? 'DAILY BEST ' : 'BEST ') + Math.max(best, G.newBest ? G.score : 0), x0 + 2, y0 + 44, 13, '#ffe9a8', { align: 'left', lw: 4 });
    iconBtn(L.pause, 'pause'); iconBtn(L.sound, 'sound');

    // level chip
    const lx = L.pause.x - 62;
    rrect(lx - 30, y0 + 6, 60, 26, 13); ctx.fillStyle = '#d9480f'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
    text('HEAT ' + G.level, lx, y0 + 19.5, 13, '#fff', { lw: 3 });

    // heat meter
    const bw = W - x0 * 2, bh = 14, by = y0 + 60;
    rrect(x0, by, bw, bh, 7); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
    const f = G.heat / 100;
    if (f > 0) {
      const g = ctx.createLinearGradient(x0, 0, x0 + bw, 0);
      g.addColorStop(0, '#4dabf7'); g.addColorStop(0.5, '#ffd43b'); g.addColorStop(1, '#f03e3e');
      ctx.save(); rrect(x0, by, bw, bh, 7); ctx.clip();
      ctx.fillStyle = g; ctx.fillRect(x0, by, bw * f, bh); ctx.restore();
    }
    rrect(x0, by, bw, bh, 7); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
    if (f > 0.7 && Math.floor(time * 6) % 2) text('OVERHEATING!', W / 2, by + bh / 2, 12, '#fff', { lw: 3 });
    else text('HEAT', W / 2, by + bh / 2, 11, '#fff', { lw: 3 });
  }

  function drawPad() {
    for (const k of ['up', 'down', 'left', 'right']) {
      const b = L.pad[k], img = IMG['btn_' + k], s = L.btn * (pressed[k] ? 0.92 : 1);
      ctx.save();
      ctx.globalAlpha = 0.97;
      ctx.beginPath(); ctx.ellipse(b.x, b.y + s * 0.47, s * 0.42, s * 0.1, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, b.x - s / 2, b.y - s / 2, s, s);
      ctx.restore();
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
    ctx.save(); ctx.globalAlpha = Math.max(0, a);
    ctx.translate(W / 2, L.boardY + L.board / 2); ctx.scale(s, s);
    text(banner.text, 0, 0, 52, banner.text.indexOf('HEAT') === 0 ? '#ff922b' : '#fff', { lw: 9 });
    ctx.restore();
  }

  // ---------- Screens ----------
  const UI = {}; // hit areas for current screen
  function panel(x, y, w, h) {
    ctx.save();
    rrect(x - 6, y - 6, w + 12, h + 12, 26); ctx.fillStyle = '#00b4ee'; ctx.fill();
    rrect(x, y, w, h, 20); ctx.fillStyle = '#c8f6fd'; ctx.fill();
    ctx.restore();
  }

  function drawTitle() {
    drawBackground();
    const cx = W / 2, top = L.top + Math.max(10, H * 0.04);
    const bob = Math.sin(time * 2.4) * 6;
    ctx.save(); ctx.translate(cx, top + 58); ctx.rotate(-0.04);
    text('LAVA', -2, 0, Math.min(78, W * 0.2), '#ffb12b', { lw: 12 });
    text('DODGE', 0, Math.min(70, W * 0.18), Math.min(78, W * 0.2), '#ff6b1a', { lw: 12 });
    ctx.restore();
    text('OVERHEAT', cx, top + 58 + Math.min(70, W * 0.18) + 46, 24, '#fff', { lw: 6, stroke: '#c92a2a' });

    // Olaf hops on a little tile
    const T = Math.min(130, W * 0.32), oy = top + 300 + Math.max(0, (H - 760) * 0.2);
    ctx.drawImage(IMG.tile, cx - T / 2, oy - T / 2 + 20, T, T);
    const hopK = (time * 1.3) % 1, hop = hopK < 0.35 ? Math.sin(hopK / 0.35 * Math.PI) * 26 : 0;
    const sq = hopK > 0.35 && hopK < 0.45 ? 1 - (0.45 - hopK) * 2 : 1;
    drawShadow(cx, oy + T * 0.22 + 20, T * 0.9, hop * 2);
    drawOlaf(cx, oy + T * 0.25 + 20 - hop, T * 0.95, IMG.olaf, 2 - sq, sq, 0);

    const bw = Math.min(250, W * 0.62), bh = 58;
    const by = Math.min(H - L.safe.bottom - 190, oy + T + 40);
    UI.play = { x: cx, y: by, w: bw, h: bh };
    UI.daily = { x: cx, y: by + 78, w: bw, h: bh };
    pill(UI.play, 'PLAY', '#34e07f', '#13a24f', pressedUI === 'play');
    pill(UI.daily, 'DAILY RUN', '#4fe3ff', '#0aa6d6', pressedUI === 'daily');

    const best = store.get('ld_best', 0), dbest = store.get('ld_daily_' + todayKey(), 0);
    text('BEST ' + best + (dbest ? '   ·   TODAY ' + dbest : ''), cx, by + 134, 16, '#fff', { lw: 5 });
    text('Swipe or tap arrows · dodge the cracks · grab ice to stay cool', cx, Math.min(H - L.safe.bottom - 20, by + 166), 12, '#fff', { lw: 4, weight: '700' });
    iconBtn(L.sound, 'sound');
  }

  function drawPlay() {
    drawBackground();
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawBoard(); drawPlayer(); drawCrackBorders(); drawFx();
    ctx.restore();
    drawPad(); drawHud(); drawVignette(); drawBanner();
    if (flash > 0) { ctx.fillStyle = 'rgba(255,200,120,' + flash * 0.35 + ')'; ctx.fillRect(0, 0, W, H); }
  }

  function drawPaused() {
    drawPlay();
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    const pw = Math.min(300, W - 40), ph = 250, px = (W - pw) / 2, py = (H - ph) / 2;
    panel(px, py, pw, ph);
    text('PAUSED', W / 2, py + 48, 38, '#fff', { lw: 7 });
    UI.resume = { x: W / 2, y: py + 122, w: pw - 70, h: 54 };
    UI.quit = { x: W / 2, y: py + 192, w: pw - 70, h: 50 };
    pill(UI.resume, 'RESUME', '#34e07f', '#13a24f', pressedUI === 'resume');
    pill(UI.quit, 'MENU', '#a5b4fc', '#6c7ae0', pressedUI === 'quit');
  }

  function drawOver() {
    drawPlay();
    const k = Math.min(1, G.overT / 0.3), e = 1 - Math.pow(1 - k, 3);
    ctx.fillStyle = 'rgba(0,0,0,' + 0.45 * k + ')'; ctx.fillRect(0, 0, W, H);
    const pw = Math.min(320, W - 36), ph = 400, px = (W - pw) / 2, py = (H - ph) / 2 + (1 - e) * 60;
    ctx.save(); ctx.globalAlpha = k;
    panel(px, py, pw, ph);
    drawOlaf(W / 2, py + 4, 92, IMG.olaf_burnt, 1, 1, Math.sin(time * 3) * 0.05);
    text(G.cause === 'heat' ? 'OVERHEATED!' : 'TOASTED!', W / 2, py + 34, 30, '#ff6b1a', { lw: 7 });
    text(String(G.score), W / 2, py + 96, 60, '#fff', { lw: 10 });
    if (G.newBest) {
      const s = 1 + 0.06 * Math.sin(time * 8);
      ctx.save(); ctx.translate(W / 2, py + 142); ctx.scale(s, s); text('NEW BEST!', 0, 0, 22, '#ffd43b', { lw: 6 }); ctx.restore();
    } else text('BEST ' + G.prevBest, W / 2, py + 142, 20, '#1c7ed6', { lw: 0, stroke: false });
    const secs = Math.floor(G.t);
    const rows = [['Survived', secs + 's'], ['Heat level', String(G.level)], ['Ice cubes', String(G.stats.ice)], ['Close calls', String(G.stats.close)]];
    rows.forEach(([a, b], i) => {
      const y = py + 182 + i * 28;
      text(a, px + 34, y, 17, '#155e75', { align: 'left', stroke: false, weight: '700' });
      text(b, px + pw - 34, y, 18, '#0b3a4a', { align: 'right', stroke: false });
    });
    UI.restart = { x: W / 2, y: py + ph - 92, w: pw - 70, h: 56 };
    UI.menu = { x: W / 2, y: py + ph - 30, w: pw - 120, h: 40 };
    pill(UI.restart, 'RESTART', '#34e07f', '#13a24f', pressedUI === 'restart');
    pill(UI.menu, 'MENU', '#a5b4fc', '#6c7ae0', pressedUI === 'menu');
    if (G.daily) text('Daily run · same waves for everyone today', W / 2, py + ph + 26, 12, '#fff', { lw: 4, weight: '700' });
    ctx.restore();
  }

  function drawLoading() {
    ctx.fillStyle = '#7cc7e0'; ctx.fillRect(0, 0, W, H);
    text('LAVADODGE', W / 2, H / 2 - 30, 40, '#ffb12b', { lw: 8 });
    const bw = Math.min(240, W - 80);
    rrect(W / 2 - bw / 2, H / 2 + 10, bw, 14, 7); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
    rrect(W / 2 - bw / 2, H / 2 + 10, bw * loaded / total, 14, 7); ctx.fillStyle = '#ff922b'; ctx.fill();
  }

  // ---------- Input ----------
  const pressed = {}; let pressedUI = null;
  const inCircle = (x, y, b, pad) => Math.hypot(x - b.x, y - b.y) <= b.r + (pad || 8);
  const inRect = (x, y, b) => b && Math.abs(x - b.x) <= b.w / 2 + 6 && Math.abs(y - b.y) <= b.h / 2 + 6;
  const touches = new Map();

  function padHit(x, y) {
    let best = null, bd = 1e9;
    for (const k in L.pad) {
      const b = L.pad[k], d = Math.hypot(x - b.x, y - b.y);
      if (d < L.btn * 0.75 && d < bd) { bd = d; best = k; }
    }
    return best;
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    Audio.unlock();
    const x = e.clientX, y = e.clientY;
    if (scene === 'play') {
      if (inCircle(x, y, L.pause)) { scene = 'paused'; return; }
      if (inCircle(x, y, L.sound)) { Audio.toggle(); return; }
      const k = padHit(x, y);
      if (k) { pressed[k] = true; tryMove(L.pad[k].dir[0], L.pad[k].dir[1]); touches.set(e.pointerId, { pad: k }); return; }
      touches.set(e.pointerId, { sx: x, sy: y });
      return;
    }
    if (scene === 'title' && inCircle(x, y, L.sound)) { Audio.toggle(); return; }
    for (const k in UI) if (inRect(x, y, UI[k]) && uiActive(k)) { pressedUI = k; return; }
  }, { passive: false });

  canvas.addEventListener('pointermove', e => {
    const t = touches.get(e.pointerId);
    if (!t || t.pad || scene !== 'play') return;
    const dx = e.clientX - t.sx, dy = e.clientY - t.sy, th = Math.max(18, L.tile * 0.3);
    if (Math.abs(dx) < th && Math.abs(dy) < th) return;
    if (Math.abs(dx) > Math.abs(dy)) tryMove(Math.sign(dx), 0); else tryMove(0, Math.sign(dy));
    t.sx = e.clientX; t.sy = e.clientY; // keep swiping to chain moves
  });

  function endPointer(e) {
    Audio.unlock();
    const t = touches.get(e.pointerId);
    if (t && t.pad) pressed[t.pad] = false;
    touches.delete(e.pointerId);
    if (pressedUI) {
      const k = pressedUI; pressedUI = null;
      if (inRect(e.clientX, e.clientY, UI[k])) uiAction(k);
    }
  }
  canvas.addEventListener('pointerup', endPointer);
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
    else if (k === 'quit' || k === 'menu') { scene = 'title'; Audio.stopMusic(); }
  }

  window.addEventListener('keydown', e => {
    const m = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }[e.key];
    Audio.unlock();
    if (m && scene === 'play') { e.preventDefault(); if (!e.repeat) tryMove(m[0], m[1]); }
    else if ((e.key === ' ' || e.key === 'Enter') && (scene === 'title' || (scene === 'over' && G.overT > 0.4))) newGame(scene === 'over' ? G.daily : false);
    else if (e.key === 'Escape' || e.key === 'p') { if (scene === 'play') scene = 'paused'; else if (scene === 'paused') scene = 'play'; }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (scene === 'play') scene = 'paused';
      if (Audio.ctx) Audio.ctx.suspend();
    } else if (Audio.ctx) Audio.ctx.resume();
  });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());

  // ---------- Main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt);
    if (scene === 'loading') drawLoading();
    else if (scene === 'title') drawTitle();
    else if (scene === 'paused') drawPaused();
    else if (scene === 'over') drawOver();
    else drawPlay();
    requestAnimationFrame(frame);
  }
  layout();
  assetsReady.then(() => { scene = 'title'; });
  requestAnimationFrame(frame);

  // test hook (used by automated checks only)
  window.__ld = { get scene() { return scene; }, get G() { return G; }, BAL, newGame, tryMove, survivable, step: update };
})();
