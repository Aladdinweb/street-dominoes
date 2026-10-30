// Street Dominoes - online server (Cloudflare Workers + Durable Objects + KV) - v1.3.2
// v1.3.2: manual control mode (default), speed settings optional and carried through Quick Match, FCM data keys fixed ("from" is reserved)
// v1.3.1: speed mode (turn timer + auto play/pass), seat reservations for friend invites, presence (hibernating WebSockets), POST /api/invite + /api/push-token (FCM HTTP v1)
// v1.3.0: server-recorded online results (rank points, profile stats), leaderboards (GET /api/leaderboard?scope=daily|weekly|global), match stakes in online rooms/quick match
// WebSocket endpoint:  /ws?room=CODE | /ws?create=1&gm=1v1|2v2&target=100|200|300 | /ws?quick=1&gm=1v1|2v2
// Common params: pid (stable random player id, used for reconnects), name, av
// Profile API (KV binding PLAYER_STATS): GET /api/profile?playerId=usr_xxxxxx | POST /api/match-result (one write per finished match)
// The server owns the canonical game state: it deals, validates every move and only sends each player their own hand.

export const CFG = { GRACE: 30000, TURN: 45000, IDLE: 120000, DEAL: 4300, NEXT: 9000, FILL: 3000, QFILL: 12000, BOT: [800, 500], DRAW: 500, RATE: 30, RTCRATE: 240 };
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


// ---------- Player profiles (Cloudflare KV: PLAYER_STATS) ----------
export const API = { GAP: 3000, DAY_MAX: 150 };
// Ranking: only matches the server saw itself change rank points (never the client-posted ones). Starts at 1000.
export const LB = { WIN: 25, LOSS: -15, BLOCK: 5, BLOCKCAP: 10, MIN: 0, DAY_RATED: 40, MIN_ROUNDS: 2 };
const STAKES = [0, 100, 500, 1000, 5000];
const TURNS = [10, 15, 20, 30];                 // host-selectable turn timers (seconds); 0 = no time limit
const AUTOS = ['manual', 'play', 'pass'];       // what happens when the timer runs out: manual = nothing is forced, play = server plays, pass = you lose the turn
// speed settings are optional: no timer means manual control (the server only steps in after CFG.IDLE of total inactivity so a table never freezes)
function normSpeed(turn, auto) {
  const t = TURNS.includes(+turn) ? +turn : 0;
  return { turn: t, auto: t && AUTOS.includes(auto) ? auto : 'manual' };
}
const TYPES = ['h2h', 'partner', 'tvt'];        // invite match types: 1v1 head-to-head, you + friend vs 2 randoms, you + friend vs 2 friends
const PINGS = ['👋', '🔥', '🎲', '😎', '🤝'];    // "Street Ping" emojis
// reserved seats for invited friends: "2:usr_a,1:usr_b,3:usr_c" (the host keeps seat 0; in 1v1 only seat 2 exists)
function parseRes(str, gm, host) {
  const out = {}, ok = gm === '1v1' ? [2] : [1, 2, 3], seen = new Set([host]);
  for (const part of String(str || '').split(',').slice(0, 3)) {
    const [s, id] = part.split(':');
    if (ok.includes(+s) && validId(id) && !seen.has(id) && !out[+s]) { out[+s] = id; seen.add(id); }
  }
  return out;
}
// free-text quick chat: no links, no control characters / angle brackets, max 60 characters
export const cleanChat = s => String(s || '').replace(/https?:\/\/\S+|www\.\S+/gi, '…').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), n = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - n);
  const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0');
}
const AVATARS = ['😎', '🦁', '🐯', '🦊', '🐼', '🦅', '🐉', '👑', '🎩', '🤠', '🧔', '🥷'];
const TITLES = [[5, 'Street Rookie'], [20, 'Café Player'], [50, 'Table Master'], [100, 'Domino General'], [Infinity, 'Street Legend']];
export const titleOf = w => TITLES.find(t => w <= t[0])[1];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...CORS } });
const validId = id => /^usr_[a-z0-9]{4,20}$/.test(id || '');
const blank = id => ({ playerId: id, name: 'Player', avatar: AVATARS[0], title: titleOf(0), rankPoints: 1000, totalWins: 0, winRate: '0.0%', blockedWins: 0, winStreak: 0, totalMatches: 0 });
const pub = p => { const { lastAt, day, dc, ...rest } = p; return rest; };

// ---------- Voice relay credentials (Cloudflare Realtime TURN) ----------
// Needs the Worker secrets TURN_KEY_ID and TURN_API_TOKEN (Cloudflare dashboard > Realtime > TURN). Credentials are cached for 6 h (they live 24 h).
// Without a relay, WebRTC voice only works when both phones can reach each other directly, which mobile (4G / CGNAT) networks often block.
let turnCache = { at: 0, ice: null };
async function turnApi(env) {
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return json({ error: 'turn_not_configured' }, 503);
  const now = Date.now();
  if (!turnCache.ice || now - turnCache.at > 6 * 36e5) {
    let r; try { r = await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(env.TURN_KEY_ID) + '/credentials/generate-ice-servers', { method: 'POST', headers: { authorization: 'Bearer ' + env.TURN_API_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }) }); } catch (e) { return json({ error: 'turn_upstream' }, 502); }
    if (!r.ok) return json({ error: 'turn_upstream' }, 502);
    const j = await r.json().catch(() => ({})), list = Array.isArray(j.iceServers) ? j.iceServers : (j.iceServers ? [j.iceServers] : []);
    const ice = list.map(s => ({ ...s, urls: [].concat(s.urls || []).filter(u => !/:53(\?|$)/.test(u)) })).filter(s => s.urls.length);   // port 53 is blocked in browsers and only causes timeouts
    if (!ice.length) return json({ error: 'turn_upstream' }, 502);
    turnCache = { at: now, ice };
  }
  return new Response(JSON.stringify({ iceServers: turnCache.ice, ttl: 86400 }), { headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=300', ...CORS } });
}

// ---------- Push notifications (FCM HTTP v1) ----------
// Needs the Worker secret FCM_SERVICE_ACCOUNT = the Firebase service-account JSON (NOT google-services.json). Without it everything still
// works: online friends get invites in-app, offline ones just are not notified.
const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let fcmTok = { tok: '', exp: 0, project: '' };
async function fcmAccess(env) {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  const now = Math.floor(Date.now() / 1000);
  if (fcmTok.tok && fcmTok.exp - 120 > now) return fcmTok;
  let sa; try { sa = JSON.parse(env.FCM_SERVICE_ACCOUNT); } catch (e) { return null; }
  if (!sa || !sa.client_email || !sa.private_key || !sa.project_id) return null;
  try {
    const der = Uint8Array.from(atob(String(sa.private_key).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const enc = new TextEncoder(), part = o => b64u(enc.encode(JSON.stringify(o)));
    const head = part({ alg: 'RS256', typ: 'JWT' }) + '.' + part({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(head)));
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + b64u(sig) });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.access_token) return null;
    fcmTok = { tok: j.access_token, exp: now + ((j.expires_in | 0) || 3000), project: sa.project_id };
    return fcmTok;
  } catch (e) { return null; }
}
async function fcmSend(env, token, msg) {
  const a = await fcmAccess(env);
  if (!a) return 'off';
  try {
    const r = await fetch('https://fcm.googleapis.com/v1/projects/' + a.project + '/messages:send', { method: 'POST',
      headers: { authorization: 'Bearer ' + a.tok, 'content-type': 'application/json' }, body: JSON.stringify({ message: { token, ...msg } }) });
    if (r.ok) return 'ok';
    const t = await r.text().catch(() => '');
    if (r.status === 404 || (r.status === 400 && /registration token/i.test(t))) return 'gone';
    if (r.status === 401) fcmTok.exp = 0;      // access token expired: mint a new one next time
    return 'fail';
  } catch (e) { return 'fail'; }
}
const TYPELBL = { h2h: 'Head-to-Head', partner: 'Teammate', tvt: 'Team vs Team' };
function pushMsg(inv) {
  const ch = { channel_id: 'invites', tag: inv.kind + '-' + inv.from };
  if (inv.kind === 'ping') return { notification: { title: inv.ping + ' ' + inv.name, body: 'wants to play Street Dominoes' }, data: { kind: 'ping', sid: inv.from, name: inv.name, ping: inv.ping }, android: { priority: 'HIGH', ttl: '3600s', notification: ch } };
  const body = (TYPELBL[inv.type] || inv.gm) + (inv.stake ? ' · 🪙 ' + inv.stake : '') + (inv.turn ? ' · ⏱ ' + inv.turn + 's' : '');
  return { notification: { title: '🎲 ' + inv.name + ' invited you', body }, android: { priority: 'HIGH', ttl: '120s', notification: ch },
    data: { kind: 'invite', sid: inv.from, name: inv.name, room: inv.room, gm: inv.gm, type: inv.type || '', stake: String(inv.stake | 0), turn: String(inv.turn | 0) } };
}
// POST /api/invite  {from,name,av,to:[ids],kind:'invite'|'ping', room,gm,type,stake,turn | ping}
// Online friends get it over their presence socket; offline friends with a registered device get an FCM push.
async function inviteApi(req, env) {
  const raw = await req.text();
  if (raw.length > 2048) return json({ error: 'too_large' }, 413);
  let b; try { b = JSON.parse(raw); } catch (e) { return json({ error: 'bad_json' }, 400); }
  if (!b || !validId(b.from) || !Array.isArray(b.to)) return json({ error: 'bad_request' }, 400);
  const to = [...new Set(b.to.filter(validId))].filter(x => x !== b.from).slice(0, 3);
  if (!to.length) return json({ error: 'bad_request' }, 400);
  const kind = b.kind === 'ping' ? 'ping' : 'invite';
  const inv = { kind, from: b.from, name: clean(b.name, 12) || 'Player', av: Math.max(0, Math.min(11, parseInt(b.av) || 0)) };
  if (kind === 'ping') { if (!PINGS.includes(b.ping)) return json({ error: 'bad_ping' }, 400); inv.ping = b.ping; }
  else {
    const room = String(b.room || '').toUpperCase();
    if (!/^[A-Z0-9]{3,8}$/.test(room)) return json({ error: 'bad_room' }, 400);
    Object.assign(inv, { room, gm: b.gm === '1v1' ? '1v1' : '2v2', type: TYPES.includes(b.type) ? b.type : '', stake: STAKES.includes(+b.stake) ? +b.stake : 0, turn: TURNS.includes(+b.turn) ? +b.turn : 0 });
  }
  if (!env.MATCH) return json({ error: 'not_configured' }, 503);
  const pr = await env.MATCH.get(env.MATCH.idFromName('pr')).fetch('https://pr.internal/_pr/invite', { method: 'POST', body: JSON.stringify({ inv, to }) });
  if (!pr.ok) return json({ error: 'presence_unavailable' }, 502);
  const res = await pr.json(), pushed = [], noPush = [];
  for (const id of res.offline || []) {
    const rec = env.PLAYER_STATS ? await env.PLAYER_STATS.get('push:' + id, 'json') : null, tokens = (rec && rec.tokens) || [];
    let okAny = false; const keep = [];
    for (const t of tokens) {
      const r = await fcmSend(env, t, pushMsg(inv));
      if (r === 'ok') okAny = true;
      if (r !== 'gone') keep.push(t);
    }
    if (keep.length !== tokens.length && env.PLAYER_STATS) { if (keep.length) await env.PLAYER_STATS.put('push:' + id, JSON.stringify({ tokens: keep, at: Date.now() }), { expirationTtl: 60 * 864e2 }); else await env.PLAYER_STATS.delete('push:' + id); }
    (okAny ? pushed : noPush).push(id);
  }
  return json({ ok: true, delivered: res.delivered || [], pushed, offline: noPush, limited: res.limited || [], push: !!(await fcmAccess(env)) });
}
// POST /api/push-token {playerId, token, remove?}: the Android app registers its FCM token (max 3 devices per player)
async function pushTokenApi(req, env) {
  const raw = await req.text();
  if (raw.length > 4096) return json({ error: 'too_large' }, 413);
  let b; try { b = JSON.parse(raw); } catch (e) { return json({ error: 'bad_json' }, 400); }
  if (!b || !validId(b.playerId) || !/^[\w:.\-]{20,4000}$/.test(String(b.token || ''))) return json({ error: 'bad_request' }, 400);
  const key = 'push:' + b.playerId, cur = (await env.PLAYER_STATS.get(key, 'json')) || { tokens: [] };
  if (!b.remove && cur.tokens[0] === b.token && Date.now() - (cur.at || 0) < 864e5) return json({ ok: true, n: cur.tokens.length });   // no write needed
  let tokens = cur.tokens.filter(t => t !== b.token);
  if (!b.remove) tokens.unshift(b.token);
  tokens = tokens.slice(0, 3);
  if (tokens.length) await env.PLAYER_STATS.put(key, JSON.stringify({ tokens, at: Date.now() }), { expirationTtl: 60 * 864e2 }); else await env.PLAYER_STATS.delete(key);
  return json({ ok: true, n: tokens.length });
}

async function api(req, env, url) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === '/api/turn' && req.method === 'GET') return turnApi(env);
  if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
    if (!env.MATCH) return json({ error: 'lb_not_configured' }, 503);
    const scope = url.searchParams.get('scope') || 'global', lim = url.searchParams.get('limit') || '50';
    const r = await env.MATCH.get(env.MATCH.idFromName('lb')).fetch('https://lb.internal/_lb/top?scope=' + encodeURIComponent(scope) + '&limit=' + encodeURIComponent(lim));
    return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=15', ...CORS } });
  }
  if (!env.PLAYER_STATS) return json({ error: 'kv_not_configured' }, 503);
  if (url.pathname === '/api/invite' && req.method === 'POST') return inviteApi(req, env);
  if (url.pathname === '/api/push-token' && req.method === 'POST') return pushTokenApi(req, env);
  if (url.pathname === '/api/profile' && req.method === 'GET') {
    const id = url.searchParams.get('playerId');
    if (!validId(id)) return json({ error: 'bad_id' }, 400);
    const p = await env.PLAYER_STATS.get('profile:' + id, 'json');
    return json({ exists: !!p, profile: pub(p || blank(id)) });
  }
  if (url.pathname === '/api/match-result' && req.method === 'POST') {
    const raw = await req.text();
    if (raw.length > 2048) return json({ error: 'too_large' }, 413);
    let b; try { b = JSON.parse(raw); } catch (e) { return json({ error: 'bad_json' }, 400); }
    if (!b || !validId(b.playerId) || (b.result !== 'win' && b.result !== 'loss')) return json({ error: 'bad_request' }, 400);
    if (b.mode === 'online') {   // the room already recorded this match (stats + rank); counting the client report again would double it
      const q = await env.PLAYER_STATS.get('profile:' + b.playerId, 'json');
      return json({ ok: true, skipped: 'recorded_by_server', profile: pub(q || blank(b.playerId)) });
    }
    const bw = b.blockedWins === undefined ? 0 : b.blockedWins;
    if (!Number.isInteger(bw) || bw < 0 || bw > 14) return json({ error: 'bad_request' }, 400);
    const key = 'profile:' + b.playerId, now = Date.now();
    const p = (await env.PLAYER_STATS.get(key, 'json')) || blank(b.playerId);
    if (p.lastAt && now - p.lastAt < API.GAP) return json({ error: 'rate_limited' }, 429);
    const day = new Date(now).toISOString().slice(0, 10);
    if (p.day !== day) { p.day = day; p.dc = 0; }
    if ((p.dc || 0) >= API.DAY_MAX) return json({ error: 'daily_limit' }, 429);
    p.dc = (p.dc || 0) + 1; p.lastAt = now;
    p.name = clean(b.name, 12) || p.name;
    p.avatar = AVATARS.includes(b.avatar) ? b.avatar : p.avatar;
    p.totalMatches++;
    if (b.result === 'win') { p.totalWins++; p.winStreak++; } else p.winStreak = 0;
    p.blockedWins += bw;
    p.winRate = (100 * p.totalWins / p.totalMatches).toFixed(1) + '%';
    p.title = titleOf(p.totalWins);
    await env.PLAYER_STATS.put(key, JSON.stringify(p));     // the only KV write: once per finished match
    return json({ ok: true, profile: pub(p) });
  }
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return api(req, env, url);
    if (url.pathname === '/' || url.pathname === '/health')
      return new Response('Street Dominoes server OK', { headers: { 'content-type': 'text/plain', ...CORS } });
    if (url.pathname !== '/ws') return new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    if (url.searchParams.get('quick')) return env.MATCH.get(env.MATCH.idFromName('mm')).fetch(req);
    if (url.searchParams.get('presence')) return env.MATCH.get(env.MATCH.idFromName('pr')).fetch(req);
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
    this.env = env; this.recMid = -1; this.bw = [0, 0, 0, 0]; this.rkres = null;
    this.cfg = null; this.code = ''; this.seats = [null, null, null, null]; this.phase = 'lobby'; this.timers = {};
    this.init();
  }
  init() {
    this.score = [0, 0]; this.mid = 0; this.rid = 0; this.fxn = 0; this.nextStart = null;
    this.hands = [[], [], [], []]; this.yard = []; this.chain = []; this.ci = 0; this.cur = 0; this.over = -1;
    this.wt = -1; this.blocked = false; this.gain = 0; this.passes = 0; this.dealing = false; this.fx = null;
    this.final = false; this.fo = -1; this.ps = null; this.psn = 0;
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
      this.cfg = { gm: q.get('gm') === '1v1' ? '1v1' : '2v2', target: [100, 200, 300].includes(+q.get('target')) ? +q.get('target') : 200, fill: q.get('fill') === '1', host: pid, stake: STAKES.includes(+q.get('stake')) ? +q.get('stake') : 0,
        ...normSpeed(q.get('turn'), q.get('auto')), type: TYPES.includes(q.get('type')) ? q.get('type') : '',
        seek: q.get('seek') === '1', res: parseRes(q.get('res'), q.get('gm') === '1v1' ? '1v1' : '2v2', pid) };
    }
    this.attach(ws, pid, clean(q.get('name'), 12) || 'Player', Math.max(0, Math.min(11, parseInt(q.get('av')) || 0)));
    if (this.cfg.seek && !this.seekSent) { this.seekSent = true; this.seek(); }   // "You + Friend vs 2 randoms": ask the matchmaker for two random opponents
    return res();
  }
  err(ws, m) { send(ws, { t: 'err', m }); try { ws.close(1000, m); } catch (e) {} }

  // two players with the same name in one room get a number so the table (and the HUD) can tell them apart; the profile / leaderboard name is untouched
  uniqueName(name) {
    const taken = new Set(this.seats.filter(Boolean).map(s => String(s.dn || s.name).toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; n < 10; n++) { const c = name.slice(0, 10) + ' ' + n; if (!taken.has(c.toLowerCase())) return c; }
    return name;
  }
  // invited friends sit in their reserved seat; everybody else only takes seats nobody reserved
  seatFor(pid) {
    const res = this.cfg.res || {};
    const mine = this.act.find(i => res[i] === pid && !this.seats[i]);
    if (mine !== undefined) return mine;
    return this.act.find(i => !this.seats[i] && !res[i]);
  }
  async seek() {
    const env = this.env;
    if (!env || !env.MATCH) return;
    try { await env.MATCH.get(env.MATCH.idFromName('mm')).fetch('https://mm.internal/_mm/seek', { method: 'POST', body: JSON.stringify({ room: this.code, stake: this.cfg.stake | 0, turn: this.cfg.turn | 0, auto: this.cfg.auto, need: 2 }) }); } catch (e) {}
  }
  cancelSeek() {
    const env = this.env;
    if (!this.seekSent || !env || !env.MATCH) return;
    this.seekSent = false;
    try { env.MATCH.get(env.MATCH.idFromName('mm')).fetch('https://mm.internal/_mm/cancel', { method: 'POST', body: JSON.stringify({ room: this.code }) }).catch(() => {}); } catch (e) {}
  }
  // a human acted: clears the timeout streak
  human(p) { const s = this.seats[p]; if (s && !s.bot) { s.to = 0; s.auto = false; } }
  attach(ws, pid, name, av) {
    let p = this.seats.findIndex(s => s && s.pid === pid);
    if (p >= 0) {
      const s = this.seats[p];
      if (s.bot) return this.err(ws, 'forfeit');
      if (s.ws && s.ws !== ws) { try { s.ws.close(1000, 'replaced'); } catch (e) {} }
      s.ws = ws; s.off = 0; this.clear('off' + p);
    } else {
      if (this.phase !== 'lobby') return this.err(ws, 'started');
      p = this.seatFor(pid);
      if (p === undefined) return this.err(ws, 'full');
      this.seats[p] = { pid, name, dn: this.uniqueName(name), av, bot: false, ws, off: 0, rm: false };
    }
    ws.addEventListener('message', e => this.onMsg(p, ws, e.data));
    ws.addEventListener('close', () => this.onClose(p, ws));
    ws.addEventListener('error', () => this.onClose(p, ws));
    if (this.phase === 'lobby') this.lobby(); else this.broadcast();
    send(ws, { t: 'vcs', v: this.voiceNow() });
  }

  lobby() {
    const filled = this.act.every(i => this.seats[i]), host = this.hostSeat();
    const wait = Object.keys(this.cfg.res || {}).map(Number).filter(k => !this.seats[k]);   // invited friends who have not arrived yet
    this.seats.forEach((s, p) => {
      if (s && s.ws) send(s.ws, { t: 'olobby', room: this.code, gm: this.cfg.gm, target: this.cfg.target, stake: this.cfg.stake | 0, turn: this.cfg.turn | 0, auto: this.cfg.auto, type: this.cfg.type || '', wait, host: p === host, you: p,
        seats: this.act.map(i => { const x = this.seats[i]; return x ? { n: x.dn || x.name, a: x.av, b: x.bot ? 1 : 0 } : null; }) });
    });
    if (filled) this.after('start', 1500, () => this.startNow()); else this.clear('start');
    if (this.cfg.fill && !this.timers.fill) this.after('fill', CFG.FILL, () => this.startNow());
    if (this.cfg.seek && !wait.length && !filled && !this.timers.sfill) this.after('sfill', CFG.QFILL, () => this.startNow());   // friend is here, randoms did not show up: bots take the seats
  }

  onMsg(p, ws, raw) {
    const s = this.seats[p];
    if (!s || s.ws !== ws) return;
    const now = Date.now(), rtc = typeof raw === 'string' && raw.startsWith('{"t":"rtc"');   // ICE bursts get their own, larger bucket
    const kw = rtc ? 'rw' : 'w', kc = rtc ? 'rc' : 'c';
    if (!s[kw] || now - s[kw] > 1000) { s[kw] = now; s[kc] = 0; }
    if (++s[kc] > (rtc ? CFG.RTCRATE : CFG.RATE)) { try { ws.close(1008, 'rate'); } catch (e) {} return; }
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
        else if (m.k === 'txt' && typeof m.x === 'string' && (!s.rx || now - s.rx > 1500)) { const x = cleanChat(m.x); if (x) { s.rx = now; this.bcast({ t: 'rx', p, k: 'txt', x }); } }
        break;
      case 'rematch':
        if (this.phase === 'over' && this.final) {
          s.rm = true;
          if (this.act.every(i => this.seats[i] && (this.seats[i].rm || this.seats[i].bot))) this.newMatch();
        }
        break;
      case 'vc': s.vc = !!m.on; s.vm = !!m.m && s.vc; this.voiceList(); break;
      case 'rtc': this.relay(p, m); break;
      case 'leave': this.leave(p); break;
    }
  }

  onClose(p, ws) {
    const s = this.seats[p];
    if (!s || s.ws !== ws) return;
    s.ws = null;
    if (s.vc) { s.vc = false; s.vm = false; this.voiceList(); }
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
    s.bot = true; s.fn = true; s.off = 0; s.vc = false; s.vm = false; this.clear('off' + p);
    const w = s.ws; s.ws = null; try { w && w.close(1000, 'left'); } catch (e) {}
    if (gm === '1v1' && !(this.phase === 'over' && this.final)) {
      const o = this.act.find(i => i !== p), wt = tm(gm, o);
      ['turn', 'bot', 'next', 'deal'].forEach(k => this.clear(k));
      this.score[wt] = Math.max(this.score[wt], this.cfg.target);
      this.over = o; this.wt = wt; this.blocked = false; this.gain = 0; this.fo = p; this.final = true;
      this.phase = 'over'; this.dealing = false; this.fx = null;
      this.broadcast();
      this.recordMatch();
    } else {
      this.broadcast();
      if (this.phase === 'play' && this.cur === p) this.schedule();
    }
    if (!this.humans()) this.dispose();
  }

  startNow() {
    this.clear('start'); this.clear('fill'); this.clear('sfill'); this.cancelSeek();
    for (const i of this.act)
      if (!this.seats[i]) this.seats[i] = { pid: 'bot' + i, name: 'Player ' + (i + 1), av: 0, bot: true, ws: null, off: 0, rm: true };
    this.newMatch();
  }
  newMatch() {
    this.score = [0, 0]; this.nextStart = null; this.mid++; this.final = false; this.fo = -1; this.bw = [0, 0, 0, 0]; this.rkres = null;
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
    const auto = !!(this.seats[bp] && this.seats[bp].bot);          // bots open automatically, humans choose their own opening stone
    const f = auto ? this.hands[bp].splice(bi, 1)[0] : null;
    this.chain = auto ? [{ a: f[0], b: f[1] }] : []; this.ci = 0; this.cur = bp; this.over = -1; this.passes = 0; this.blocked = false;
    this.wt = -1; this.gain = 0; this.rid++; this.dealing = true; this.phase = 'dealing'; this.fx = null;
    this.broadcast();
    this.after('deal', CFG.DEAL, () => {
      this.dealing = false; this.phase = 'play';
      if (auto) { this.fx = { p: bp, idx: 0, id: ++this.fxn, dbl: f[0] === f[1] }; this.next(); }
      else { this.fx = null; this.broadcast(); this.schedule(); }
    });
  }
  next() {
    const a = this.act;
    this.cur = a[(a.indexOf(this.cur) + 1) % a.length];
    this.broadcast(); this.schedule();
  }
  schedule() {
    this.clear('turn'); this.clear('bot'); this.turnEnds = 0;
    const s = this.seats[this.cur];
    if (!s) return;
    if (s.bot) this.after('bot', CFG.BOT[0] + rnd(CFG.BOT[1]), () => this.botStep());
    else { const ms = this.turnMs(); this.turnEnds = Date.now() + ms; this.after('turn', ms, () => this.timeout()); }   // human: timer (host-selected in speed mode)
  }

  timed() { return (this.cfg.turn | 0) > 0 && this.cfg.auto !== 'manual'; }          // is a speed timer in force?
  turnMs() { return this.timed() ? this.cfg.turn * 1000 : CFG.IDLE; }                // no timer: only the inactivity safety net
  // A human's turn timer ran out. "play": the server plays for them (bot logic). "pass": they lose the turn when they could have played
  // (nothing to play: draw / pass as usual). 3 timeouts in a row switch that seat to auto-play so the table never stalls.
  timeout() {
    this.clear('turn');
    const p = this.cur, s = this.seats[p];
    if (!s || !this.turnOk(p)) return;
    if (s.bot || !this.timed() || this.cfg.auto !== 'pass' || s.auto) return this.botStep();   // no timer (manual): this is the 2-minute inactivity safety net
    s.to = (s.to || 0) + 1;
    if (s.to >= 3) s.auto = true;
    if (!this.playable(p).length) return this.botStep();
    this.passes = 0;                                   // a skipped turn must not count towards a blocked table
    this.ps = { p, id: ++this.psn };
    this.next();
  }
  ends() { return this.chain.length ? [this.chain[0].a, this.chain[this.chain.length - 1].b] : [-1, -1]; }
  canL(t) { if (!this.chain.length) return true; const e = this.ends()[0]; return t[0] === e || t[1] === e; }
  canR(t) { if (!this.chain.length) return true; const e = this.ends()[1]; return t[0] === e || t[1] === e; }
  playable(p) { return this.hands[p].map((_, i) => i).filter(i => this.canL(this.hands[p][i]) || this.canR(this.hands[p][i])); }
  yardLeft() { return this.yard.filter(Boolean).length; }
  turnOk(p) { return this.phase === 'play' && !this.dealing && this.over < 0 && p === this.cur; }
  tsum(k) { return TP(this.cfg.gm, k).reduce((s, q) => s + sum(this.hands[q]), 0); }

  play(p, i, side) {
    if (!this.turnOk(p) || !Number.isInteger(i) || i < 0 || !this.hands[p][i] || (side !== 'L' && side !== 'R')) return;
    const t = this.hands[p][i];
    if (side === 'L' ? !this.canL(t) : !this.canR(t)) return;
    this.human(p);
    this.place(p, i, side);
  }
  place(p, i, side) {
    const t = this.hands[p].splice(i, 1)[0], [L, R] = this.ends();
    if (!this.chain.length) { this.chain = [{ a: t[0], b: t[1] }]; this.ci = 0; side = 'R'; }
    else if (side === 'R') this.chain.push(t[0] === R ? { a: t[0], b: t[1] } : { a: t[1], b: t[0] });
    else { this.chain.unshift(t[1] === L ? { a: t[0], b: t[1] } : { a: t[1], b: t[0] }); this.ci++; }
    this.fx = { p, idx: side === 'R' ? this.chain.length - 1 : 0, id: ++this.fxn, dbl: t[0] === t[1] };
    this.passes = 0;
    if (!this.hands[p].length) return this.endRound(p, false);
    this.next();
  }
  draw(p, i) {
    if (this.cfg.gm !== '1v1' || !this.turnOk(p) || this.playable(p).length || !Number.isInteger(i) || !this.yard[i]) return;
    this.human(p);
    this.hands[p].push(this.yard[i]); this.yard[i] = null;
    this.broadcast(); this.schedule();
  }
  pass(p) {
    if (!this.turnOk(p) || this.playable(p).length || this.yardLeft()) return;
    this.human(p);
    this.doPass();
  }
  doPass() {
    this.ps = { p: this.cur, id: ++this.psn };
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
    if (blocked && this.wt >= 0) TP(gm, this.wt).forEach(q => { const s = this.seats[q]; if (s && !s.bot) this.bw[q] = (this.bw[q] || 0) + 1; });
    this.final = this.score[0] >= this.cfg.target || this.score[1] >= this.cfg.target;
    this.broadcast();
    if (this.final) this.recordMatch();
    if (!this.final) this.after('next', CFG.NEXT, () => this.startRound());
  }

  // Authoritative result of a finished online match: profile stats always, rank points + leaderboards only for "rated" matches
  // (>= 2 human players; a 1v1 forfeit only counts after LB.MIN_ROUNDS rounds). Players who forfeited always get the loss.
  recordMatch() {
    if (this.recMid === this.mid) return;
    this.recMid = this.mid;
    this.doRecord().catch(() => {});
  }
  async doRecord() {
    const env = this.env, gm = this.cfg.gm;
    if (!env || !env.PLAYER_STATS) return;
    const mt = this.fo >= 0 ? this.wt : (this.score[0] >= this.score[1] ? 0 : 1);
    const rows = this.act.map(p => ({ p, s: this.seats[p] })).filter(x => x.s && (!x.s.bot || x.s.fn) && validId(x.s.pid))
      .map(({ p, s }) => ({ p, s, id: s.pid, win: tm(gm, p) === mt && !s.fn, bw: Math.min(14, this.bw[p] || 0) }));
    if (!rows.length) return;
    const rated = rows.length >= 2 && (this.fo < 0 || this.rid >= LB.MIN_ROUNDS);
    const profs = await Promise.all(rows.map(r => env.PLAYER_STATS.get('profile:' + r.id, 'json')));
    let res = {};
    if (rated && env.MATCH) {
      const entries = rows.map((r, i) => ({ id: r.id, name: clean(r.s.name, 12), avatar: AVATARS[r.s.av] || AVATARS[0], base: (profs[i] && profs[i].rankPoints) || 1000, win: r.win,
        delta: r.win ? LB.WIN + Math.min(LB.BLOCKCAP, LB.BLOCK * r.bw) : LB.LOSS }));
      try {
        const rr = await env.MATCH.get(env.MATCH.idFromName('lb')).fetch('https://lb.internal/_lb/record', { method: 'POST', body: JSON.stringify({ entries }) });
        if (rr.ok) res = (await rr.json()).res || {};
      } catch (e) {}
    }
    const rk = {};
    await Promise.all(rows.map(async (r, i) => {
      const p = profs[i] || blank(r.id), o = res[r.id];
      p.name = clean(r.s.name, 12) || p.name;
      p.avatar = AVATARS[r.s.av] || p.avatar;
      p.totalMatches++;
      if (r.win) { p.totalWins++; p.winStreak++; } else p.winStreak = 0;
      p.blockedWins += r.bw;
      p.winRate = (100 * p.totalWins / p.totalMatches).toFixed(1) + '%';
      p.title = titleOf(p.totalWins);
      if (o) p.rankPoints = o.rp;
      rk[r.p] = { d: o && o.applied ? o.delta : 0, rp: p.rankPoints, rated: !!o };
      try { await env.PLAYER_STATS.put('profile:' + r.id, JSON.stringify(p)); } catch (e) {}
    }));
    this.rkres = rk;
    this.broadcast();   // send the rank change to the players' result screens
  }

  view(p) {
    const act = this.act, now = Date.now();
    return {
      t: 'state', you: p, room: this.code, act,
      seat: [0, 1, 2, 3].map(i => (!act.includes(i) ? 0 : this.seats[i] && this.seats[i].bot ? 2 : i === p ? 1 : 3)),
      names: [0, 1, 2, 3].map(i => { const s = this.seats[i]; return s && (!s.bot || s.fn) ? s.dn || s.name : 'Player ' + (i + 1); }),
      avs: [0, 1, 2, 3].map(i => (this.seats[i] ? this.seats[i].av : i)),
      wt: this.wt, gm: this.cfg.gm, stake: this.cfg.stake | 0, mid: this.mid, yd: this.yard.map(y => (y ? 1 : 0)), dealing: this.dealing, fx: this.fx,
      hands: this.hands.map((h, i) => (this.over >= 0 || i === p ? h : h.map(() => 0))),
      chain: this.chain, ci: this.ci, cur: this.cur, ps: this.ps, over: this.over, score: this.score, blocked: this.blocked, gain: this.gain,
      target: this.cfg.target, rid: this.rid, fo: this.fo, rk: this.rkres && this.rkres[p] ? this.rkres[p] : null,
      pids: [0, 1, 2, 3].map(i => { const x = this.seats[i]; return x && (!x.bot || x.fn) && validId(x.pid) ? x.pid : null; }),
      tl: this.timed() && this.timers.turn && this.turnEnds ? Math.max(0, this.turnEnds - now) : 0, tt: this.turnMs(), turn: this.cfg.turn | 0, auto: this.cfg.auto,
      off: this.seats.map((s, i) => (s && !s.bot && s.off ? { p: i, s: Math.max(0, Math.ceil((s.off - now) / 1000)) } : null)).filter(Boolean),
    };
  }
  broadcast() {
    if (this.phase === 'lobby') return this.lobby();
    this.seats.forEach((s, p) => { if (s && s.ws) send(s.ws, this.view(p)); });
  }
  voiceNow() { return this.seats.map((s, p) => (s && !s.bot && s.vc ? { p, m: s.vm ? 1 : 0 } : null)).filter(Boolean); }
  voiceList() { this.bcast({ t: 'vcs', v: this.voiceNow() }); }
  // WebRTC signalling relay: audio itself flows peer-to-peer, the server only forwards small SDP / ICE messages between players in voice
  relay(p, m) {
    const s = this.seats[p], to = m.to, t = Number.isInteger(to) ? this.seats[to] : null;
    if (!s || !s.vc || !t || !t.vc || !t.ws || to === p) return;
    if (m.k !== 'offer' && m.k !== 'answer' && m.k !== 'ice') return;
    const d = m.d;
    if (!d || typeof d !== 'object') return;
    let n; try { n = JSON.stringify(d).length; } catch (e) { return; }
    if (n > (m.k === 'ice' ? 1200 : 9000)) return;
    if (m.k === 'ice') { if (typeof d.candidate !== 'string') return; }
    else if (typeof d.sdp !== 'string' || d.type !== m.k) return;
    send(t.ws, { t: 'rtc', from: p, k: m.k, d });
  }
  bcast(o) { this.seats.forEach(s => { if (s && s.ws) send(s.ws, o); }); }
}

export class Matchmaker {
  constructor(state, env) { this.state = state; this.q = []; this.iv = null; this.reqs = []; }
  async fetch(req) {
    const lbu = new URL(req.url);
    if (lbu.pathname.startsWith('/_lb/')) return this.lbFetch(req, lbu);
    if (lbu.pathname.startsWith('/_pr/')) return this.prFetch(req, lbu);       // presence + invite delivery (instance 'pr')
    if (lbu.pathname.startsWith('/_mm/')) return this.mmFetch(req, lbu);       // rooms asking for random opponents (instance 'mm')
    if (lbu.searchParams.get('presence')) return this.presenceAccept(req);
       // leaderboard store: a separate instance of this class, reached only from inside the Worker
    const q = new URL(req.url).searchParams;
    const pair = new WebSocketPair(), client = pair[0], ws = pair[1];
    ws.accept();
    const e = { ws, gm: q.get('gm') === '1v1' ? '1v1' : '2v2', stake: STAKES.includes(+q.get('stake')) ? +q.get('stake') : 0, ...normSpeed(q.get('turn'), q.get('auto')), since: Date.now() };
    this.q.push(e);
    const drop = () => { this.q = this.q.filter(x => x !== e); this.idle(); };
    ws.addEventListener('close', drop);
    ws.addEventListener('error', drop);
    ws.addEventListener('message', m => { try { if (JSON.parse(m.data).t === 'cancel') { drop(); ws.close(1000, 'cancel'); } } catch (x) {} });
    if (!this.iv) this.iv = setInterval(() => this.tick(), 1000);
    this.tick();
    return new Response(null, { status: 101, webSocket: client });
  }
  // ---- leaderboard store (instance idFromName('lb') of this class). Plain Durable Object storage, so no wrangler.toml change is needed.
  async lbLoad() {
    if (!this.lbReady) this.lbReady = (async () => {
      this.lb = new Map();
      const all = await this.state.storage.list({ prefix: 'p:' });
      for (const [k, v] of all) this.lb.set(k.slice(2), v);
    })();
    return this.lbReady;
  }
  async lbFetch(req, u) {
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
    if (!this.state || !this.state.storage) return J({ error: 'lb_unavailable' }, 503);
    await this.lbLoad();
    const now = new Date(), dk = now.toISOString().slice(0, 10), wk = isoWeek(now);
    if (u.pathname === '/_lb/record' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch (e) { return J({ error: 'bad_json' }, 400); }
      const list = Array.isArray(b && b.entries) ? b.entries.slice(0, 4) : [], out = {}, batch = {};
      for (const e of list) {
        if (!e || !validId(e.id)) continue;
        let r = this.lb.get(e.id);
        if (!r) r = { id: e.id, rp: Math.max(LB.MIN, Math.min(100000, (e.base | 0) || 1000)), w: 0, m: 0, dk: '', dp: 0, dw: 0, dn: 0, wk: '', wp: 0, ww: 0 };
        if (r.dk !== dk) { r.dk = dk; r.dp = 0; r.dw = 0; r.dn = 0; }
        if (r.wk !== wk) { r.wk = wk; r.wp = 0; r.ww = 0; }
        const applied = r.dn < LB.DAY_RATED, delta = applied ? Math.max(-50, Math.min(60, e.delta | 0)) : 0;
        r.name = clean(e.name, 12) || r.name || 'Player';
        r.avatar = AVATARS.includes(e.avatar) ? e.avatar : r.avatar || AVATARS[0];
        r.m++; r.dn++;
        if (applied) { r.rp = Math.max(LB.MIN, r.rp + delta); r.dp += delta; r.wp += delta; if (e.win) { r.w++; r.dw++; r.ww++; } }
        this.lb.set(e.id, r); batch['p:' + e.id] = r; out[e.id] = { rp: r.rp, applied, delta };
      }
      if (Object.keys(batch).length) await this.state.storage.put(batch);
      this.lbCache = {};
      return J({ ok: true, res: out });
    }
    if (u.pathname === '/_lb/top') {
      const scope = u.searchParams.get('scope'), lim = Math.max(1, Math.min(100, parseInt(u.searchParams.get('limit')) || 50));
      if (!['daily', 'weekly', 'global'].includes(scope)) return J({ error: 'bad_scope' }, 400);
      const ck = scope + lim, c = this.lbCache && this.lbCache[ck];
      if (c && Date.now() - c.t < 15000) return J(c.v);
      const all = [...this.lb.values()], row = (r, rp, w) => ({ playerId: r.id, name: r.name, avatar: r.avatar, rankPoints: rp, wins: w, matches: r.m });
      let rows;
      if (scope === 'global') rows = all.filter(r => r.m > 0).sort((a, b) => b.rp - a.rp || b.w - a.w).map(r => row(r, r.rp, r.w));
      else {
        const [kd, kp, kw, kv] = scope === 'daily' ? ['dk', 'dp', 'dw', dk] : ['wk', 'wp', 'ww', wk];
        rows = all.filter(r => r[kd] === kv && (r[kw] > 0 || r[kp] > 0)).sort((a, b) => b[kp] - a[kp] || b[kw] - a[kw]).map(r => row(r, Math.max(0, r[kp]), r[kw]));
      }
      const v = { scope, entries: rows.slice(0, lim), updated: Date.now() };
      (this.lbCache = this.lbCache || {})[ck] = { t: Date.now(), v };
      return J(v);
    }
    return J({ error: 'not_found' }, 404);
  }
  // ---- rooms that were created with friends and still need random opponents ("You + Friend vs 2 randoms")
  seekTick() {
    const now = Date.now();
    this.reqs = this.reqs.filter(r => now - r.since < 90000);
    for (const r of [...this.reqs]) {
      const l = this.q.filter(e => e.gm === '2v2' && e.stake === r.stake && (e.turn | 0) === (r.turn | 0) && (e.auto || 'manual') === (r.auto || 'manual'));
      if (l.length >= r.need) { this.reqs = this.reqs.filter(x => x !== r); this.match(l.slice(0, r.need), '2v2', false, r.stake, r.room, { turn: r.turn, auto: r.auto }); }
    }
  }
  async mmFetch(req, u) {
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
    let b; try { b = await req.json(); } catch (e) { return J({ error: 'bad_json' }, 400); }
    const room = String((b && b.room) || '');
    if (!/^[A-Z0-9]{3,8}$/.test(room)) return J({ error: 'bad_room' }, 400);
    if (u.pathname === '/_mm/seek') {
      this.reqs = this.reqs.filter(r => r.room !== room);
      this.reqs.push({ room, ...normSpeed(b.turn, b.auto), stake: STAKES.includes(b.stake | 0) ? b.stake | 0 : 0, need: Math.max(1, Math.min(2, b.need | 0 || 2)), since: Date.now() });
      this.tick();
      return J({ ok: true });
    }
    if (u.pathname === '/_mm/cancel') { this.reqs = this.reqs.filter(r => r.room !== room); return J({ ok: true }); }
    return J({ error: 'not_found' }, 404);
  }
  // ---- presence + invite delivery (instance idFromName('pr')). Hibernatable WebSockets: idle connections cost nothing; state lives in the sockets' attachments.
  presenceAccept(req) {
    const id = clean(new URL(req.url).searchParams.get('pid'), 24), pair = new WebSocketPair(), client = pair[0], ws = pair[1];
    const live = this.state.getWebSockets();
    if (!validId(id) || live.length >= 3000 || live.filter(s => (s.deserializeAttachment() || {}).id === id).length >= 3) {
      ws.accept(); send(ws, { t: 'err', m: 'bad' }); try { ws.close(1000, 'bad'); } catch (e) {}
      return new Response(null, { status: 101, webSocket: client });
    }
    this.state.acceptWebSocket(ws);
    ws.serializeAttachment({ id, st: 1, w: [] });
    try { this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch (e) {}
    this.presNotify(id);
    return new Response(null, { status: 101, webSocket: client });
  }
  presStatus(id, except) {          // 0 offline, 1 online, 2 in a game (best of all the player's sockets)
    let st = 0;
    for (const s of this.state.getWebSockets()) { if (s === except) continue; const a = s.deserializeAttachment(); if (a && a.id === id) st = Math.max(st, a.st | 0); }
    return st;
  }
  presNotify(id, except) {
    const st = this.presStatus(id, except);
    for (const s of this.state.getWebSockets()) { if (s === except) continue; const a = s.deserializeAttachment(); if (a && a.id !== id && a.w && a.w.includes(id)) send(s, { t: 'pres', id, s: st }); }
  }
  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 2000) return;
    let m; try { m = JSON.parse(msg); } catch (e) { return; }
    const a = ws.deserializeAttachment();
    if (!a || !m) return;
    if (m.t === 'st') { a.st = m.s === 2 ? 2 : 1; ws.serializeAttachment(a); this.presNotify(a.id); }
    else if (m.t === 'watch') {
      a.w = (Array.isArray(m.ids) ? m.ids : []).filter(validId).slice(0, 40); ws.serializeAttachment(a);
      const all = {}; for (const x of a.w) all[x] = this.presStatus(x);
      send(ws, { t: 'pres', all });
    }
  }
  webSocketClose(ws) { const a = ws.deserializeAttachment(); try { ws.close(1000, 'bye'); } catch (e) {} if (a) this.presNotify(a.id, ws); }
  webSocketError(ws) { const a = ws.deserializeAttachment(); if (a) this.presNotify(a.id, ws); }
  async prFetch(req, u) {
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.pathname !== '/_pr/invite' || req.method !== 'POST') return J({ error: 'not_found' }, 404);
    let b; try { b = await req.json(); } catch (e) { return J({ error: 'bad_json' }, 400); }
    const inv = b && b.inv, to = Array.isArray(b && b.to) ? b.to.slice(0, 3) : [];
    if (!inv || !validId(inv.from)) return J({ error: 'bad_request' }, 400);
    const now = Date.now(); this.rl = this.rl || new Map();
    for (const [k, v] of this.rl) if (now - v.t > 600000) this.rl.delete(k);
    let sw = this.rl.get('s:' + inv.from);                      // at most 20 invites / pings per sender per 10 minutes
    if (!sw) { sw = { t: now, n: 0 }; this.rl.set('s:' + inv.from, sw); }
    const out = { delivered: [], offline: [], limited: [] };
    for (const id of to) {
      if (!validId(id)) continue;
      const pk = 'p:' + inv.from + ':' + id + ':' + inv.kind, last = this.rl.get(pk) || { t: 0 };
      if (sw.n >= 20 || now - last.t < (inv.kind === 'ping' ? 60000 : 20000)) { out.limited.push(id); continue; }
      sw.n++; this.rl.set(pk, { t: now });
      const socks = this.state.getWebSockets().filter(s => { const a = s.deserializeAttachment(); return a && a.id === id; });
      if (socks.length) { socks.forEach(s => send(s, { t: 'inv', ...inv })); out.delivered.push(id); } else out.offline.push(id);
    }
    return J(out);
  }
  idle() { if (!this.q.length && this.iv) { clearInterval(this.iv); this.iv = null; } }
  tick() {
    this.seekTick();
    const sk = e => e.gm + '|' + e.stake + '|' + (e.turn | 0) + '|' + (e.auto || 'manual');
    for (const k of new Set(this.q.map(sk))) {   // players are only matched with others who chose the same game mode, entry fee and speed settings
      const [gm, st, tu, au] = k.split('|'), need = gm === '1v1' ? 2 : 4, stake = +st, sp = { turn: +tu, auto: au }, l = this.q.filter(e => sk(e) === k);
      if (l.length >= need) this.match(l.slice(0, need), gm, false, stake, '', sp);
      else if (l.length && Date.now() - l[0].since >= CFG.QFILL) this.match(l, gm, true, stake, '', sp);   // fill the table with bots
      else l.forEach(e => send(e.ws, { t: 'queue', n: l.length, need }));
    }
  }
  match(grp, gm, fill, stake = 0, forRoom = '', sp = {}) {
    const room = forRoom || code();
    grp.forEach(e => {
      this.q = this.q.filter(x => x !== e);
      send(e.ws, { t: 'matched', room, gm, fill: fill ? 1 : 0, stake, turn: sp.turn | 0, auto: sp.auto || 'manual' });
      try { e.ws.close(1000, 'matched'); } catch (x) {}
    });
    this.idle();
  }
}
