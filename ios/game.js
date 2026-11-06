/* LavaDodge: Overheat — 2D renderer (canvas). Game rules, menus and multiplayer
 * live in ../shared/. Original game by William Yao (2017).
 */
(function () {
  'use strict';
  const LD = window.LD;
  const { COLS, ROWS, BAL } = LD;
  const IMG = LD.IMG = {};
  const names = ['olaf', 'olaf_burnt', 'olaf_sweat', 'ice', 'tile', 'lava', 'crack', 'btn_up', 'btn_down', 'btn_left', 'btn_right'];
  let loaded = 0; const total = names.length + 1;
  function load(n, src) {
    return new Promise(res => { const i = new Image(); i.onload = i.onerror = () => { loaded++; res(); }; i.src = src; IMG[n] = i; });
  }
  // Player 2: same Olaf with purple goggles and feet (hue-shift the blue pixels).
  function recolor(img) {
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      const r = a[i], gg = a[i + 1], b = a[i + 2];
      if (b > r + 25 && b > gg + 5) { // blue-ish -> purple
        a[i] = Math.min(255, b * 0.8 + r * 0.2 + 30); a[i + 1] = gg * 0.55; a[i + 2] = b;
      }
    }
    g.putImageData(d, 0, 0);
    return c;
  }
  const ready = Promise.all(names.map(n => load(n, 'assets/img/' + n + '.png')).concat([load('bg', 'assets/img/bg.jpg')]))
    .then(() => { for (const n of ['olaf', 'olaf_burnt', 'olaf_sweat']) IMG[n + '2'] = recolor(IMG[n]); });

  let L = {};
  const particles = [];
  function puff(x, y, n, color, spd, size, up) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = spd * (0.4 + Math.random() * 0.6);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5 - (up || 0), life: 0, max: 0.35 + Math.random() * 0.3, size: size * (0.6 + Math.random() * 0.6), color });
    }
  }
  const cx = c => L.boardX + (c + 0.5) * L.tile, cy = r => L.boardY + (r + 0.5) * L.tile;
  LD.on('land', p => { const a = LD.playerAnim(p); puff(cx(a.c), cy(a.r) + L.tile * 0.3, 5, 'rgba(235,225,205,', L.tile * 1.2, L.tile * 0.09, 10); });
  LD.on('erupt', h => puff(cx(h.c), cy(h.r), 6, 'rgba(255,170,40,', L.tile * 1.6, L.tile * 0.08, 30));
  LD.on('ice', (p, c, r) => puff(cx(c), cy(r), 12, 'rgba(170,230,255,', L.tile * 2, L.tile * 0.1, 40));
  LD.on('death', (p, cause) => { const a = LD.playerAnim(p); puff(cx(a.c), cy(a.r) - L.tile * 0.2, 14, cause === 'heat' ? 'rgba(255,120,60,' : 'rgba(90,90,90,', L.tile * 2, L.tile * 0.12, 60); });
  LD.on('newgame', () => { particles.length = 0; });

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawBackground(ctx) {
    const bg = IMG.bg;
    if (bg && bg.naturalWidth) {
      const s = Math.max(L.W / bg.naturalWidth, L.H / bg.naturalHeight), w = bg.naturalWidth * s, h = bg.naturalHeight * s;
      ctx.drawImage(bg, (L.W - w) / 2, (L.H - h) / 2, w, h);
    } else { ctx.fillStyle = '#7cc7e0'; ctx.fillRect(0, 0, L.W, L.H); }
  }
  function drawOlaf(ctx, x, y, size, img, sx, sy, rot) {
    if (!img || !(img.naturalWidth || img.width)) return;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(sx, sy);
    ctx.drawImage(img, -size / 2, -size, size, size); // anchor at feet
    ctx.restore();
  }
  function drawShadow(ctx, x, y, T, hop) {
    const k = 1 - Math.min(0.5, hop / T);
    ctx.beginPath(); ctx.ellipse(x, y, T * 0.3 * k, T * 0.09 * k, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.3 * k) + ')'; ctx.fill();
  }

  function drawTitleArt(ctx) {
    const top = Math.max(L.safe.top, 10) + 6 + Math.max(6, L.H * 0.03), big = Math.min(72, L.W * 0.19);
    const logoBottom = top + 50 + big * 0.9 + 60, btnTop = L.H - Math.max(L.safe.bottom, 10) - 250 - 34;
    const T = Math.max(60, Math.min(130, (btnTop - logoBottom) * 0.7)), cxx = L.W / 2, oy = (logoBottom + btnTop) / 2 - T * 0.1;
    const time = LD.ui.time;
    ctx.drawImage(IMG.tile, cxx - T / 2, oy - T / 2 + 20, T, T);
    const hopK = (time * 1.3) % 1, hop = hopK < 0.35 ? Math.sin(hopK / 0.35 * Math.PI) * T * 0.2 : 0;
    const sq = hopK > 0.35 && hopK < 0.45 ? 1 - (0.45 - hopK) * 2 : 1;
    drawShadow(ctx, cxx, oy + T * 0.22 + 20, T * 0.9, hop * 2);
    drawOlaf(ctx, cxx, oy + T * 0.25 + 20 - hop, T * 0.95, IMG.olaf, 2 - sq, sq, 0);
  }

  function drawBoard(ctx) {
    const G = LD.G, T = L.tile, bx = L.boardX, by = L.boardY, time = LD.ui.time, t = G.t;
    rrect(ctx, bx - 8, by - 8, L.board + 16, L.board + 16, 16); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    const hk = LD.heatK();
    // the gaps between tiles start to glow like lava as the heat rises
    ctx.save();
    if (hk > 0) { ctx.shadowColor = 'rgba(255,90,20,' + hk + ')'; ctx.shadowBlur = 24 * hk; }
    rrect(ctx, bx - 5, by - 5, L.board + 10, L.board + 10, 13);
    ctx.fillStyle = 'rgb(' + (61 + 194 * hk * (0.85 + 0.15 * Math.sin(time * 3)) | 0) + ',' + (42 + 48 * hk | 0) + ',' + (26 - 6 * hk | 0) + ')'; ctx.fill();
    ctx.restore();
    const map = {};
    for (const h of G.hazards) { const ph = LD.phase(h, t); if (ph !== 'wait' && ph !== 'done') map[h.c + h.r * COLS] = { h, ph }; }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = bx + c * T, y = by + r * T, m = map[c + r * COLS];
      if (!m) {
        ctx.drawImage(IMG.tile, x, y, T, T);
        if (hk > 0) { ctx.fillStyle = 'rgba(55,20,8,' + 0.42 * hk + ')'; ctx.fillRect(x, y, T, T); } // scorched
        continue;
      }
      const h = m.h, a = t - h.t0;
      if (m.ph === 'crack') {
        const k = a / h.warn, late = k > 0.7, j = late ? (Math.random() - 0.5) * T * 0.05 * (k - 0.7) / 0.3 * 2 : 0;
        ctx.drawImage(IMG.tile, x + j, y + j * 0.6, T, T);
        const pulse = late ? 0.5 + 0.5 * Math.sin(time * 40) : 0;
        const g = ctx.createRadialGradient(x + T / 2, y + T / 2, 0, x + T / 2, y + T / 2, T * 0.7);
        g.addColorStop(0, 'rgba(255,140,20,' + (0.15 + k * 0.45 + pulse * 0.15) + ')'); g.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x, y, T, T);
        const prog = Math.min(1, Math.pow(k * 1.15, 0.7)) * 4;
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const pass of [0, 1]) {
          ctx.strokeStyle = pass ? 'rgba(255,' + (200 - k * 80 | 0) + ',60,' + (0.4 + k * 0.6) + ')' : '#1a0d05';
          ctx.lineWidth = pass ? Math.max(1, T * 0.022) : Math.max(2, T * 0.06);
          for (const br of h.cracks) {
            ctx.beginPath(); ctx.moveTo(x + j + br[0][0] * T, y + j * 0.6 + br[0][1] * T);
            for (let s = 1; s < br.length; s++) {
              const f = Math.min(1, Math.max(0, prog - (s - 1))); if (f <= 0) break;
              ctx.lineTo(x + j + (br[s - 1][0] + (br[s][0] - br[s - 1][0]) * f) * T, y + j * 0.6 + (br[s - 1][1] + (br[s][1] - br[s - 1][1]) * f) * T);
            }
            ctx.stroke();
          }
        }
        ctx.restore();
      } else {
        ctx.drawImage(IMG.tile, x, y, T, T);
        const la = a - h.warn, cool = m.ph === 'cool';
        const pop = !cool ? 1 + Math.max(0, 0.12 - la) * 1.4 : 1;
        ctx.save(); ctx.globalAlpha = cool ? 1 - (la - BAL.lavaTime) / BAL.coolTime : 1;
        const s = T * pop, o = (s - T) / 2;
        ctx.drawImage(IMG.lava, x - o, y - o, s, s);
        if (!cool) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(255,150,40,' + (0.12 + 0.1 * Math.sin(time * 12 + c * 1.7 + r)) + ')'; ctx.fillRect(x, y, T, T);
          ctx.globalCompositeOperation = 'source-over';
          for (let b = 0; b < 3; b++) {
            const ph2 = (time * 1.8 + b * 0.37 + (c * 7 + r * 3) * 0.13) % 1;
            ctx.beginPath(); ctx.arc(x + T * (0.2 + ((b * 0.31 + c * 0.17) % 0.6)), y + T * (0.75 - ph2 * 0.5), T * 0.05 * (1 - ph2), 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,230,120,' + (1 - ph2) + ')'; ctx.fill();
          }
        } else { ctx.fillStyle = 'rgba(40,30,30,0.45)'; ctx.fillRect(x, y, T, T); }
        ctx.restore();
      }
    }
    for (const o of G.ice) {
      const age = t - o.t0, left = BAL.iceLife - age;
      if (left < 2 && Math.floor(age * 8) % 2) continue;
      const s = T * 0.72 * Math.min(1, age * 5) * (1 + 0.04 * Math.sin(time * 5));
      const x = bx + (o.c + 0.5) * T, y = by + (o.r + 0.5) * T - Math.sin(time * 4 + o.c) * T * 0.04;
      ctx.drawImage(IMG.ice, x - s / 2, y - s / 2, s, s);
    }
  }

  // Fiery border around cracking tiles. 'under' = all (below Olaf); 'over' = only tiles
  // an Olaf is standing still on, faded in after landing, so a crack under his feet shows.
  function drawCrackBorders(ctx, pass) {
    const G = LD.G, T = L.tile, t = G.t, time = LD.ui.time;
    for (const h of G.hazards) {
      if (LD.phase(h, t) !== 'crack') continue;
      let over = 1;
      if (pass === 'over') {
        const p = G.players.find(q => q.alive && !q.mv && q.c === h.c && q.r === h.r);
        if (!p) continue;
        over = 1 - p.land / 0.14; if (over <= 0) continue;
      }
      const k = (t - h.t0) / h.warn, late = k > 0.65, pulse = late ? 0.5 + 0.5 * Math.sin(time * 30) : 0;
      const s = T * (1 + (late ? 0.06 * pulse : 0)), x = L.boardX + h.c * T - (s - T) / 2, y = L.boardY + h.r * T - (s - T) / 2;
      ctx.save();
      ctx.globalAlpha = Math.min(1, 0.55 + k * 0.6) * over;
      ctx.drawImage(IMG.crack, x, y, s, s);
      if (late) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * pulse * over; ctx.drawImage(IMG.crack, x, y, s, s); }
      ctx.restore();
    }
  }

  function drawPlayers(ctx) {
    const G = LD.G, T = L.tile, time = LD.ui.time;
    // draw back-to-front so the lower Olaf overlaps the upper one
    const order = G.players.slice().sort((a, b) => LD.playerAnim(a).r - LD.playerAnim(b).r);
    for (const p of order) {
      const a = LD.playerAnim(p), x = cx(a.c), y = cy(a.r), size = T * 0.95, sfx = p.id === 1 ? '2' : '';
      if (!p.alive) {
        const d = Math.min(p.deathT, 1.3), hop = Math.sin(Math.min(1, d / 0.5) * Math.PI) * T * 0.5;
        const sq = d > 0.5 ? Math.max(0.6, 1 - (d - 0.5) * 0.6) : 1;
        drawShadow(ctx, x, y + T * 0.38, T, hop);
        drawOlaf(ctx, x, y + T * 0.42 - hop, size, IMG['olaf_burnt' + sfx], 1 + (1 - sq) * 0.5, sq, Math.sin(d * 30) * 0.06 * Math.max(0, 1 - d));
        continue;
      }
      let sx = 1, sy = 1, rot = 0, img = IMG[(p.heat > 70 ? 'olaf_sweat' : 'olaf') + sfx];
      const hop = a.hop * T * 0.32;
      if (p.mv) {
        const k = a.k, s = Math.sin(Math.PI * k);
        sx = 1 - 0.14 * s; sy = 1 + 0.18 * s; rot = p.mv.dx * 0.22 * s;
        if (k < 0.2) { sx = 1 + 0.15 * (1 - k / 0.2); sy = 1 - 0.12 * (1 - k / 0.2); }
      } else if (p.land > 0) { const e = p.land / 0.14; sx = 1 + 0.22 * e; sy = 1 - 0.2 * e; }
      else { sy = 1 + 0.035 * Math.sin(time * 5.5 + p.id); sx = 1 - 0.02 * Math.sin(time * 5.5 + p.id); }
      drawShadow(ctx, x, y + T * 0.38, T, hop);
      drawOlaf(ctx, x, y + T * 0.42 - hop, size, img, sx, sy, rot);
      if (p.heat > 70 && Math.random() < 0.1) puff(x + (Math.random() - 0.5) * T * 0.6, y - T * 0.3, 1, 'rgba(120,200,255,', T, T * 0.06, 50);
    }
  }

  function drawFx(ctx, dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i]; q.life += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 120 * dt;
      if (q.life > q.max) { particles.splice(i, 1); continue; }
      const a = 1 - q.life / q.max;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (0.5 + a * 0.5), 0, Math.PI * 2); ctx.fillStyle = q.color + a + ')'; ctx.fill();
    }
  }

  LD.renderer = {
    ready, progress: () => loaded / total,
    layout(l) { L = l; },
    cellToScreen(c, r, h) { return { x: cx(c), y: cy(r) - h * L.tile }; },
    draw(ctx, scene, dt) {
      drawBackground(ctx);
      const G = LD.G;
      if (G && !['title', 'menu2p', 'hosting', 'joining', 'loading', 'howto'].includes(scene)) LD.drawHeatSky(ctx, LD.heatK(), L.W, L.H);
      if (!G || ['title', 'menu2p', 'hosting', 'joining', 'loading', 'howto'].includes(scene)) {
        if (scene === 'title' && IMG.tile.naturalWidth) drawTitleArt(ctx);
        return;
      }
      ctx.save();
      const sh = LD.ui.shake; if (sh > 0) ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
      drawBoard(ctx); drawCrackBorders(ctx, 'under'); drawPlayers(ctx); drawCrackBorders(ctx, 'over'); drawFx(ctx, dt);
      ctx.restore();
    },
  };
  LD.start();
  window.__ld = LD;
})();
