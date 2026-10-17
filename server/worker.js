// Street Dominoes - online server (Cloudflare Workers + Durable Objects) - v1.1.2
// WebSocket endpoint:  /ws?room=CODE | /ws?create=1&gm=1v1|2v2&target=100|200|300 | /ws?quick=1&gm=1v1|2v2
// Common params: pid (stable random player id, used for reconnects), name, av
// The server owns the canonical game state: it deals, validates every move and only sends each player their own hand.

export const CFG = { GRACE: 30000, TURN: 45000, DEAL: 4300, NEXT: 9000, FILL: 3000, QFILL: 12000, BOT: [800, 500], DRAW: 500, RATE: 30 };
const EMO = ['🤣', '😱', '😎', '👏', '😡', '🔥', '😭', '🤝'];
const PHR = ['خفلة!', 'العب بسرعة!', 'ضربة معلّم!', 'برافو!', 'يا سلام!', 'استنى شوية!'];
const ORDER = { '2v2': [0, 1, 2, 3], '1v1': [0, 2] };
const tm = (gm, p) => (gm === '1v1' ? (p === 2 ? 1 : 0) : p % 2);
const TP = (gm, k) => (gm === '1v1' ? [k ? 2 : 0] : [k, k + 2]);
const sum = a => a.reduce((s, x) => s + x[0] + x[1], 0);
const rnd = n => (Math.random() * n) | 0;
const clean = (s, n) => String(s || '').replace(/[^\w\u0600-\u06FF \-.]/g, '').trim().slice(0, n);
const send = (ws, o) => { try { ws.send(JSON.stringify(o)); } catch (e) {} };
function code() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 5; i++) c += A[rnd(A.length)]; return c; }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/health')
      return new Response('Street Dominoes server OK', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname !== '/ws') return new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    if (url.searchParams.get('quick')) return env.MATCH.get(env.MATCH.idFromName('mm')).fetch(req);
    let room = (url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!room) {
      if (!url.searchParams.get('create')) return new Response('room required', { status: 400 });
      room = code();
    }
    url.searchParams.set('room', room);
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(new Request(url, req));
  },
};

export class GameRoom {
  constructor(state, env) {
    this.cfg = null; this.code = ''; this.seats = [null, null, null, null]; this.phase = 'lobby'; this.timers = {};
    this.init();
  }
  init() {
    this.score = [0, 0]; this.mid = 0; this.rid = 0; this.fxn = 0; this.nextStart = null;
    this.hands = [[], [], [], []]; this.yard = []; this.chain = []; this.ci = 0; this.cur = 0; this.over = -1;
    this.wt = -1; this.blocked = false; this.gain = 0; this.passes = 0; this.dealing = false; this.fx = null;
    this.final = false; this.fo = -1;
  }
  get act() { return ORDER[this.cfg.gm]; }
  clear(k) { clearTimeout(this.timers[k]); delete this.timers[k]; }
  after(k, ms, f) { this.clear(k); this.timers[k] = setTimeout(f, ms); }
  dispose() { Object.keys(this.timers).forEach(k => this.clear(k)); }
  humans() { return this.seats.some(s => s && !s.bot && (s.ws || s.off)); }
  hostSeat() {
    let p = this.seats.findIndex(s => s && !s.bot && s.pid === this.cfg.host);
    if (p < 0) p = this.seats.findIndex(s => s && !s.bot);
    return p;
  }

  async fetch(req) {
    const q = new URL(req.url).searchParams;
    const pair = new WebSocketPair(), client = pair[0], ws = pair[1];
    ws.accept();
    const res = () => new Response(null, { status: 101, webSocket: client });
    const pid = clean(q.get('pid'), 24);
    if (!pid) { this.err(ws, 'bad'); return res(); }
    if (!this.cfg) {
      if (!q.get('create') && !q.get('gm')) { this.err(ws, 'noroom'); return res(); }
      this.code = (q.get('room') || '').slice(0, 8);
      this.cfg = { gm: q.get('gm') === '1v1' ? '1v1' : '2v2', target: [100, 200, 300].includes(+q.get('target')) ? +q.get('target') : 200, fill: q.get('fill') === '1', host: pid };
    }
    this.attach(ws, pid, clean(q.get('name'), 12) || 'Player', Math.max(0, Math.min(11, parseInt(q.get('av')) || 0)));
    return res();
  }
  err(ws, m) { send(ws, { t: 'err', m }); try { ws.close(1000, m); } catch (e) {} }

  attach(ws, pid, name, av) {
    let p = this.seats.findIndex(s => s && s.pid === pid);
    if (p >= 0) {
      const s = this.seats[p];
      if (s.bot) return this.err(ws, 'forfeit');
      if (s.ws && s.ws !== ws) { try { s.ws.close(1000, 'replaced'); } catch (e) {} }
      s.ws = ws; s.off = 0; this.clear('off' + p);
    } else {
      if (this.phase !== 'lobby') return this.err(ws, 'started');
      p = this.act.find(i => !this.seats[i]);
      if (p === undefined) return this.err(ws, 'full');
      this.seats[p] = { pid, name, av, bot: false, ws, off: 0, rm: false };
    }
    ws.addEventListener('message', e => this.onMsg(p, ws, e.data));
    ws.addEventListener('close', () => this.onClose(p, ws));
    ws.addEventListener('error', () => this.onClose(p, ws));
    if (this.phase === 'lobby') this.lobby(); else this.broadcast();
  }

  lobby() {
    const filled = this.act.every(i => this.seats[i]), host = this.hostSeat();
    this.seats.forEach((s, p) => {
      if (s && s.ws) send(s.ws, { t: 'olobby', room: this.code, gm: this.cfg.gm, target: this.cfg.target, host: p === host, you: p,
        seats: this.act.map(i => { const x = this.seats[i]; return x ? { n: x.name, a: x.av, b: x.bot ? 1 : 0 } : null; }) });
    });
    if (filled) this.after('start', 1500, () => this.startNow()); else this.clear('start');
    if (this.cfg.fill && !this.timers.fill) this.after('fill', CFG.FILL, () => this.startNow());
  }

  onMsg(p, ws, raw) {
    const s = this.seats[p];
    if (!s || s.ws !== ws) return;
    const now = Date.now();
    if (!s.w || now - s.w > 1000) { s.w = now; s.c = 0; }
    if (++s.c > CFG.RATE) { try { ws.close(1008, 'rate'); } catch (e) {} return; }
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'ping': send(ws, { t: 'pong' }); break;
      case 'start': if (this.phase === 'lobby' && p === this.hostSeat()) this.startNow(); break;
      case 'play': this.play(p, m.i, m.side); break;
      case 'draw': this.draw(p, m.i); break;
      case 'pass': this.pass(p); break;
      case 'rx':
        if ((EMO.includes(m.k) || PHR.includes(m.k)) && (!s.rx || now - s.rx > 900)) { s.rx = now; this.bcast({ t: 'rx', p, k: m.k }); }
        break;
      case 'rematch':
        if (this.phase === 'over' && this.final) {
          s.rm = true;
          if (this.act.every(i => this.seats[i] && (this.seats[i].rm || this.seats[i].bot))) this.newMatch();
        }
        break;
      case 'leave': this.leave(p); break;
    }
  }

  onClose(p, ws) {
    const s = this.seats[p];
    if (!s || s.ws !== ws) return;
    s.ws = null;
    if (this.phase === 'lobby') {
      this.seats[p] = null;
      if (!this.humans()) { this.dispose(); return; }
      this.lobby(); return;
    }
    if (s.bot) return;
    s.off = Date.now() + CFG.GRACE;           // 30 s grace period to reconnect with the same pid
    this.after('off' + p, CFG.GRACE, () => this.forfeit(p));
    if (!this.humans()) { /* everybody gone: timers will forfeit and dispose */ }
    this.broadcast();
  }

  leave(p) {
    const s = this.seats[p];
    if (!s) return;
    if (this.phase === 'lobby') {
      const w = s.ws; this.seats[p] = null;
      try { w && w.close(1000, 'left'); } catch (e) {}
      if (!this.humans()) { this.dispose(); return; }
      this.lobby(); return;
    }
    this.forfeit(p);
  }

  forfeit(p) {
    const s = this.seats[p];
    if (!s || s.bot) return;
    const gm = this.cfg.gm;
    s.bot = true; s.fn = true; s.off = 0; this.clear('off' + p);
    const w = s.ws; s.ws = null; try { w && w.close(1000, 'left'); } catch (e) {}
    if (gm === '1v1' && !(this.phase === 'over' && this.final)) {
      const o = this.act.find(i => i !== p), wt = tm(gm, o);
      ['turn', 'bot', 'next', 'deal'].forEach(k => this.clear(k));
      this.score[wt] = Math.max(this.score[wt], this.cfg.target);
      this.over = o; this.wt = wt; this.blocked = false; this.gain = 0; this.fo = p; this.final = true;
      this.phase = 'over'; this.dealing = false; this.fx = null;
      this.broadcast();
    } else {
      this.broadcast();
      if (this.phase === 'play' && this.cur === p) this.schedule();
    }
    if (!this.humans()) this.dispose();
  }

  startNow() {
    this.clear('start'); this.clear('fill');
    for (const i of this.act)
      if (!this.seats[i]) this.seats[i] = { pid: 'bot' + i, name: 'Player ' + (i + 1), av: 0, bot: true, ws: null, off: 0, rm: true };
    this.newMatch();
  }
  newMatch() {
    this.score = [0, 0]; this.nextStart = null; this.mid++; this.final = false; this.fo = -1;
    this.seats.forEach(s => { if (s) s.rm = s.bot; });
    this.startRound();
  }

  startRound() {
    const act = this.act, all = [];
    for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) all.push([a, b]);
    for (let i = all.length - 1; i > 0; i--) { const j = rnd(i + 1); [all[i], all[j]] = [all[j], all[i]]; }
    this.hands = [[], [], [], []];
    act.forEach(p => { this.hands[p] = all.splice(0, 7); });
    this.yard = act.length === 2 ? all.splice(0) : [];
    const score = t => (t[0] === t[1] ? 100 : 0) + t[0] + t[1];
    let bp = -1, bi = -1, bs = -1;
    act.forEach(p => this.hands[p].forEach((t, i) => { if (score(t) > bs) { bs = score(t); bp = p; bi = i; } }));
    if (this.nextStart != null && act.includes(this.nextStart)) {
      bp = this.nextStart; bi = 0; bs = -1;
      this.hands[bp].forEach((t, i) => { if (score(t) > bs) { bs = score(t); bi = i; } });
    }
    const f = this.hands[bp].splice(bi, 1)[0];
    this.chain = [{ a: f[0], b: f[1] }]; this.ci = 0; this.cur = bp; this.over = -1; this.passes = 0; this.blocked = false;
    this.wt = -1; this.gain = 0; this.rid++; this.dealing = true; this.phase = 'dealing'; this.fx = null;
    this.broadcast();
    this.after('deal', CFG.DEAL, () => {
      this.dealing = false; this.phase = 'play';
      this.fx = { p: bp, idx: 0, id: ++this.fxn, dbl: f[0] === f[1] };
      this.next();
    });
  }
  next() {
    const a = this.act;
    this.cur = a[(a.indexOf(this.cur) + 1) % a.length];
    this.broadcast(); this.schedule();
  }
  schedule() {
    this.clear('turn'); this.clear('bot');
    const s = this.seats[this.cur];
    if (!s) return;
    if (s.bot) this.after('bot', CFG.BOT[0] + rnd(CFG.BOT[1]), () => this.botStep());
    else this.after('turn', CFG.TURN, () => this.botStep());       // AFK human: auto-play so the table never stalls
  }

  ends() { return [this.chain[0].a, this.chain[this.chain.length - 1].b]; }
  canL(t) { const e = this.ends()[0]; return t[0] === e || t[1] === e; }
  canR(t) { const e = this.ends()[1]; return t[0] === e || t[1] === e; }
  playable(p) { return this.hands[p].map((_, i) => i).filter(i => this.canL(this.hands[p][i]) || this.canR(this.hands[p][i])); }
  yardLeft() { return this.yard.filter(Boolean).length; }
  turnOk(p) { return this.phase === 'play' && !this.dealing && this.over < 0 && p === this.cur; }
  tsum(k) { return TP(this.cfg.gm, k).reduce((s, q) => s + sum(this.hands[q]), 0); }

  play(p, i, side) {
    if (!this.turnOk(p) || !Number.isInteger(i) || i < 0 || !this.hands[p][i] || (side !== 'L' && side !== 'R')) return;
    const t = this.hands[p][i];
    if (side === 'L' ? !this.canL(t) : !this.canR(t)) return;
    this.place(p, i, side);
  }
  place(p, i, side) {
    const t = this.hands[p].splice(i, 1)[0], [L, R] = this.ends();
    if (side === 'R') this.chain.push(t[0] === R ? { a: t[0], b: t[1] } : { a: t[1], b: t[0] });
    else { this.chain.unshift(t[1] === L ? { a: t[0], b: t[1] } : { a: t[1], b: t[0] }); this.ci++; }
    this.fx = { p, idx: side === 'R' ? this.chain.length - 1 : 0, id: ++this.fxn, dbl: t[0] === t[1] };
    this.passes = 0;
    if (!this.hands[p].length) return this.endRound(p, false);
    this.next();
  }
  draw(p, i) {
    if (this.cfg.gm !== '1v1' || !this.turnOk(p) || this.playable(p).length || !Number.isInteger(i) || !this.yard[i]) return;
    this.hands[p].push(this.yard[i]); this.yard[i] = null;
    this.broadcast(); this.schedule();
  }
  pass(p) {
    if (!this.turnOk(p) || this.playable(p).length || this.yardLeft()) return;
    this.doPass();
  }
  doPass() {
    this.passes++;
    if (this.passes >= this.act.length) return this.endRound(null, true);
    this.next();
  }
  botStep() {
    const p = this.cur;
    if (!this.turnOk(p)) return;
    const pl = this.playable(p);
    if (pl.length) {
      let bi = pl[0], bs = -1;
      pl.forEach(i => { const t = this.hands[p][i], s = (t[0] === t[1] ? 20 : 0) + t[0] + t[1]; if (s > bs) { bs = s; bi = i; } });
      const t = this.hands[p][bi], l = this.canL(t), r = this.canR(t);
      return this.place(p, bi, l && r ? (rnd(2) ? 'L' : 'R') : r ? 'R' : 'L');
    }
    const fr = this.yard.map((y, i) => (y ? i : -1)).filter(i => i >= 0);
    if (fr.length) {
      const i = fr[rnd(fr.length)];
      this.hands[p].push(this.yard[i]); this.yard[i] = null; this.broadcast();
      return this.after('bot', CFG.DRAW, () => this.botStep());
    }
    this.doPass();
  }

  endRound(p, blocked) {
    const gm = this.cfg.gm;
    this.clear('turn'); this.clear('bot');
    if (!blocked) {
      this.wt = tm(gm, p); this.gain = this.tsum(1 - this.wt); this.score[this.wt] += this.gain; this.nextStart = p; this.over = p;
    } else {
      const A = this.tsum(0), B = this.tsum(1);
      this.wt = A < B ? 0 : B < A ? 1 : -1;
      this.gain = this.wt < 0 ? 0 : this.wt === 0 ? B : A;
      if (this.wt >= 0) this.score[this.wt] += this.gain;
      this.nextStart = this.wt < 0 ? null : TP(gm, this.wt).reduce((a, q) => (sum(this.hands[q]) < sum(this.hands[a]) ? q : a), TP(gm, this.wt)[0]);
      this.over = this.cur;
    }
    this.blocked = blocked; this.phase = 'over';
    this.final = this.score[0] >= this.cfg.target || this.score[1] >= this.cfg.target;
    this.broadcast();
    if (!this.final) this.after('next', CFG.NEXT, () => this.startRound());
  }

  view(p) {
    const act = this.act, now = Date.now();
    return {
      t: 'state', you: p, room: this.code, act,
      seat: [0, 1, 2, 3].map(i => (!act.includes(i) ? 0 : this.seats[i] && this.seats[i].bot ? 2 : i === p ? 1 : 3)),
      names: [0, 1, 2, 3].map(i => { const s = this.seats[i]; return s && (!s.bot || s.fn) ? s.name : 'Player ' + (i + 1); }),
      avs: [0, 1, 2, 3].map(i => (this.seats[i] ? this.seats[i].av : i)),
      wt: this.wt, gm: this.cfg.gm, stake: 0, mid: this.mid, yd: this.yard.map(y => (y ? 1 : 0)), dealing: this.dealing, fx: this.fx,
      hands: this.hands.map((h, i) => (this.over >= 0 || i === p ? h : h.map(() => 0))),
      chain: this.chain, ci: this.ci, cur: this.cur, over: this.over, score: this.score, blocked: this.blocked, gain: this.gain,
      target: this.cfg.target, rid: this.rid, fo: this.fo,
      off: this.seats.map((s, i) => (s && !s.bot && s.off ? { p: i, s: Math.max(0, Math.ceil((s.off - now) / 1000)) } : null)).filter(Boolean),
    };
  }
  broadcast() {
    if (this.phase === 'lobby') return this.lobby();
    this.seats.forEach((s, p) => { if (s && s.ws) send(s.ws, this.view(p)); });
  }
  bcast(o) { this.seats.forEach(s => { if (s && s.ws) send(s.ws, o); }); }
}

export class Matchmaker {
  constructor(state, env) { this.q = []; this.iv = null; }
  async fetch(req) {
    const q = new URL(req.url).searchParams;
    const pair = new WebSocketPair(), client = pair[0], ws = pair[1];
    ws.accept();
    const e = { ws, gm: q.get('gm') === '1v1' ? '1v1' : '2v2', since: Date.now() };
    this.q.push(e);
    const drop = () => { this.q = this.q.filter(x => x !== e); this.idle(); };
    ws.addEventListener('close', drop);
    ws.addEventListener('error', drop);
    ws.addEventListener('message', m => { try { if (JSON.parse(m.data).t === 'cancel') { drop(); ws.close(1000, 'cancel'); } } catch (x) {} });
    if (!this.iv) this.iv = setInterval(() => this.tick(), 1000);
    this.tick();
    return new Response(null, { status: 101, webSocket: client });
  }
  idle() { if (!this.q.length && this.iv) { clearInterval(this.iv); this.iv = null; } }
  tick() {
    for (const gm of ['1v1', '2v2']) {
      const need = gm === '1v1' ? 2 : 4, l = this.q.filter(e => e.gm === gm);
      if (l.length >= need) this.match(l.slice(0, need), gm, false);
      else if (l.length && Date.now() - l[0].since >= CFG.QFILL) this.match(l, gm, true);   // fill the table with bots
      else l.forEach(e => send(e.ws, { t: 'queue', n: l.length, need }));
    }
  }
  match(grp, gm, fill) {
    const room = code();
    grp.forEach(e => {
      this.q = this.q.filter(x => x !== e);
      send(e.ws, { t: 'matched', room, gm, fill: fill ? 1 : 0 });
      try { e.ws.close(1000, 'matched'); } catch (x) {}
    });
    this.idle();
  }
}
