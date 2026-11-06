/* LavaDodge shared game core: rules, waves, fairness, players, sync.
 * Used by both the 2D (ios/) and 3D (3d/) versions. No rendering in here.
 * Modes: 'solo' | 'local' (2 players, one phone) | 'host' / 'guest' (online, 2 phones).
 */
(function () {
  'use strict';
  const LD = window.LD = window.LD || {};
  const COLS = 6, ROWS = 6;
  const BAL = {
    levelEvery: 12, maxLevel: 20,
    spawnStart: 1.0, spawnMin: 0.3, spawnStep: 0.05,
    warnStart: 1.15, warnMin: 0.55, warnStep: 0.035,
    lavaTime: 0.75, coolTime: 0.35, moveTime: 0.11,
    heatBase: 3.0, heatPerLevel: 0.18, heatAdjLava: 5, iceCool: 38,
    iceEvery: [3.6, 5.4], iceLife: 7, iceMax: 2, iceMax2P: 3,
    ptsPerSec: 10, icePts: 25, closePts: 5,
    lavaGrace: 0.08,       // you can still escape this long after a tile erupts
    remoteGrace: 0.2,      // extra grace for the online guest (network delay)
    countdown: 3,          // seconds of 3-2-1 before a 2-player round
  };
  Object.assign(LD, { COLS, ROWS, BAL });

  // ---------- storage ----------
  LD.store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // ---------- events ----------
  const handlers = {};
  LD.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); };
  function emit(name, a, b, c) { (handlers[name] || []).forEach(fn => fn(a, b, c)); }
  LD.emit = emit;

  // ---------- RNG ----------
  function mulberry32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  LD.mulberry32 = mulberry32;
  let rng = Math.random;
  const ri = n => Math.floor(rng() * n);
  const rr = (a, b) => a + rng() * (b - a);
  LD.todayKey = function () { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };

  // ---------- players ----------
  function makePlayer(id, c, r) {
    return {
      id, c, r, mv: null, queue: null, land: 0, bumpT: 0, bump: [0, 0], face: 0, idleT: 0,
      alive: true, heat: 0, score: 0, bonus: 0, tAlive: 0, deathT: 0, cause: '',
      stats: { ice: 0, close: 0 }, iceCombo: 0, lastIce: -99, lastMoveT: -9,
    };
  }

  // ---------- game ----------
  let G = null, hzId = 1, iceId = 1;
  LD.tally = [0, 0];
  LD.newGame = function (mode, opts) {
    opts = opts || {};
    const two = mode !== 'solo';
    rng = opts.daily ? mulberry32(LD.todayKey()) : Math.random;
    G = LD.G = {
      mode, two, daily: !!opts.daily, t: two ? -BAL.countdown : 0, level: 1,
      hazards: [], ice: [], nextSpawn: 1.2, nextIce: 3,
      players: two ? [makePlayer(0, 1, 3), makePlayer(1, 4, 2)] : [makePlayer(0, 2, 3)],
      over: false, ending: false, endT: 0, winner: -1, events: [],
    };
    emit('newgame', G);
    return G;
  };
  LD.me = function () { return G && G.mode === 'guest' ? 1 : 0; };     // whose HUD sits at the bottom
  LD.isLocal = function (i) { return G.mode === 'solo' || G.mode === 'local' || (G.mode === 'host' ? i === 0 : i === 1); };

  const level = t => Math.min(BAL.maxLevel, 1 + Math.floor(Math.max(0, t) / BAL.levelEvery));
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
  LD.phase = phase;
  function lavaAt(list, c, r, t, margin) {
    for (const h of list) {
      if (h.c !== c || h.r !== r) continue;
      const s = h.t0 + h.warn - margin, e = h.t0 + h.warn + BAL.lavaTime + margin;
      if (t >= s && t < e) return true;
    }
    return false;
  }
  // Fairness: a human-speed path off the lava must exist for the next few seconds.
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
  LD.survivable = survivable;

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
  LD.inB = inB;
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

  // Crack shapes come from a per-hazard seed so both online players see the same cracks.
  LD.makeCracks = function (seed) {
    const R = mulberry32(seed), rrs = (a, b) => a + R() * (b - a);
    const cx = 0.5 + rrs(-0.12, 0.12), cy = 0.5 + rrs(-0.12, 0.12), branches = [], n = 4 + Math.floor(R() * 3);
    for (let b = 0; b < n; b++) {
      let a = (b / n) * Math.PI * 2 + rrs(-0.4, 0.4), x = cx, y = cy; const pts = [[x, y]];
      for (let s = 0; s < 4; s++) { a += rrs(-0.6, 0.6); const len = rrs(0.09, 0.14); x += Math.cos(a) * len; y += Math.sin(a) * len; pts.push([Math.max(0.04, Math.min(0.96, x)), Math.max(0.04, Math.min(0.96, y))]); }
      branches.push(pts);
    }
    return branches;
  };
  function makeHazard(c, r, t0, warn, seed) {
    return { id: hzId++, c, r, t0, warn, seed, cracks: LD.makeCracks(seed), erupted: false };
  }

  const alive = () => G.players.filter(p => p.alive);

  function spawnWave() {
    const lv = G.level, warn = warnTime(lv), live = alive();
    const occupied = (c, r) => G.hazards.some(h => h.c === c && h.r === r && phase(h, G.t) !== 'cool');
    let wave = null;
    for (let attempt = 0; attempt < 8 && !wave; attempt++) {
      const kind = attempt < 6 ? pickPattern(lv) : 'single';
      const target = live[ri(live.length)];
      const cells = cellsFor(kind, lv, target).filter(([c, r]) => !occupied(c, r));
      if (!cells.length) continue;
      const hs = cells.map(([c, r, d, w]) => makeHazard(c, r, G.t + d, warn + w, (rng() * 2147483647) | 0));
      const all = G.hazards.concat(hs);
      if (live.every(p => survivable(all, p.c, p.r, G.t))) wave = hs;
    }
    if (!wave) { G.nextSpawn = G.t + 0.25; return; }
    G.hazards.push(...wave);
    G.nextSpawn = G.t + spawnInterval(lv) * (1 + Math.min(1.6, 0.12 * (wave.length - 1))) * rr(0.85, 1.15) * (G.two ? 0.9 : 1);
  }

  function spawnIce() {
    G.nextIce = G.t + rr(BAL.iceEvery[0], BAL.iceEvery[1]) * (G.two ? 0.8 : 1);
    if (G.ice.length >= (G.two ? BAL.iceMax2P : BAL.iceMax)) return;
    for (let i = 0; i < 20; i++) {
      const c = ri(COLS), r = ri(ROWS);
      if (G.players.some(p => Math.abs(c - p.c) + Math.abs(r - p.r) < 2)) continue;
      if (G.ice.some(o => o.c === c && o.r === r) || G.hazards.some(h => h.c === c && h.r === r)) continue;
      G.ice.push({ id: iceId++, c, r, t0: G.t });
      return;
    }
  }

  const blocked = (p, c, r) => G.players.some(o => o !== p && o.alive && o.c === c && o.r === r);

  // Local input. i = player index. Returns true if a hop started.
  LD.tryMove = function (i, dx, dy) {
    if (!G || G.over || G.ending || G.t < 0) return false;
    const p = G.players[i];
    if (!p || !p.alive || !LD.isLocal(i)) return false;
    if (p.mv) { p.queue = [dx, dy]; return false; }
    const nc = p.c + dx, nr = p.r + dy;
    if (!inB(nc, nr) || blocked(p, nc, nr)) { p.land = 0.12; p.bump = [dx, dy]; p.bumpT = 0.12; return false; }
    startHop(p, nc, nr, dx, dy);
    emit('move', p, true);
    if (G.mode === 'guest' && LD.Net) LD.Net.send({ ty: 'm', c: nc, r: nr, dx, dy });
    return true;
  };
  function startHop(p, nc, nr, dx, dy) {
    p.mv = { fc: p.c, fr: p.r, dx, dy, t: 0 };
    p.c = nc; p.r = nr; p.idleT = 0; p.lastMoveT = G.t;
    p.face = Math.atan2(dx, dy);
  }

  // Animated position of a player: fractional cell coords and hop height (0..1).
  LD.playerAnim = function (p) {
    let c = p.c, r = p.r, hop = 0, k = 1;
    if (p.mv) {
      k = Math.min(1, p.mv.t / BAL.moveTime); const e = 1 - (1 - k) * (1 - k);
      c = p.mv.fc + p.mv.dx * e; r = p.mv.fr + p.mv.dy * e; hop = Math.sin(Math.PI * k);
    }
    let bx = 0, by = 0;
    if (p.bumpT > 0) { const b = Math.sin((p.bumpT / 0.12) * Math.PI) * 0.08; bx = p.bump[0] * b; by = p.bump[1] * b; }
    return { c: c + bx, r: r + by, hop, k };
  };

  function animPlayers(dt) {
    for (const p of G.players) {
      if (p.mv) {
        p.mv.t += dt;
        if (p.mv.t >= BAL.moveTime) {
          p.mv = null; p.land = 0.14; emit('land', p);
          if (p.queue) { const q = p.queue; p.queue = null; LD.tryMove(p.id, q[0], q[1]); }
        }
      } else p.idleT += dt;
      p.land = Math.max(0, p.land - dt);
      if (p.bumpT > 0) p.bumpT -= dt;
      if (!p.alive) p.deathT += dt;
    }
  }

  function ev(e) { if (G.mode === 'host') G.events.push(e); applyEvent(e); }
  // Events change score/visual state; on the guest they arrive from the host.
  function applyEvent(e) {
    const p = G.players[e[1]];
    switch (e[0]) {
      case 'close': emit('close', p, e[2], e[3]); break;
      case 'ice': emit('ice', p, e[2], e[3], e[4], e[5]); break;
      case 'death': emit('death', p, e[2]); break;
      case 'level': emit('level', e[1]); break;
    }
  }

  // ---------- simulation (solo / local / host) ----------
  LD.update = function (dt) {
    if (!G) return;
    if (G.mode === 'guest') return guestUpdate(dt);
    animPlayers(dt);
    if (G.over) return;
    if (G.ending) { G.endT += dt; if (G.endT > 1.3) finish(); return; }
    const prevT = G.t;
    G.t += dt;
    if (G.t < 0) { if (Math.ceil(G.t) !== Math.ceil(prevT)) emit('count', Math.ceil(-G.t)); return; }
    if (prevT < 0) emit('count', 0);

    const lv = level(G.t);
    if (lv > G.level) { G.level = lv; ev(['level', lv]); }
    if (G.t >= G.nextSpawn) spawnWave();
    if (G.t >= G.nextIce) spawnIce();

    const adj = G.players.map(() => 0);
    let erupted = false;
    for (let i = G.hazards.length - 1; i >= 0; i--) {
      const h = G.hazards[i], ph = phase(h, G.t);
      if (ph === 'lava') {
        if (!h.erupted) {
          h.erupted = true; erupted = true; emit('erupt', h);
          G.ice = G.ice.filter(o => !(o.c === h.c && o.r === h.r));
          for (const p of G.players) if (p.alive && Math.abs(h.c - p.c) + Math.abs(h.r - p.r) === 1) {
            p.bonus += BAL.closePts; p.stats.close++; ev(['close', p.id, h.c, h.r]);
          }
        }
        const age = G.t - (h.t0 + h.warn);
        for (const p of G.players) {
          if (!p.alive) continue;
          const grace = BAL.lavaGrace + (G.mode === 'host' && p.id === 1 ? BAL.remoteGrace : 0);
          if (h.c === p.c && h.r === p.r && age >= grace) kill(p, 'lava');
          else if (Math.abs(h.c - p.c) + Math.abs(h.r - p.r) === 1) adj[p.id]++;
        }
      } else if (ph === 'done') G.hazards.splice(i, 1);
    }
    if (erupted) emit('sizzle');

    for (let i = G.ice.length - 1; i >= 0; i--) {
      const o = G.ice[i];
      if (G.t - o.t0 > BAL.iceLife) { G.ice.splice(i, 1); continue; }
      const p = G.players.find(q => q.alive && q.c === o.c && q.r === o.r && (!q.mv || q.mv.t > BAL.moveTime * 0.5));
      if (p) {
        G.ice.splice(i, 1);
        p.iceCombo = G.t - p.lastIce < 8 ? Math.min(3, p.iceCombo + 1) : 1; p.lastIce = G.t;
        const pts = BAL.icePts * p.iceCombo;
        p.bonus += pts; p.stats.ice++; p.heat = Math.max(0, p.heat - BAL.iceCool);
        ev(['ice', p.id, o.c, o.r, pts, p.iceCombo]);
      }
    }

    for (const p of G.players) {
      if (!p.alive) continue;
      p.tAlive = G.t;
      p.heat += dt * (BAL.heatBase + BAL.heatPerLevel * (G.level - 1) + adj[p.id] * BAL.heatAdjLava);
      if (p.heat >= 100) { p.heat = 100; kill(p, 'heat'); }
      p.score = Math.floor(G.t * (BAL.ptsPerSec + (G.level - 1))) + p.bonus;
    }

    const live = alive();
    if (!G.two ? live.length === 0 : live.length <= 1) {
      G.ending = true; G.endT = 0;
      if (G.two) {
        // last Olaf standing wins; if both burned together, higher score wins, else draw
        if (live.length === 1) G.winner = live[0].id;
        else { const [a, b] = G.players; G.winner = a.score === b.score ? 2 : (a.score > b.score ? 0 : 1); }
        if (G.winner < 2) LD.tally[G.winner]++;
      }
      emit('ending', G);
    }
  };

  function kill(p, cause) {
    if (!p.alive) return;
    p.alive = false; p.cause = cause; p.deathT = 0; p.mv = null; p.queue = null;
    ev(['death', p.id, cause]);
  }

  function finish() {
    G.over = true;
    if (G.mode === 'solo') {
      const p = G.players[0], k = LD.bestKey(G.daily);
      G.prevBest = LD.store.get(k, 0); G.newBest = p.score > G.prevBest;
      if (G.newBest) LD.store.set(k, p.score);
    }
    emit('over', G);
  }
  // Renderers can override the key names (the 3D version keeps its own bests).
  LD.keyBest = 'ld_best'; LD.keyDaily = 'ld_daily_';
  LD.bestKey = function (daily) { return daily ? LD.keyDaily + LD.todayKey() : LD.keyBest; };

  // ---------- online sync ----------
  // Host -> guest snapshot (~20/s). Hazards carry their crack seed; events since the last snapshot ride along.
  LD.snapshot = function () {
    const s = {
      ty: 's', t: +G.t.toFixed(3), lv: G.level, ov: G.over ? 1 : 0, en: G.ending ? 1 : 0, w: G.winner, ta: LD.tally,
      p: G.players.map(p => [p.c, p.r, p.alive ? 1 : 0, +p.heat.toFixed(1), p.score, p.cause, p.stats.ice, p.stats.close, +p.tAlive.toFixed(1)]),
      hz: G.hazards.map(h => [h.id, h.c, h.r, +h.t0.toFixed(3), +h.warn.toFixed(3), h.seed]),
      ice: G.ice.map(o => [o.id, o.c, o.r, +o.t0.toFixed(2)]),
      ev: G.events,
    };
    G.events = [];
    return s;
  };
  // Guest applies a snapshot. The guest's own position stays local (it sent its moves to the host).
  LD.applySnapshot = function (s) {
    if (!G || G.mode !== 'guest') return;
    G.lastSnap = performance.now();
    if (Math.abs(G.t - s.t) > 0.15 || G.t > s.t) G.t = s.t; else G.t += (s.t - G.t) * 0.5;
    const prevLevel = G.level; G.level = s.lv;
    if (s.lv > prevLevel && !s.ev.some(e => e[0] === 'level')) emit('level', s.lv);
    G.winner = s.w; LD.tally = s.ta;
    s.p.forEach((a, i) => {
      const p = G.players[i];
      if (i === 0 && p.alive && (a[0] !== p.c || a[1] !== p.r)) {
        // remote hop: animate from where we last saw them
        if (Math.abs(a[0] - p.c) + Math.abs(a[1] - p.r) === 1) { startHop(p, a[0], a[1], a[0] - p.c, a[1] - p.r); emit('move', p, false); }
        else { p.c = a[0]; p.r = a[1]; p.mv = null; }
      }
      p.heat = a[3]; p.score = a[4]; p.stats.ice = a[6]; p.stats.close = a[7]; p.tAlive = a[8];
      if (p.alive && !a[2]) { p.alive = false; p.cause = a[5]; p.deathT = 0; p.mv = null; }
    });
    const old = new Map(G.hazards.map(h => [h.id, h]));
    G.hazards = s.hz.map(([id, c, r, t0, warn, seed]) => old.get(id) || { id, c, r, t0, warn, seed, cracks: LD.makeCracks(seed), erupted: false });
    G.ice = s.ice.map(([id, c, r, t0]) => ({ id, c, r, t0 }));
    s.ev.forEach(e => { if (e[0] !== 'death') applyEvent(e); else emit('death', G.players[e[1]], e[2]); });
    if (s.en && !G.ending) { G.ending = true; emit('ending', G); }
    if (s.ov && !G.over) { G.over = true; emit('over', G); }
  };
  function guestUpdate(dt) {
    animPlayers(dt);
    if (G.over) return;
    const prevT = G.t; G.t += dt;
    if (G.t < 0) { if (Math.ceil(G.t) !== Math.ceil(prevT)) emit('count', Math.ceil(-G.t)); return; }
    if (prevT < 0) emit('count', 0);
    let erupted = false;
    for (const h of G.hazards) if (!h.erupted && phase(h, G.t) === 'lava') { h.erupted = true; erupted = true; emit('erupt', h); }
    if (erupted) emit('sizzle');
  }
  // Host receives a guest move.
  LD.remoteMove = function (m) {
    if (!G || G.mode !== 'host' || G.over || G.ending) return;
    const p = G.players[1];
    if (!p.alive || !inB(m.c, m.r)) return;
    startHop(p, m.c, m.r, m.dx, m.dy);
    emit('move', p, false);
  };
})();
