/* LavaDodge shared UI: layout, HUD, arrow pads, menus, lobby, input, audio, main loop.
 * A renderer (2D or 3D) registers itself as LD.renderer before LD.start() is called:
 *   { ready: Promise, progress(): 0..1, layout(L), draw(ctx, scene, dt), cellToScreen(c, r, h) -> {x, y} }
 * In same-phone mode Player 2 sits across the table: their HUD, arrow pad and result panel
 * are the bottom ones rotated 180 degrees around the screen center.
 */
(function () {
  'use strict';
  const LD = window.LD;
  const store = LD.store;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const safeEl = document.getElementById('safe');
  let W = 0, H = 0, DPR = 1, L = {};
  const UIst = LD.ui = { scene: 'loading', time: 0, shake: 0, flash: 0, banner: null, floaters: [], msg: '' };
  const COLORS = ['#4dabf7', '#c77dff'];
  const NAMES = ['P1', 'P2'];

  // ---------- layout ----------
  function readSafe() {
    const cs = getComputedStyle(safeEl);
    return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0, right: parseFloat(cs.paddingRight) || 0 };
  }
  function padAt(cx, cy, btn) {
    return {
      up: { x: cx, y: cy - btn * 1.05, dir: [0, -1] }, down: { x: cx, y: cy + btn * 1.05, dir: [0, 1] },
      left: { x: cx - btn * 1.15, y: cy, dir: [-1, 0] }, right: { x: cx + btn * 1.15, y: cy, dir: [1, 0] },
    };
  }
  function layout() {
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const s = readSafe();
    const local = LD.G && LD.G.mode === 'local' && UIst.scene !== 'title' && UIst.scene !== 'menu2p';
    let board, boardX, boardY, btn, pad, hud;
    if (local) {
      const edge = Math.max(s.top, s.bottom, 10) + 4;
      board = Math.floor(Math.min(W - 16 - s.left - s.right, H * 0.42, 540) / 6) * 6;
      const half = (H - board) / 2, hudH = 40;
      btn = Math.max(38, Math.min(72, (half - hudH - edge - 12) / 3.25));
      boardX = Math.round((W - board) / 2); boardY = Math.round((H - board) / 2);
      const padCy = boardY + board + 6 + (half - hudH - edge - 6) / 2;
      pad = padAt(W / 2, padCy, btn);
      hud = { y: H - edge - hudH / 2, edge };
    } else {
      const top = Math.max(s.top, 10) + 6;
      const hudH = LD.G && (LD.G.mode === 'host' || LD.G.mode === 'guest') ? 98 : 78;
      const bottom = Math.max(s.bottom, 10) + 6;
      const avail = H - top - hudH - bottom;
      board = Math.floor(Math.min(W - 28 - s.left - s.right, avail * 0.6, 540) / 6) * 6;
      const rest = avail - board - 14;
      btn = Math.max(40, Math.min(board / 6 * 1.2, rest / 3.25, 92));
      boardX = Math.round((W - board) / 2); boardY = Math.round(top + hudH + 4);
      pad = padAt(W / 2, boardY + board + 14 + Math.max(btn * 1.6, rest / 2), btn);
      hud = { top, hudH };
    }
    L = {
      W, H, local, board, tile: board / 6, boardX, boardY, boardCx: boardX + board / 2, boardCy: boardY + board / 2,
      btn, pad, hud, safe: s,
      sound: { x: W - s.right - 30, y: Math.max(s.top, 10) + 26, r: 19 },
      help: { x: s.left + 30, y: Math.max(s.top, 10) + 26, r: 19 },
      pause: local ? { x: W - s.right - 30, y: hud.y, r: 17 } : { x: W - s.right - 74, y: Math.max(s.top, 10) + 26, r: 19 },
    };
    LD.L = L;
    if (LD.renderer && LD.renderer.layout) LD.renderer.layout(L);
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 200));

  // ---------- audio (Web Audio for low latency on iOS) ----------
  const Audio = LD.Audio = {
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

  // ---------- game events -> sounds, floating text, banners ----------
  function floatText(c, r, h, text, color, size) { UIst.floaters.push({ c, r, h, text, color, size: size || 18, life: 0 }); }
  LD.on('move', (p, local) => Audio.play('move', local ? 0.55 : 0.25, 0.95 + Math.random() * 0.1));
  LD.on('sizzle', () => Audio.sizzle(0.08));
  LD.on('close', (p, c, r) => { UIst.shake = Math.max(UIst.shake, 3); floatText(c, r, 0.6, 'CLOSE! +' + LD.BAL.closePts, '#ffe066', 16); });
  LD.on('ice', (p, c, r, pts, combo) => {
    floatText(c, r, 0.9, (combo > 1 ? 'x' + combo + ' ' : '') + 'CHILL +' + pts, '#bff3ff', 18);
    Audio.tone([880, 1320, 1760].slice(0, 1 + combo), 0.12, 'sine', 0.16);
  });
  LD.on('level', lv => { UIst.banner = { text: 'HEAT ' + lv, t: 0 }; UIst.flash = 0.5; Audio.tone([523, 659, 784, 1047], 0.14, 'triangle', 0.12); });
  LD.on('count', n => {
    UIst.banner = { text: n ? String(n) : 'GO!', t: 0, short: true };
    Audio.tone([n ? 660 : 990], n ? 0.15 : 0.3, 'square', 0.08);
  });
  LD.on('death', p => {
    UIst.shake = 10;
    if (!LD.G.two) { Audio.stopMusic(); Audio.play('game-over', 0.8); }
    else Audio.tone([300, 200], 0.25, 'sawtooth', 0.1);
  });
  LD.on('ending', G => { if (G.two) { Audio.stopMusic(); Audio.play('game-over', 0.8); } });
  LD.on('over', () => { UIst.overT = 0; if (UIst.scene === 'play' || UIst.scene === 'paused') UIst.scene = 'over'; });

  function startGame(mode, opts) {
    for (const k in UI) delete UI[k];
    UIst.floaters.length = 0; UIst.banner = null;
    LD.newGame(mode, opts);
    UIst.scene = 'play'; UIst.overT = 0; UIst.waitHost = false;
    if (mode === 'solo') UIst.banner = { text: opts && opts.daily ? 'DAILY RUN' : 'GO!', t: 0 };
    layout();
    Audio.startMusic();
  }
  LD.startGame = startGame;

  // ---------- online lobby ----------
  function hostOnline() {
    UIst.scene = 'hosting'; UIst.code = ''; UIst.msg = 'Creating room…'; LD.tally = [0, 0];
    LD.Net.host({
      onCode: code => { UIst.code = code; UIst.msg = 'Waiting for your friend to join…'; UIst.tips = false; },
      onStatus: (m, bad) => { UIst.msg = m; UIst.tips = !!bad; },
      onOpen: () => { startGame('host'); LD.Net.send({ ty: 'start' }); },
      onMsg: netMsg, onClose: netLost, onError: e => { UIst.scene = 'menu2p'; toast(e); },
    });
  }
  function joinOnline(code) {
    UIst.msg = 'Connecting…'; UIst.joinBusy = true; UIst.tips = false; LD.tally = [0, 0];
    LD.Net.join(code, {
      onOpen: () => { UIst.msg = 'Connected! Starting…'; },
      onStatus: m => { UIst.msg = m; },
      onMsg: netMsg, onClose: netLost, onError: e => { UIst.joinBusy = false; UIst.msg = e; UIst.tips = /link/.test(e); },
    });
  }
  function netMsg(m) {
    if (!m) return;
    const G = LD.G;
    if (m.ty === 's') { if (G && G.mode === 'guest') LD.applySnapshot(m); }
    else if (m.ty === 'start') { hideCodeInput(); UIst.joinBusy = false; startGame('guest'); }
    else if (m.ty === 'm') LD.remoteMove(m);
    else if (m.ty === 'rematch') { if (G && G.mode === 'host' && G.over) { startGame('host'); LD.Net.send({ ty: 'start' }); } }
    else if (m.ty === 'bye') netLost();
  }
  function netLost() {
    if (UIst.scene === 'title') return;
    hideCodeInput(); Audio.stopMusic();
    UIst.scene = 'netlost'; UIst.msg = 'Your friend left the game';
  }
  function leaveOnline() { LD.Net.send({ ty: 'bye' }); setTimeout(() => LD.Net.close(), 100); }
  let toastT = 0, toastMsg = '';
  function toast(m) { toastMsg = m; toastT = 3; }

  // Code entry box (a real input so the iPhone keyboard appears)
  let codeInput = null;
  function showCodeInput() {
    if (!codeInput) {
      codeInput = document.createElement('input');
      Object.assign(codeInput, { maxLength: 4, autocomplete: 'off', spellcheck: false, placeholder: 'CODE' });
      codeInput.setAttribute('autocapitalize', 'characters'); codeInput.setAttribute('autocorrect', 'off');
      Object.assign(codeInput.style, {
        position: 'absolute', zIndex: 5, width: '210px', height: '64px', left: '50%', marginLeft: '-105px',
        font: '900 40px "Arial Rounded MT Bold", ui-rounded, system-ui, sans-serif', letterSpacing: '8px', textAlign: 'center',
        textTransform: 'uppercase', border: '4px solid #000', borderRadius: '16px', background: '#fff', color: '#111', outline: 'none',
        touchAction: 'manipulation', padding: '0 0 0 8px', boxSizing: 'border-box',
      });
      codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
      codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryJoin(); });
      document.body.appendChild(codeInput);
    }
    codeInput.value = ''; codeInput.style.display = 'block';
    codeInput.style.top = (H / 2 - 70) + 'px';
    setTimeout(() => codeInput.focus(), 50);
  }
  function hideCodeInput() { if (codeInput) { codeInput.blur(); codeInput.style.display = 'none'; } }
  function tryJoin() {
    const v = (codeInput && codeInput.value || '').toUpperCase();
    if (v.length !== 4) { UIst.msg = 'Codes are 4 letters'; return; }
    codeInput.blur(); joinOnline(v);
  }

  // ---------- drawing helpers ----------
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
  const BTN = {
    green: ['#34e07f', '#13a24f'], cyan: ['#4fe3ff', '#0aa6d6'], orange: ['#ffb347', '#f0701a'], purple: ['#a5b4fc', '#6c7ae0'],
  };
  function iconBtn(b, kind) {
    ctx.save();
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    const s = b.r / 19;
    if (kind === 'pause') { ctx.fillRect(b.x - 6 * s, b.y - 7 * s, 4 * s, 14 * s); ctx.fillRect(b.x + 2 * s, b.y - 7 * s, 4 * s, 14 * s); }
    else if (kind === 'help') { text('?', b.x, b.y + 1, 24 * s, '#000', { stroke: false }); }
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
  function heatBar(x, y, w, h, heat, label) {
    rrect(x, y, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
    const f = heat / 100;
    if (f > 0) {
      const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#4dabf7'); g.addColorStop(0.5, '#ffd43b'); g.addColorStop(1, '#f03e3e');
      ctx.save(); rrect(x, y, w, h, h / 2); ctx.clip(); ctx.fillStyle = g; ctx.fillRect(x, y, w * f, h); ctx.restore();
    }
    rrect(x, y, w, h, h / 2); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
    if (label !== false) {
      if (f > 0.7 && Math.floor(UIst.time * 6) % 2) text('OVERHEATING!', x + w / 2, y + h / 2, Math.min(12, h * 0.85), '#fff', { lw: 3 });
      else text('HEAT', x + w / 2, y + h / 2, Math.min(11, h * 0.8), '#fff', { lw: 3 });
    }
  }
  function chip(x, y, label, color) {
    ctx.font = '900 13px ' + FONT; const w = ctx.measureText(label).width + 18;
    rrect(x - w / 2, y - 13, w, 26, 13); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
    text(label, x, y + 0.5, 13, '#fff', { lw: 3 });
    return w;
  }
  // Draw something in Player 2's frame (rotated 180° around the screen center).
  function flipped(fn) { ctx.save(); ctx.translate(W, H); ctx.rotate(Math.PI); fn(); ctx.restore(); }
  const flipPt = (x, y) => [W - x, H - y];

  // ---------- HUD ----------
  function drawHudTop() {
    const G = LD.G, s = L.safe, x0 = Math.max(16, s.left + 14), y0 = L.hud.top;
    const meI = LD.me(), me = G.players[meI];
    text(String(me.score), x0, y0 + 20, 32, '#fff', { align: 'left', lw: 6 });
    if (G.mode === 'solo') {
      const best = store.get(LD.bestKey(G.daily), 0);
      text((G.daily ? 'DAILY BEST ' : 'BEST ') + Math.max(best, G.newBest ? me.score : 0), x0 + 2, y0 + 44, 13, '#ffe9a8', { align: 'left', lw: 4 });
    } else {
      chip(x0 + 22, y0 + 46, 'YOU · ' + NAMES[meI], COLORS[meI]);
    }
    iconBtn(L.pause, 'pause'); iconBtn(L.sound, 'sound');
    chip(L.pause.x - 62, y0 + 20, 'HEAT ' + G.level, '#d9480f');
    const bw = W - x0 * 2;
    heatBar(x0, y0 + 60, bw, 14, me.heat);
    if (G.two) { // opponent strip
      const o = G.players[1 - meI], y = y0 + 86;
      text(NAMES[o.id], x0, y, 13, COLORS[o.id], { align: 'left', lw: 4 });
      heatBar(x0 + 30, y - 5, bw - 110, 10, o.alive ? o.heat : 0, false);
      text(o.alive ? String(o.score) : 'OUT', x0 + bw, y, 13, o.alive ? '#fff' : '#ff8787', { align: 'right', lw: 4 });
    }
  }
  // Same-phone: each player's HUD strip at their own edge (drawn in P1's frame; P2 flipped).
  function drawHudSide(i) {
    const G = LD.G, p = G.players[i], s = L.safe, x0 = Math.max(12, s.left + 10), y = L.hud.y;
    chip(x0 + 18, y, NAMES[i], COLORS[i]);
    text(p.alive ? String(p.score) : 'OUT', x0 + 44, y, 22, p.alive ? '#fff' : '#ff8787', { align: 'left', lw: 5 });
    const bx = x0 + 110, bw = W - bx - 64;
    heatBar(bx, y - 7, bw, 14, p.alive ? p.heat : 0);
    iconBtn(L.pause, 'pause');
  }
  function drawPad(pressedMap) {
    for (const k of ['up', 'down', 'left', 'right']) {
      const b = L.pad[k], img = LD.IMG && LD.IMG['btn_' + k], s = L.btn * (pressedMap[k] ? 0.92 : 1);
      if (!img || !img.naturalWidth) continue;
      ctx.save();
      ctx.beginPath(); ctx.ellipse(b.x, b.y + s * 0.47, s * 0.42, s * 0.1, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
      ctx.imageSmoothingEnabled = false; ctx.drawImage(img, b.x - s / 2, b.y - s / 2, s, s);
      ctx.restore();
    }
  }
  function drawFloaters() {
    for (const f of UIst.floaters) {
      const p = LD.renderer.cellToScreen(f.c, f.r, f.h + f.life * 0.9);
      ctx.globalAlpha = Math.max(0, Math.min(1, (0.9 - f.life) * 3)); text(f.text, p.x, p.y, f.size, f.color, { lw: 4 }); ctx.globalAlpha = 1;
    }
  }
  function drawTags() { // P1 / P2 labels over each Olaf in 2-player modes
    const G = LD.G; if (!G.two) return;
    for (const p of G.players) {
      if (!p.alive && p.deathT > 1) continue;
      const a = LD.playerAnim(p), s = LD.renderer.cellToScreen(a.c, a.r, 1.25 + a.hop * 0.4);
      ctx.save(); ctx.globalAlpha = 0.95;
      const lbl = G.mode === 'local' ? NAMES[p.id] : (p.id === LD.me() ? 'YOU' : NAMES[p.id]);
      ctx.font = '900 12px ' + FONT; const w = ctx.measureText(lbl).width + 12;
      rrect(s.x - w / 2, s.y - 10, w, 20, 10); ctx.fillStyle = COLORS[p.id]; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#000'; ctx.stroke();
      text(lbl, s.x, s.y + 0.5, 12, '#fff', { lw: 3 });
      ctx.restore();
    }
  }
  function drawVignette() {
    const G = LD.G; if (!G) return;
    const meH = G.mode === 'local' ? Math.max(...G.players.map(p => p.alive ? p.heat : 0)) : G.players[LD.me()].heat;
    if (meH < 55) return;
    const k = (meH - 55) / 45 * (0.75 + 0.25 * Math.sin(UIst.time * 8));
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(255,40,0,0)'); g.addColorStop(1, 'rgba(255,40,0,' + 0.45 * k + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function drawBanner() {
    const b = UIst.banner; if (!b) return;
    const dur = b.short ? 0.9 : 1.4, k = b.t, s = k < 0.2 ? 0.6 + k * 2 : 1, a = k > dur - 0.4 ? 1 - (k - (dur - 0.4)) / 0.4 : 1;
    const one = (y) => {
      ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.translate(W / 2, y); ctx.scale(s, s);
      text(b.text, 0, 0, b.short ? 64 : 52, b.text.indexOf('HEAT') === 0 ? '#ff922b' : '#fff', { lw: 9 }); ctx.restore();
    };
    if (L.local) { one(L.boardCy + L.board * 0.22); flipped(() => one(L.boardCy + L.board * 0.22)); }
    else one(L.boardCy - L.board * 0.05);
  }
  // Heat look, shared by both renderers: the sky goes sunset orange, then smoky volcanic red.
  LD.drawHeatSky = function (g, k, w, h) {
    if (k <= 0) return;
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(70,10,30,' + 0.75 * k + ')');
    gr.addColorStop(0.35, 'rgba(230,80,30,' + 0.45 * k + ')');
    gr.addColorStop(0.7, 'rgba(255,120,30,' + 0.3 * k + ')');
    gr.addColorStop(1, 'rgba(90,15,0,' + 0.65 * k + ')');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  };
  // Embers drifting up the screen, more of them the hotter it gets.
  const embers = [];
  function drawEmbers(dt) {
    const k = LD.heatK();
    if (k > 0.05 && embers.length < 70 && Math.random() < dt * 30 * k) {
      embers.push({ x: Math.random() * W, y: H + 10, vy: -(40 + Math.random() * 70), ph: Math.random() * 6, s: 1.5 + Math.random() * 2.5, life: 0, max: 3 + Math.random() * 3 });
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i]; e.life += dt; e.y += e.vy * dt; e.x += Math.sin(UIst.time * 2 + e.ph) * 18 * dt;
      if (e.life > e.max || e.y < -10) { embers.splice(i, 1); continue; }
      const a = Math.min(1, e.life * 2) * (1 - e.life / e.max);
      ctx.beginPath(); ctx.arc(e.x, e.y, e.s, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,' + (150 + (e.ph * 15 | 0)) + ',60,' + a + ')'; ctx.fill();
    }
  }
  LD.on('newgame', () => { embers.length = 0; });

  // ---------- screens ----------
  const UI = {};
  let pressedUI = null;
  const pressedPads = [{}, {}];
  function btn(id, x, y, w, h, flip) { UI[id] = { x, y, w, h, flip: !!flip }; return UI[id]; }

  function drawTitle() {
    const cx = W / 2, top = Math.max(L.safe.top, 10) + 6 + Math.max(6, H * 0.03);
    const big = Math.min(72, W * 0.19);
    ctx.save(); ctx.translate(cx, top + 50); ctx.rotate(-0.04);
    text('LAVA', -2, 0, big, '#ffb12b', { lw: 12 });
    text('DODGE', 0, big * 0.9, big, '#ff6b1a', { lw: 12 });
    ctx.restore();
    if (LD.renderer.tag) { ctx.save(); ctx.translate(cx + Math.min(110, W * 0.28), top + 50 + big * 0.9 + 30); ctx.rotate(-0.12); text(LD.renderer.tag, 0, 0, 34, '#fff', { lw: 8, stroke: '#c92a2a' }); ctx.restore(); }
    text('OVERHEAT', cx, top + 50 + big * 0.9 + 44, 22, '#fff', { lw: 6, stroke: '#c92a2a' });
    const bw = Math.min(250, W * 0.62), bh = 54, gap = 68;
    const by = H - Math.max(L.safe.bottom, 10) - 250;
    pill(btn('play', cx, by, bw, bh), 'PLAY', ...BTN.green, pressedUI === 'play');
    pill(btn('daily', cx, by + gap, bw, bh), 'DAILY RUN', ...BTN.cyan, pressedUI === 'daily');
    pill(btn('two', cx, by + gap * 2, bw, bh), '2 PLAYERS', ...BTN.orange, pressedUI === 'two');
    const best = store.get(LD.bestKey(false), 0), dbest = store.get(LD.bestKey(true), 0);
    text('BEST ' + best + (dbest ? '   ·   TODAY ' + dbest : ''), cx, by + gap * 2 + 52, 16, '#fff', { lw: 5 });
    text('Swipe or tap arrows · dodge the cracks · grab ice to stay cool', cx, by + gap * 2 + 80, 12, '#fff', { lw: 4, weight: '700' });
    iconBtn(L.sound, 'sound'); iconBtn(L.help, 'help');
  }
  // First-time instructions (shown before the first game; the ? on the title shows it again).
  function drawHowTo() {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    const pw = Math.min(340, W - 28), ph = 470, px = (W - pw) / 2, py = Math.max(L.safe.top + 6, (H - ph) / 2);
    const k = Math.min(1, (UIst.howT || 0) / 0.25), e = 1 - Math.pow(1 - k, 3);
    ctx.save(); ctx.globalAlpha = k; ctx.translate(0, (1 - e) * 40);
    panel(px, py, pw, ph);
    text('HOW TO PLAY', W / 2, py + 40, 30, '#fff', { lw: 7 });
    const I = LD.IMG || {}, ix = px + 46, tx = px + 88, t = UIst.time;
    const row = (y, drawIcon, l1, l2) => {
      drawIcon(ix, y);
      text(l1, tx, y - 10, 16, '#0b3a4a', { align: 'left', stroke: false });
      text(l2, tx, y + 11, 12.5, '#155e75', { align: 'left', stroke: false, weight: '700' });
    };
    const img = (im, x, y, s) => { if (im && (im.naturalWidth || im.width)) ctx.drawImage(im, x - s / 2, y - s / 2, s, s); };
    row(py + 104, (x, y) => {
      img(I.tile, x, y, 54);
      ctx.globalAlpha = k * (0.6 + 0.4 * Math.sin(t * 8)); img(I.crack, x, y, 54); ctx.globalAlpha = k;
    }, 'Cracked tiles turn to LAVA', 'Hop off before they erupt!');
    row(py + 180, (x, y) => {
      img(I.olaf_sweat || I.olaf_burnt, x, y - 6, 50);
      heatBar(x - 26, y + 20, 52, 9, 60 + 35 * (0.5 + 0.5 * Math.sin(t * 2)), false);
    }, 'Your HEAT keeps rising', 'Faster at higher heat levels. 100% = overheated!');
    row(py + 256, (x, y) => img(I.ice, x, y + Math.sin(t * 4) * 3, 46), 'Grab ICE CUBES to cool down', 'Grab several in a row for bonus points');
    row(py + 332, (x, y) => {
      ctx.save(); ctx.imageSmoothingEnabled = false; img(I.btn_up, x, y - 12, 30); img(I.btn_left, x - 16, y + 12, 30); img(I.btn_right, x + 16, y + 12, 30); ctx.restore();
    }, 'Swipe or tap the arrows', 'Each move hops Olaf one tile');
    pill(btn('gotit', W / 2, py + ph - 48, pw - 90, 56), 'GOT IT!', ...BTN.green, pressedUI === 'gotit');
    ctx.restore();
  }
  function drawMenu2p() {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
    const pw = Math.min(330, W - 30), ph = 440, px = (W - pw) / 2, py = (H - ph) / 2;
    panel(px, py, pw, ph);
    text('2 PLAYERS', W / 2, py + 44, 34, '#fff', { lw: 7 });
    const bw = pw - 60, rows = [
      ['local', 'SAME PHONE', BTN.green, 'Phone flat between you. Last Olaf standing wins.'],
      ['host', 'HOST ONLINE', BTN.orange, 'Get a room code to share with a friend.'],
      ['join', 'JOIN ONLINE', BTN.cyan, 'Enter your friend’s room code.'],
    ];
    rows.forEach(([id, label, col, sub], i) => {
      const y = py + 112 + i * 92;
      pill(btn(id, W / 2, y, bw, 52), label, ...col, pressedUI === id);
      text(sub, W / 2, y + 40, 12, '#155e75', { stroke: false, weight: '700' });
    });
    pill(btn('back', W / 2, py + ph - 34, 140, 40), 'BACK', ...BTN.purple, pressedUI === 'back');
  }
  function drawHosting() {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
    const pw = Math.min(330, W - 30), ph = 330, px = (W - pw) / 2, py = (H - ph) / 2;
    panel(px, py, pw, ph);
    text('ROOM CODE', W / 2, py + 42, 26, '#fff', { lw: 6 });
    if (UIst.code) {
      ctx.save(); rrect(W / 2 - 110, py + 74, 220, 84, 18); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.restore();
      text(UIst.code.split('').join(' '), W / 2, py + 117, 52, '#ff6b1a', { lw: 8 });
    } else {
      const d = Math.floor(UIst.time * 3) % 4; text('.'.repeat(d + 1), W / 2, py + 112, 52, '#1c7ed6', { stroke: false });
    }
    text(UIst.msg, W / 2, py + 186, 14, '#155e75', { stroke: false, weight: '700' });
    if (UIst.tips) drawNetTips(py + 210);
    else {
      text('Your friend taps 2 PLAYERS → JOIN ONLINE', W / 2, py + 214, 12, '#155e75', { stroke: false, weight: '700' });
      text('and types this code.', W / 2, py + 232, 12, '#155e75', { stroke: false, weight: '700' });
    }
    pill(btn('cancel', W / 2, py + ph - 40, 160, 44), 'CANCEL', ...BTN.purple, pressedUI === 'cancel');
  }
  // Shown when the two devices couldn't reach each other directly.
  function drawNetTips(y) {
    [['Brave browser? Turn Shields off for this page', '#c92a2a'], ['Turn off any VPN / iCloud Private Relay', '#155e75'],
     ['Guest, school or work Wi-Fi often blocks this:', '#155e75'], ['try one device on mobile data or a hotspot', '#155e75']]
      .forEach(([t, c], i) => text(t, W / 2, y + i * 18, 12, c, { stroke: false, weight: '700' }));
  }
  function drawJoining() {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
    const pw = Math.min(330, W - 30), ph = UIst.tips ? 400 : 320, px = (W - pw) / 2, py = H / 2 - 140;
    panel(px, py, pw, ph);
    text('JOIN A ROOM', W / 2, py + 40, 26, '#fff', { lw: 6 });
    if (codeInput) codeInput.style.top = (py + 72) + 'px';
    text(UIst.msg || 'Type the 4-letter code', W / 2, py + 170, 14, UIst.msgErr ? '#c92a2a' : '#155e75', { stroke: false, weight: '700' });
    pill(btn('dojoin', W / 2, py + 222, pw - 80, 50), UIst.joinBusy ? 'CONNECTING…' : (UIst.tips ? 'TRY AGAIN' : 'JOIN'), ...BTN.green, pressedUI === 'dojoin');
    if (UIst.tips) drawNetTips(py + 272);
    pill(btn('back', W / 2, py + ph - 34, 140, 40), 'BACK', ...BTN.purple, pressedUI === 'back');
  }
  function drawNetLost() {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    const pw = Math.min(300, W - 40), ph = 190, px = (W - pw) / 2, py = (H - ph) / 2;
    panel(px, py, pw, ph);
    text('DISCONNECTED', W / 2, py + 46, 26, '#fff', { lw: 6 });
    text(UIst.msg, W / 2, py + 90, 14, '#155e75', { stroke: false, weight: '700' });
    pill(btn('menu', W / 2, py + ph - 42, 160, 46), 'MENU', ...BTN.purple, pressedUI === 'menu');
  }

  function drawPlayUI() {
    const G = LD.G;
    drawEmbers(UIst.dt || 0); drawFloaters(); drawTags();
    if (L.local) {
      drawPad(pressedPads[0]); drawHudSide(0);
      flipped(() => { drawPad(pressedPads[1]); drawHudSide(1); });
    } else {
      drawPad(pressedPads[0]); drawHudTop();
    }
    drawVignette(); drawBanner();
    if (UIst.flash > 0) { ctx.fillStyle = 'rgba(255,200,120,' + UIst.flash * 0.35 + ')'; ctx.fillRect(0, 0, W, H); }
    if (G.mode === 'guest' && G.lastSnap && performance.now() - G.lastSnap > 1500 && !G.over) {
      text('Waiting for host…', W / 2, L.boardCy, 22, '#fff', { lw: 6 });
    }
  }
  function drawPaused() {
    drawPlayUI();
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    const online = LD.G.mode === 'host' || LD.G.mode === 'guest';
    const pw = Math.min(300, W - 40), ph = 250, px = (W - pw) / 2, py = (H - ph) / 2;
    panel(px, py, pw, ph);
    text(online ? 'MENU' : 'PAUSED', W / 2, py + 48, 38, '#fff', { lw: 7 });
    if (online) text('The game keeps going!', W / 2, py + 84, 13, '#155e75', { stroke: false, weight: '700' });
    pill(btn('resume', W / 2, py + 130, pw - 70, 54), 'RESUME', ...BTN.green, pressedUI === 'resume');
    pill(btn('quit', W / 2, py + 196, pw - 70, 48), online ? 'LEAVE GAME' : 'MENU', ...BTN.purple, pressedUI === 'quit');
  }
  function drawOverSolo() {
    const G = LD.G, p = G.players[0];
    const k = Math.min(1, UIst.overT / 0.3), e = 1 - Math.pow(1 - k, 3);
    const pw = Math.min(320, W - 36), ph = 400, px = (W - pw) / 2, py = (H - ph) / 2 + (1 - e) * 60;
    ctx.save(); ctx.globalAlpha = k;
    panel(px, py, pw, ph);
    const burnt = LD.IMG && LD.IMG.olaf_burnt;
    if (burnt && burnt.naturalWidth) { ctx.save(); ctx.translate(W / 2, py + 4); ctx.rotate(Math.sin(UIst.time * 3) * 0.05); ctx.drawImage(burnt, -46, -92, 92, 92); ctx.restore(); }
    text(p.cause === 'heat' ? 'OVERHEATED!' : 'TOASTED!', W / 2, py + 34, 30, '#ff6b1a', { lw: 7 });
    text(String(p.score), W / 2, py + 96, 60, '#fff', { lw: 10 });
    if (G.newBest) { const s = 1 + 0.06 * Math.sin(UIst.time * 8); ctx.save(); ctx.translate(W / 2, py + 142); ctx.scale(s, s); text('NEW BEST!', 0, 0, 22, '#ffd43b', { lw: 6 }); ctx.restore(); }
    else text('BEST ' + G.prevBest, W / 2, py + 142, 20, '#1c7ed6', { stroke: false });
    [['Survived', Math.floor(G.t) + 's'], ['Heat level', String(G.level)], ['Ice cubes', String(p.stats.ice)], ['Close calls', String(p.stats.close)]].forEach(([a, b], i) => {
      const y = py + 182 + i * 28;
      text(a, px + 34, y, 17, '#155e75', { align: 'left', stroke: false, weight: '700' });
      text(b, px + pw - 34, y, 18, '#0b3a4a', { align: 'right', stroke: false });
    });
    pill(btn('restart', W / 2, py + ph - 92, pw - 70, 56), 'RESTART', ...BTN.green, pressedUI === 'restart');
    pill(btn('menu', W / 2, py + ph - 30, pw - 120, 40), 'MENU', ...BTN.purple, pressedUI === 'menu');
    if (G.daily) text('Daily run · same waves for everyone today', W / 2, py + ph + 26, 12, '#fff', { lw: 4, weight: '700' });
    ctx.restore();
  }
  // 2-player result panel, drawn from the point of view of player `viewer`.
  function drawOver2p(viewer, cy, flip) {
    const G = LD.G, k = Math.min(1, UIst.overT / 0.3);
    const pw = Math.min(320, W - 36), ph = L.local ? Math.min(310, H / 2 - 40) : 380, px = (W - pw) / 2, py = cy - ph / 2;
    ctx.save(); ctx.globalAlpha = k;
    panel(px, py, pw, ph);
    let title, col;
    if (G.winner === 2) { title = 'DRAW!'; col = '#fff'; }
    else if (G.mode === 'local') { title = NAMES[G.winner] + ' WINS!'; col = COLORS[G.winner]; }
    else { title = G.winner === viewer ? 'YOU WIN!' : 'YOU LOSE!'; col = G.winner === viewer ? '#ffd43b' : '#ff6b6b'; }
    text(title, W / 2, py + 40, 34, col, { lw: 8 });
    // tally
    const ty = py + 86;
    text(NAMES[0], W / 2 - 70, ty, 20, COLORS[0], { lw: 5 }); text(NAMES[1], W / 2 + 70, ty, 20, COLORS[1], { lw: 5 });
    text(LD.tally[0] + '  –  ' + LD.tally[1], W / 2, ty, 28, '#fff', { lw: 6 });
    const rows = [['Score', p => String(p.score)], ['Survived', p => Math.floor(p.tAlive) + 's'], ['Ice cubes', p => String(p.stats.ice)]];
    if (ph > 300) rows.push(['Close calls', p => String(p.stats.close)]);
    rows.forEach(([a, f], i) => {
      const y = py + 124 + i * 24;
      text(f(G.players[0]), W / 2 - 92, y, 16, '#0b3a4a', { stroke: false });
      text(a, W / 2, y, 14, '#155e75', { stroke: false, weight: '700' });
      text(f(G.players[1]), W / 2 + 92, y, 16, '#0b3a4a', { stroke: false });
    });
    const sfx = flip ? '_f' : '';
    const waiting = G.mode === 'guest' && UIst.rematchSent;
    pill(btn('rematch' + sfx, W / 2, py + ph - 84, pw - 70, 50, flip), waiting ? 'WAITING…' : 'REMATCH', ...BTN.green, pressedUI === 'rematch' + sfx);
    pill(btn('menu' + sfx, W / 2, py + ph - 28, pw - 130, 38, flip), 'MENU', ...BTN.purple, pressedUI === 'menu' + sfx);
    ctx.restore();
  }
  function drawOver() {
    drawPlayUI();
    const k = Math.min(1, UIst.overT / 0.3);
    ctx.fillStyle = 'rgba(0,0,0,' + 0.45 * k + ')'; ctx.fillRect(0, 0, W, H);
    const G = LD.G;
    if (!G.two) return drawOverSolo();
    if (L.local) { drawOver2p(0, H * 0.75, false); flipped(() => drawOver2p(1, H * 0.75, true)); }
    else drawOver2p(LD.me(), H / 2, false);
  }
  function drawLoading() {
    ctx.fillStyle = 'rgba(124,199,224,0.9)'; ctx.fillRect(0, 0, W, H);
    text('LAVADODGE' + (LD.renderer.tag ? ' ' + LD.renderer.tag : ''), W / 2, H / 2 - 30, 36, '#ffb12b', { lw: 8 });
    const bw = Math.min(240, W - 80);
    rrect(W / 2 - bw / 2, H / 2 + 10, bw, 14, 7); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
    rrect(W / 2 - bw / 2, H / 2 + 10, bw * Math.min(1, LD.renderer.progress()), 14, 7); ctx.fillStyle = '#ff922b'; ctx.fill();
  }

  // ---------- input ----------
  const inCircle = (x, y, b, pad) => Math.hypot(x - b.x, y - b.y) <= b.r + (pad || 8);
  const inRect = (x, y, b) => b && Math.abs(x - b.x) <= b.w / 2 + 6 && Math.abs(y - b.y) <= b.h / 2 + 6;
  function hitUI(x, y) {
    for (const k in UI) {
      const b = UI[k], [hx, hy] = b.flip ? flipPt(x, y) : [x, y];
      if (inRect(hx, hy, b) && uiActive(k)) return k;
    }
    return null;
  }
  const touches = new Map();
  function padHit(x, y) {
    let best = null, bd = 1e9;
    for (const k in L.pad) { const b = L.pad[k], d = Math.hypot(x - b.x, y - b.y); if (d < L.btn * 0.75 && d < bd) { bd = d; best = k; } }
    return best;
  }
  function move(i, dx, dy) { LD.tryMove(i, dx, dy); }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault(); Audio.unlock();
    const x = e.clientX, y = e.clientY, G = LD.G, sc = UIst.scene;
    if (sc === 'play') {
      if (L.local) {
        // bottom half = P1, top half = P2 (in P2's flipped frame)
        const who = y >= H / 2 ? 0 : 1, [fx, fy] = who ? flipPt(x, y) : [x, y];
        if (inCircle(fx, fy, L.pause)) { UIst.scene = 'paused'; return; }
        const k = padHit(fx, fy);
        if (k) { pressedPads[who][k] = true; const d = L.pad[k].dir; move(who, who ? -d[0] : d[0], who ? -d[1] : d[1]); touches.set(e.pointerId, { pad: k, who }); return; }
        touches.set(e.pointerId, { sx: x, sy: y, who }); return;
      }
      if (inCircle(x, y, L.pause)) { UIst.scene = 'paused'; return; }
      if (inCircle(x, y, L.sound)) { Audio.toggle(); return; }
      const k = padHit(x, y), me = LD.me();
      if (k) { pressedPads[0][k] = true; move(me, L.pad[k].dir[0], L.pad[k].dir[1]); touches.set(e.pointerId, { pad: k, who: 0 }); return; }
      touches.set(e.pointerId, { sx: x, sy: y, who: me }); return;
    }
    if (sc === 'title' && inCircle(x, y, L.sound)) { Audio.toggle(); return; }
    if (sc === 'title' && inCircle(x, y, L.help)) { showHowTo(null); return; }
    pressedUI = hitUI(x, y);
  }, { passive: false });
  canvas.addEventListener('pointermove', e => {
    const t = touches.get(e.pointerId);
    if (!t || t.pad || UIst.scene !== 'play') return;
    const dx = e.clientX - t.sx, dy = e.clientY - t.sy, th = Math.max(18, L.tile * 0.3);
    if (Math.abs(dx) < th && Math.abs(dy) < th) return;
    // swipes are in screen space for everyone: Olaf moves the way the finger moves
    if (Math.abs(dx) > Math.abs(dy)) move(t.who, Math.sign(dx), 0); else move(t.who, 0, Math.sign(dy));
    t.sx = e.clientX; t.sy = e.clientY;
  });
  function endPointer(e) {
    Audio.unlock();
    const t = touches.get(e.pointerId);
    if (t && t.pad) pressedPads[t.who === 1 && L.local ? 1 : 0][t.pad] = false;
    touches.delete(e.pointerId);
    if (pressedUI) { const k = pressedUI; pressedUI = null; if (hitUI(e.clientX, e.clientY) === k) uiAction(k); }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', e => { const t = touches.get(e.pointerId); if (t && t.pad) pressedPads[t.who === 1 && L.local ? 1 : 0][t.pad] = false; touches.delete(e.pointerId); pressedUI = null; });

  function uiActive(k) {
    const sc = UIst.scene, base = k.replace(/_f$/, '');
    if (sc === 'title') return ['play', 'daily', 'two'].includes(k);
    if (sc === 'howto') return k === 'gotit' && UIst.howT > 0.3;
    if (sc === 'menu2p') return ['local', 'host', 'join', 'back'].includes(k);
    if (sc === 'hosting') return k === 'cancel';
    if (sc === 'joining') return k === 'dojoin' || k === 'back';
    if (sc === 'netlost') return k === 'menu';
    if (sc === 'paused') return k === 'resume' || k === 'quit';
    if (sc === 'over') return UIst.overT > 0.4 && (LD.G.two ? ['rematch', 'menu'].includes(base) : ['restart', 'menu'].includes(k));
    return false;
  }
  function showHowTo(next) { UIst.howFrom = UIst.scene; UIst.howNext = next; UIst.howT = 0; UIst.scene = 'howto'; }
  function firstTime(next) { if (store.get('ld_seen_howto', false)) next(); else showHowTo(next); }

  // Auto-update: a new version finished downloading. Reload right away if we're on a menu,
  // otherwise wait until the player is back on the title screen (never mid-run).
  let reloadPending = false;
  const safeToReload = () => ['loading', 'title', 'menu2p', 'howto'].includes(UIst.scene);
  function doReload() { try { sessionStorage.setItem('ld_updated', '1'); } catch (e) {} location.reload(); }
  LD.requestReload = function () { if (safeToReload()) doReload(); else reloadPending = true; };
  try { if (sessionStorage.getItem('ld_updated')) { sessionStorage.removeItem('ld_updated'); setTimeout(() => toast('Updated to the latest version!'), 600); } } catch (e) {}

  function toTitle() {
    if (reloadPending) return doReload();
    for (const k in UI) delete UI[k];
    hideCodeInput(); Audio.stopMusic(); LD.G = null; UIst.scene = 'title'; layout();
    if (LD.renderer.reset) LD.renderer.reset();
  }
  function uiAction(k) {
    const base = k.replace(/_f$/, ''), G = LD.G;
    for (const key in UI) delete UI[key];
    switch (base) {
      case 'play': firstTime(() => startGame('solo')); break;
      case 'daily': firstTime(() => startGame('solo', { daily: true })); break;
      case 'gotit': { store.set('ld_seen_howto', true); const next = UIst.howNext; UIst.howNext = null; UIst.scene = UIst.howFrom || 'title'; if (next) next(); break; }
      case 'two': UIst.scene = 'menu2p'; break;
      case 'local': firstTime(() => { LD.tally = [0, 0]; startGame('local'); }); break;
      case 'host': firstTime(hostOnline); break;
      case 'join': firstTime(() => { UIst.scene = 'joining'; UIst.msg = ''; UIst.joinBusy = false; showCodeInput(); }); break;
      case 'dojoin': if (!UIst.joinBusy) tryJoin(); break;
      case 'back': LD.Net.close(); hideCodeInput(); UIst.scene = UIst.scene === 'joining' ? 'menu2p' : 'title'; break;
      case 'cancel': LD.Net.close(); UIst.scene = 'menu2p'; break;
      case 'resume': UIst.scene = 'play'; break;
      case 'quit': if (G && (G.mode === 'host' || G.mode === 'guest')) leaveOnline(); toTitle(); break;
      case 'restart': startGame('solo', { daily: G.daily }); break;
      case 'rematch':
        if (G.mode === 'local') startGame('local');
        else if (G.mode === 'host') { startGame('host'); LD.Net.send({ ty: 'start' }); }
        else if (G.mode === 'guest') { UIst.rematchSent = true; LD.Net.send({ ty: 'rematch' }); }
        break;
      case 'menu': if (G && (G.mode === 'host' || G.mode === 'guest')) leaveOnline(); toTitle(); break;
    }
  }
  LD.on('newgame', () => { UIst.rematchSent = false; });

  window.addEventListener('keydown', e => {
    if (codeInput && document.activeElement === codeInput) return;
    Audio.unlock();
    const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const wasd = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0] };
    const G = LD.G;
    if (UIst.scene === 'play' && G) {
      const m = arrows[e.key] || wasd[e.key];
      if (m) {
        e.preventDefault(); if (e.repeat) return;
        const who = G.mode === 'local' ? (wasd[e.key] ? 1 : 0) : LD.me();
        move(who, m[0], m[1]); return;
      }
    }
    if ((e.key === ' ' || e.key === 'Enter') && UIst.scene === 'title') startGame('solo');
    else if ((e.key === ' ' || e.key === 'Enter') && UIst.scene === 'over' && UIst.overT > 0.4) uiAction(G.two ? 'rematch' : 'restart');
    else if (e.key === 'Escape' || e.key === 'p') { if (UIst.scene === 'play') UIst.scene = 'paused'; else if (UIst.scene === 'paused') UIst.scene = 'play'; }
  });
  document.addEventListener('visibilitychange', () => {
    const G = LD.G;
    if (document.hidden) {
      if (UIst.scene === 'play' && G && (G.mode === 'solo' || G.mode === 'local')) UIst.scene = 'paused';
      if (Audio.ctx) Audio.ctx.suspend();
    } else if (Audio.ctx) Audio.ctx.resume();
  });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());

  // ---------- main loop ----------
  let last = performance.now(), snapT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    UIst.time += dt; UIst.dt = dt;
    for (let i = UIst.floaters.length - 1; i >= 0; i--) { const f = UIst.floaters[i]; f.life += dt; if (f.life > 0.9) UIst.floaters.splice(i, 1); }
    UIst.shake = Math.max(0, UIst.shake - dt * 30); UIst.flash = Math.max(0, UIst.flash - dt * 2.5);
    if (UIst.banner) { UIst.banner.t += dt; if (UIst.banner.t > (UIst.banner.short ? 0.9 : 1.4)) UIst.banner = null; }
    if (toastT > 0) toastT -= dt;
    const G = LD.G, sc = UIst.scene;
    if (G) {
      const online = G.mode === 'host' || G.mode === 'guest';
      if (sc === 'play' || sc === 'over' || (sc === 'paused' && online)) LD.update(dt);
      if (sc === 'over') UIst.overT += dt;
      if (G.mode === 'host' && LD.Net.conn) { snapT += dt; if (snapT >= 0.05) { snapT = 0; LD.Net.send(LD.snapshot()); } }
    }
    LD.renderer.draw(ctx, sc, dt);
    if (sc === 'loading') drawLoading();
    else if (sc === 'title') drawTitle();
    else if (sc === 'menu2p') drawMenu2p();
    else if (sc === 'howto') { UIst.howT = (UIst.howT || 0) + dt; drawTitle(); drawHowTo(); }
    else if (sc === 'hosting') drawHosting();
    else if (sc === 'joining') drawJoining();
    else if (sc === 'netlost') { if (LD.G) drawPlayUI(); drawNetLost(); }
    else if (sc === 'paused') drawPaused();
    else if (sc === 'over') drawOver();
    else if (G) drawPlayUI();
    if (toastT > 0) {
      ctx.globalAlpha = Math.min(1, toastT); text(toastMsg, W / 2, H - Math.max(L.safe.bottom, 10) - 30, 15, '#fff', { lw: 5 }); ctx.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  }

  LD.start = function () {
    layout();
    LD.renderer.ready.then(() => { UIst.scene = 'title'; });
    requestAnimationFrame(frame);
  };
  LD.ui.text = text; LD.ui.rrect = rrect;
  // test hooks
  LD.test = { startGame, uiAction, get scene() { return UIst.scene; }, set scene(v) { UIst.scene = v; } };
})();
