/* LavaDodge online play: two phones, one hosts a room with a 4-letter code.
 * Transport: PeerJS (WebRTC data channel, free public broker for the handshake).
 * Add ?net=bc to the URL to use a BroadcastChannel between two tabs instead (testing).
 */
(function () {
  'use strict';
  const LD = window.LD = window.LD || {};
  const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O
  const PREFIX = 'lavadodge-v1-';
  const useBC = /[?&]net=bc\b/.test(location.search);

  // Relay fallback: a small Cloudflare Worker (see turn-worker/) hands out short-lived TURN
  // credentials, so a match can be relayed when the two devices can't connect directly.
  const TURN_URL = LD.turnUrl || '';
  let icePromise = null, iceAt = 0;
  function getIceServers() {
    const base = PEER_OPTS.config.iceServers;
    if (!TURN_URL) return Promise.resolve(base);
    if (icePromise && performance.now() - iceAt < 60 * 60 * 1000) return icePromise; // reuse for an hour
    iceAt = performance.now();
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 4000);
    icePromise = fetch(TURN_URL, { signal: ctl && ctl.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('turn ' + r.status)))
      .then(d => base.concat(d.iceServers || []))
      .catch(() => { icePromise = null; return base; })
      .finally(() => clearTimeout(timer));
    return icePromise;
  }
  const peerOpts = ice => Object.assign({}, PEER_OPTS, { config: { iceServers: ice } });

  // Watch a PeerJS connection's WebRTC link; call onFail if the two devices can't reach each other.
  function watchIce(conn, onFail, ms) {
    const t0 = performance.now();
    const iv = setInterval(() => {
      const pc = conn.peerConnection, st = pc && (pc.iceConnectionState || pc.connectionState);
      if (conn.open) { clearInterval(iv); return; }
      if (st === 'failed' || performance.now() - t0 > ms) { clearInterval(iv); onFail(st || 'timeout'); }
    }, 250);
    return iv;
  }
  function randomCode() { let s = ''; for (let i = 0; i < 4; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)]; return s; }

  let peerLib = null;
  function loadPeer() {
    if (window.Peer) return Promise.resolve(window.Peer);
    if (peerLib) return peerLib;
    peerLib = new Promise((ok, bad) => {
      const s = document.createElement('script');
      s.src = (LD.sharedPath || '../shared/') + 'peerjs.min.js';
      s.onload = () => (window.Peer ? ok(window.Peer) : bad(new Error('PeerJS failed to load')));
      s.onerror = () => { peerLib = null; bad(new Error('No internet connection')); };
      document.head.appendChild(s);
    });
    return peerLib;
  }
  const PEER_OPTS = {
    debug: 1,
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] },
  };

  // BroadcastChannel stand-in with the same tiny surface as a PeerJS DataConnection.
  function bcConn(code, role) {
    const ch = new BroadcastChannel('ld-' + code), h = {};
    const c = {
      open: false,
      on(n, f) { (h[n] = h[n] || []).push(f); },
      fire(n, a) { (h[n] || []).forEach(f => f(a)); },
      send(o) { ch.postMessage({ from: role, o }); },
      close() { ch.postMessage({ from: role, bye: 1 }); ch.close(); c.fire('close'); },
    };
    ch.onmessage = e => {
      const d = e.data; if (d.from === role) return;
      if (d.hello && !c.open) { c.open = true; ch.postMessage({ from: role, hello: 1 }); c.fire('open'); return; }
      if (d.bye) { c.fire('close'); return; }
      if (d.o) c.fire('data', d.o);
    };
    return { c, ch };
  }

  const Net = LD.Net = {
    role: null, code: '', conn: null, peer: null, lastRx: 0, cb: {},
    status: '',
    host(cb) {
      this.close(); this.cb = cb || {}; this.role = 'host';
      const tryCode = (attempt) => {
        this.code = randomCode();
        this.status = 'Creating room…';
        if (useBC) {
          const { c, ch } = bcConn(this.code, 'host'); this._bc = ch;
          this.status = 'waiting'; this.cb.onCode && this.cb.onCode(this.code);
          c.on('open', () => this._attach(c));
          return;
        }
        Promise.all([loadPeer(), getIceServers()]).then(([Peer, ice]) => {
          const peer = new Peer(PREFIX + this.code, peerOpts(ice)); this.peer = peer;
          peer.on('open', () => { this.status = 'waiting'; this.cb.onCode && this.cb.onCode(this.code); });
          peer.on('connection', conn => {
            if (this.conn) { conn.on('open', () => { conn.send({ ty: 'full' }); setTimeout(() => conn.close(), 300); }); return; }
            this.cb.onStatus && this.cb.onStatus('Friend found! Linking devices…');
            conn.on('open', () => this._attach(conn));
            watchIce(conn, () => {
              try { conn.close(); } catch (e) {}
              this.cb.onStatus && this.cb.onStatus('Couldn\u2019t link to your friend\u2019s device', true);
            }, 20000);
          });
          peer.on('error', err => {
            if (err.type === 'unavailable-id' && attempt < 4) { peer.destroy(); tryCode(attempt + 1); return; }
            this._fail(err);
          });
          peer.on('disconnected', () => { if (!this.conn && this.peer === peer) peer.reconnect(); });
        }).catch(e => this._fail(e));
      };
      tryCode(0);
    },
    join(code, cb) {
      this.close(); this.cb = cb || {}; this.role = 'guest'; this.code = code.toUpperCase();
      this.status = 'Connecting…';
      if (useBC) {
        const { c, ch } = bcConn(this.code, 'guest'); this._bc = ch;
        c.on('open', () => this._attach(c));
        ch.postMessage({ from: 'guest', hello: 1 });
        this._joinTimer = setTimeout(() => { if (!this.conn) this._fail({ type: 'peer-unavailable' }); }, 4000);
        return;
      }
      Promise.all([loadPeer(), getIceServers()]).then(([Peer, ice]) => {
        const peer = new Peer(peerOpts(ice)); this.peer = peer;
        peer.on('open', () => {
          const conn = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
          conn.on('open', () => this._attach(conn));
          // the broker answers "peer-unavailable" within a couple of seconds if the code is wrong
          this._foundTimer = setTimeout(() => { if (!this.conn && this.cb.onStatus) this.cb.onStatus('Room found! Linking devices…'); }, 2500);
          this._ice = watchIce(conn, () => { if (!this.conn) this._fail({ type: 'ice' }); }, 20000);
        });
        peer.on('error', err => this._fail(err));
      }).catch(e => this._fail(e));
    },
    _attach(conn) {
      clearTimeout(this._joinTimer);
      this.conn = conn; this.status = 'connected'; this.lastRx = performance.now();
      conn.on('data', d => {
        this.lastRx = performance.now();
        if (d && d.ty === 'full') { this._fail({ type: 'full' }); return; }
        if (d && d.ty === 'ping') return;
        this.cb.onMsg && this.cb.onMsg(d);
      });
      conn.on('close', () => this._lost());
      conn.on('error', () => this._lost());
      clearInterval(this._ping);
      this._ping = setInterval(() => {
        this.send({ ty: 'ping' });
        if (performance.now() - this.lastRx > 6000) this._lost();
      }, 1000);
      this.cb.onOpen && this.cb.onOpen();
    },
    send(o) { if (this.conn) try { this.conn.send(o); } catch (e) { /* channel closing */ } },
    _lost() {
      if (!this.conn) return;
      const cb = this.cb; this.close();
      cb.onClose && cb.onClose();
    },
    _fail(err) {
      const msg = {
        'peer-unavailable': 'No room with that code', 'timeout': 'Could not connect. Try again', 'ice': 'Couldn\u2019t link the two devices', 'full': 'That room is full',
        'network': 'No internet connection', 'server-error': 'Connection server is busy. Try again', 'browser-incompatible': 'This browser cannot play online',
      }[err && err.type] || (err && err.message) || 'Connection failed';
      const cb = this.cb; this.close();
      cb.onError && cb.onError(msg);
    },
    close() {
      clearTimeout(this._joinTimer); clearTimeout(this._foundTimer); clearInterval(this._ice); clearInterval(this._ping);
      const conn = this.conn, peer = this.peer, bc = this._bc;
      this.conn = null; this.peer = null; this._bc = null; this.role = null; this.status = ''; this.cb = {};
      try { if (conn) conn.close(); } catch (e) {}
      try { if (peer) peer.destroy(); } catch (e) {}
      try { if (bc) bc.close(); } catch (e) {}
    },
  };
})();
