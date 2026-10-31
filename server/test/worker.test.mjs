import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
// Regression suite for server/src/worker.js (real GameRoom / Matchmaker code, fake KV + Durable Object storage). Run: node server/test/worker.test.mjs
const here = path.dirname(fileURLToPath(import.meta.url)), tmp = path.join(process.env.TMPDIR || os.tmpdir(), 'sd-worker-under-test.mjs');
fs.copyFileSync(process.env.WORKER_SRC || path.join(here, '../src/worker.js'), tmp);
const W = await import(pathToFileURL(tmp).href);
const { GameRoom, Matchmaker, CFG, LB, isoWeek } = W; const api = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = []; const ok = (n, v) => R.push((v ? 'PASS ' : 'FAIL ') + n);
CFG.DEAL = 1; CFG.NEXT = 1; CFG.BOT = [1, 1]; CFG.DRAW = 1; CFG.TURN = 600000; CFG.IDLE = 600000; CFG.GRACE = 600000;
// ---- fakes
const kv = new Map(); let puts = 0; const PLAYER_STATS = { get: async (k, t) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => { puts++; kv.set(k, v) }, delete: async k => { kv.delete(k) } };
const mkState = () => { const m = new Map(), socks = []; return { socks, acceptWebSocket(ws) { socks.push(ws) }, getWebSockets() { return socks.filter(s => !s.closed) }, setWebSocketAutoResponse() {}, storage: { list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])), put: async o => { for (const [k, v] of Object.entries(o)) m.set(k, JSON.parse(JSON.stringify(v))) }, get: async k => m.get(k) } } };
const insts = {}; const MATCH = { idFromName: n => n, get: id => ({ fetch: (u, init) => (insts[id] = insts[id] || new Matchmaker(mkState(), {})).fetch(new Request(u, init)) }) };
const env = { PLAYER_STATS, MATCH };
const J = async (r) => ({ s: r.status, j: await r.json() });
const mkws = () => ({ msgs: [], send(s) { this.msgs.push(JSON.parse(s)) }, close() {}, addEventListener() {} });
const worker = W.default;
const top = async scope => J(await worker.fetch(new Request('https://x/api/leaderboard?scope=' + scope), env));
function mkRoom(gm, humans, stake = 0) {
  const r = new GameRoom({}, env); r.code = 'TEST'; r.cfg = { gm, target: 100, fill: false, host: humans[0].pid, stake };
  const act = r.act; humans.forEach((h, i) => { r.seats[act[i]] = { pid: h.pid, name: h.name, av: h.av || 1, bot: false, ws: mkws(), off: 0, rm: false } });
  return r;
}
async function playOut(r, max = 20000) {
  r.startNow();
  for (let i = 0; i < max && !(r.phase === 'over' && r.final); i++) { if (r.phase === 'play' && !r.dealing && r.over < 0) r.botStep(); await sleep(0); }
  await sleep(40);
}
const A = 'usr_aaaa11', B = 'usr_bbbb22', C = 'usr_cccc33', D = 'usr_dddd44';
(async () => {
  // isoWeek
  ok('isoWeek: 2020-12-31 is 2020-W53, 2024-12-30 is 2025-W01, 2026-01-01 is 2026-W01, Sunday 2026-10-25 is W43',
    isoWeek(new Date('2020-12-31T12:00Z')) === '2020-W53' && isoWeek(new Date('2024-12-30T12:00Z')) === '2025-W01' && isoWeek(new Date('2026-01-01T12:00Z')) === '2026-W01' && isoWeek(new Date('2026-10-25T12:00Z')) === '2026-W43');
  // ---- 1v1, two humans: rated
  let r = mkRoom('1v1', [{ pid: A, name: 'Ann' }, { pid: B, name: 'Bob' }], 500);
  ok('stake is carried in the room view and lobby', r.view(0).stake === 500);
  await playOut(r);
  const pa = JSON.parse(kv.get('profile:' + A)), pb = JSON.parse(kv.get('profile:' + B));
  const winner = pa.totalWins ? pa : pb, loser = pa.totalWins ? pb : pa;
  ok('1v1: both profiles recorded once (1 match each)', pa.totalMatches === 1 && pb.totalMatches === 1 && winner.totalWins === 1 && loser.totalWins === 0);
  ok('1v1: winner gets +25 (+blocked bonus), loser -15', winner.rankPoints >= 1025 && winner.rankPoints <= 1035 && loser.rankPoints === 985);
  ok('1v1: result screens receive their rank change', r.view(0).rk && r.view(2).rk && r.view(0).rk.rated === true);
  const g = await top('global');
  ok('global leaderboard lists both, sorted by rank points', g.s === 200 && g.j.entries.length === 2 && g.j.entries[0].rankPoints >= g.j.entries[1].rankPoints && g.j.entries[0].wins === 1);
  const dly = await top('daily'), wk = await top('weekly');
  ok('daily + weekly list only the winner (positive points)', dly.j.entries.length === 1 && wk.j.entries.length === 1 && dly.j.entries[0].playerId === winner.playerId);
  r.recordMatch(); await sleep(20); ok('recording the same match twice does nothing', JSON.parse(kv.get('profile:' + A)).totalMatches === 1);
  r.dispose();
  // ---- client posts for online mode are ignored (no double count), solo still counted
  let rr = await J(await worker.fetch(new Request('https://x/api/match-result', { method: 'POST', body: JSON.stringify({ playerId: A, name: 'Ann', avatar: '😎', result: 'win', mode: 'online' }) }), env));
  ok('client-posted online result is skipped (profile unchanged, returned fresh)', rr.j.skipped && JSON.parse(kv.get('profile:' + A)).totalMatches === 1 && rr.j.profile.totalMatches === 1);
  rr = await J(await worker.fetch(new Request('https://x/api/match-result', { method: 'POST', body: JSON.stringify({ playerId: C, name: 'Cy', avatar: '😎', result: 'win', mode: 'solo' }) }), env));
  ok('solo result still counted as before (unrated: rank stays 1000)', rr.s === 200 && JSON.parse(kv.get('profile:' + C)).totalWins === 1 && JSON.parse(kv.get('profile:' + C)).rankPoints === 1000);
  // ---- 2v2: 2 humans + 2 bots, rated; teammates share the result
  r = mkRoom('2v2', [{ pid: C, name: 'Cy' }, { pid: D, name: 'Di' }]);   // seats 0 and 1 = opposing teams
  await playOut(r);
  const pc = JSON.parse(kv.get('profile:' + C)), pd = JSON.parse(kv.get('profile:' + D));
  const cWon = pc.totalWins === 2, dWon = pd.totalWins === 1;
  ok('2v2 with 2 humans: exactly one of them won; winner >= 1025, loser 985', pc.totalMatches === 2 && pd.totalMatches === 1 && cWon !== dWon &&
    (cWon ? (pc.rankPoints >= 1025 && pd.rankPoints === 985) : (pd.rankPoints >= 1025 && pc.rankPoints === 985)));
  r.dispose();
  // ---- single human + bots: stats yes, rank no, no leaderboard entry
  const E = 'usr_eeee55'; r = mkRoom('1v1', [{ pid: E, name: 'Solo' }]);
  await playOut(r);
  const pe = JSON.parse(kv.get('profile:' + E)); const g2 = await top('global');
  ok('1 human + bots: counted in stats but unrated (rank 1000, not on the board)', pe.totalMatches === 1 && pe.rankPoints === 1000 && !g2.j.entries.some(e => e.playerId === E));
  r.dispose();
  // ---- forfeit: early forfeit unrated, late forfeit rated and forfeiter always loses
  const F = 'usr_ffff66', G = 'usr_gggg77';
  r = mkRoom('1v1', [{ pid: F, name: 'Fox' }, { pid: G, name: 'Gus' }]); r.startNow(); await sleep(10);
  r.leave(0); await sleep(40);
  const pf = JSON.parse(kv.get('profile:' + F)), pg = JSON.parse(kv.get('profile:' + G));
  ok('forfeit in round 1: counted (loss/win) but unrated, ranks unchanged', pf.totalMatches === 1 && pf.totalWins === 0 && pg.totalWins === 1 && pf.rankPoints === 1000 && pg.rankPoints === 1000);
  r.dispose();
  const H = 'usr_hhhh88', I = 'usr_iiii99';
  r = mkRoom('1v1', [{ pid: H, name: 'Hal' }, { pid: I, name: 'Ivy' }]); r.startNow(); r.rid = 3; await sleep(10);
  r.leave(2); await sleep(40);
  const ph = JSON.parse(kv.get('profile:' + H)), pi = JSON.parse(kv.get('profile:' + I));
  ok('forfeit after 2+ rounds: rated; leaver -15, opponent +25', pi.rankPoints === 985 && ph.rankPoints === 1025 && ph.totalWins === 1);
  r.dispose();
  // ---- daily cap on rated matches
  const K = 'usr_kkkk00', L = 'usr_llll11'; let applied = 0;
  for (let i = 0; i < 45; i++) { const e = await J(await MATCH.get('lb').fetch('https://lb.internal/_lb/record', { method: 'POST', body: JSON.stringify({ entries: [{ id: K, name: 'K', avatar: '😎', base: 1000, win: true, delta: 25 }] }) })); if (e.j.res[K].applied) applied++; }
  ok('rated matches per player per day are capped at ' + LB.DAY_RATED + ' (applied ' + applied + ' of 45)', applied === LB.DAY_RATED);
  // ---- leaderboard input hardening
  const bad = await J(await MATCH.get('lb').fetch('https://lb.internal/_lb/record', { method: 'POST', body: JSON.stringify({ entries: [{ id: '../x', delta: 9999 }, { id: L, name: '<b>x</b>', avatar: 'EVIL', base: 99999999, win: true, delta: 9999 }] }) }));
  ok('bad ids ignored; delta clamped to +60; name/avatar sanitized; base clamped', !bad.j.res['../x'] && bad.j.res[L].delta === 60 && bad.j.res[L].rp <= 100060);
  const t = await top('global'); const le = t.j.entries.find(e => e.playerId === L);
  ok('sanitized name and avatar on the board', le && !/[<>]/.test(le.name) && le.avatar === '😎');
  ok('bad scope rejected', (await top('hourly')).s === 400);
  // ---- matchmaking by stake
  const mm = new Matchmaker(mkState(), {}); const q = (gm, stake) => { const ws = mkws(); mm.q.push({ ws, gm, stake, since: Date.now() }); return ws; };
  const w1 = q('1v1', 500), w2 = q('1v1', 0), w3 = q('1v1', 500), w4 = q('1v1', 0), w5 = q('1v1', 5000);
  mm.tick();
  const m1 = w1.msgs.find(x => x.t === 'matched'), m2 = w2.msgs.find(x => x.t === 'matched');
  ok('quick match pairs only players with the same entry fee and tells them the stake', m1 && m1.stake === 500 && w3.msgs.some(x => x.t === 'matched' && x.room === m1.room) && m2 && m2.stake === 0 && m2.room !== m1.room && w4.msgs.some(x => x.t === 'matched' && x.room === m2.room));
  ok('a lone 5000-coin player keeps waiting (queue update, no match)', !w5.msgs.some(x => x.t === 'matched') && w5.msgs.some(x => x.t === 'queue'));
  clearInterval(mm.iv);
  // stake parsing through the real connection path (WebSocketPair / 101 responses are Workers-only, so stub them)
  const R0 = globalThis.Response, WP0 = globalThis.WebSocketPair;
  globalThis.Response = function (b, i) { this.status = i && i.status; this.webSocket = i && i.webSocket };
  globalThis.WebSocketPair = function () { const w = mkws(); this[0] = {}; this[1] = Object.assign(w, { accept() {} }); };
  const conn = async (qs) => { const room = new GameRoom({}, env); await room.fetch(new Request('https://x/ws?room=ABCDE&' + qs + '&pid=usr_zzzz11&name=Zed&av=0')); room.dispose(); return room; };
  let c1 = await conn('create=1&gm=1v1&stake=500'), c2 = await conn('create=1&gm=1v1&stake=777'), c3 = await conn('create=1&gm=1v1'), c4 = await conn('create=1&gm=1v1&stake=-5'), c5 = await conn('create=1&gm=1v1&stake=abc');
  ok('room stake: 500 accepted; 777 / negative / text / missing all fall back to 0', c1.cfg.stake === 500 && c2.cfg.stake === 0 && c3.cfg.stake === 0 && c4.cfg.stake === 0 && c5.cfg.stake === 0);
  const lob = c1.seats[0].ws.msgs.find(m => m.t === 'olobby');
  ok('lobby message shows the entry fee to everyone before the match starts', lob && lob.stake === 500);
  globalThis.Response = R0; globalThis.WebSocketPair = WP0;

  { // =================== v1.3.1 ===================
  const oldFetch = globalThis.fetch;
  const nodeCrypto = (await import('node:crypto')).default;
  // ---- speed mode: timer + auto play / auto pass
  r = mkRoom('1v1', [{ pid: 'usr_t1aaaa', name: 'T1' }, { pid: 'usr_t2bbbb', name: 'T2' }]); r.cfg.turn = 10; r.cfg.auto = 'pass';
  r.startNow(); for (let i = 0; i < 200 && (r.phase !== 'play' || r.dealing); i++) await sleep(2);
  let cp = r.cur;
  ok('turn timer: 10 s chosen by the host is used for human turns', r.turnMs() === 10000 && r.view(cp).tt === 10000 && r.view(cp).tl > 8000 && r.view(cp).tl <= 10000 && r.view(cp).turn === 10 && r.view(cp).auto === 'pass');
  let hn = r.hands[cp].length; r.cfg.auto = 'play'; r.timeout();
  ok('Auto Play: on timeout the server plays a tile for you', r.hands[cp].length === hn - 1);
  r.dispose();
  r = mkRoom('1v1', [{ pid: 'usr_t1aaaa', name: 'T1' }, { pid: 'usr_t2bbbb', name: 'T2' }]); r.cfg.turn = 10; r.cfg.auto = 'pass';
  r.startNow(); for (let i = 0; i < 200 && (r.phase !== 'play' || r.dealing); i++) await sleep(2);
  cp = r.cur; hn = r.hands[cp].length; const psId = r.ps ? r.ps.id : 0;
  r.timeout();
  ok('Auto Pass: with a playable tile the turn is skipped (no tile placed, "passed" badge sent, blocked-counter reset)', r.hands[cp].length === hn && r.cur !== cp && r.ps && r.ps.id > psId && r.passes === 0 && r.seats[cp].to === 1);
  for (let k = 0; k < 2; k++) { r.cur = cp; r.timeout(); }
  ok('3 timeouts in a row switch the seat to auto-play (no stalled table)', r.seats[cp].auto === true);
  r.cur = cp; hn = r.hands[cp].length; r.timeout();
  ok('after that the seat is auto-played on timeout', r.hands[cp].length === hn - 1);
  r.human(cp); ok('a human move clears the timeout streak', r.seats[cp].to === 0 && !r.seats[cp].auto);
  // nothing playable: draw like a human has to
  r.chain = [{ a: 6, b: 6 }]; r.ci = 0; r.cur = cp; r.hands[cp] = [[0, 1], [2, 3]]; r.seats[cp].auto = false; r.phase = 'play'; r.over = -1; r.dealing = false;
  hn = r.hands[cp].length; r.timeout();
  ok('Auto Pass with nothing playable: draws from the boneyard instead of skipping', r.hands[cp].length === hn + 1);
  r.dispose();
  // ---- config parsing through the real connection path
  const WP1 = globalThis.WebSocketPair, R1 = globalThis.Response;
  globalThis.Response = function (b, i) { this.status = i && i.status; this.webSocket = i && i.webSocket };
  globalThis.WebSocketPair = function () { const w = mkws(); this[0] = {}; this[1] = Object.assign(w, { accept() {} }); };
  const conn2 = async (qs, code = 'QWERT') => { const room = new GameRoom({}, env); await room.fetch(new Request('https://x/ws?room=' + code + '&' + qs + '&pid=usr_hostx1&name=Host&av=0')); return room; };
  let d1 = await conn2('create=1&gm=1v1&turn=15&auto=pass'), d2 = await conn2('create=1&gm=1v1&turn=17&auto=boom'), d3 = await conn2('create=1&gm=2v2&type=tvt&res=2:usr_aaaa22,1:usr_bbbb33,3:usr_cccc44,0:usr_evil99');
  ok('room config: timer 15 + auto pass accepted; 17 / unknown mode fall back to no timer / manual', d1.cfg.turn === 15 && d1.cfg.auto === 'pass' && d2.cfg.turn === 0 && d2.cfg.auto === 'manual' && d2.turnMs() === CFG.IDLE);
  ok('reservations: three friend seats accepted, seat 0 (host) cannot be reserved', JSON.stringify(d3.cfg.res) === JSON.stringify({ 1: 'usr_bbbb33', 2: 'usr_aaaa22', 3: 'usr_cccc44' }) && d3.cfg.type === 'tvt');
  const l0 = d1.seats[0].ws.msgs.find(m => m.t === 'olobby'); ok('lobby shows timer and auto mode to everyone', l0 && l0.turn === 15 && l0.auto === 'pass');
  [d1, d2, d3].forEach(x => x.dispose());
  // ---- seat reservations
  const att = (room, pid) => { const ws = mkws(); room.attach(ws, pid, pid.slice(4), 1); return ws; };
  const mk2 = res => { const x = new GameRoom({}, env); x.code = 'RESV1'; x.cfg = { gm: '2v2', target: 100, fill: false, host: 'usr_hostx1', stake: 0, turn: 0, auto: 'play', type: 'partner', seek: false, res }; return x; };
  let rv = mk2({ 2: 'usr_frnd22' }); att(rv, 'usr_hostx1'); const sa = att(rv, 'usr_rand111'); const sb = att(rv, 'usr_rand222'); const sc = att(rv, 'usr_rand333');
  ok('partner room: strangers take seats 1 and 3, seat 2 stays reserved (3rd stranger is told the room is full)', rv.seats[1] && rv.seats[3] && !rv.seats[2] && sc.msgs.some(m => m.t === 'err' && m.m === 'full'));
  att(rv, 'usr_frnd22'); ok('the invited friend gets the reserved seat 2 (his partner)', rv.seats[2] && rv.seats[2].pid === 'usr_frnd22' && rv.seats[0].pid === 'usr_hostx1');
  rv.dispose();
  rv = mk2({ 2: 'usr_frnd22', 1: 'usr_frnd33', 3: 'usr_frnd44' }); att(rv, 'usr_hostx1'); const se = att(rv, 'usr_rand111');
  ok('team-vs-team room: uninvited players cannot join', se.msgs.some(m => m.t === 'err' && m.m === 'full'));
  const lb0 = rv.seats[0].ws.msgs.filter(m => m.t === 'olobby').pop(); ok('lobby tells the host which invited seats are still empty', lb0 && JSON.stringify(lb0.wait) === '[1,2,3]');
  att(rv, 'usr_frnd44'); att(rv, 'usr_frnd33'); att(rv, 'usr_frnd22');
  ok('team-vs-team: each friend sits in his reserved seat (A with you, B and C together)', rv.seats[2].pid === 'usr_frnd22' && rv.seats[1].pid === 'usr_frnd33' && rv.seats[3].pid === 'usr_frnd44' && tmSame(rv));
  function tmSame(x) { return [0, 2].every(i => i % 2 === 0) && [1, 3].every(i => i % 2 === 1); }
  rv.dispose();
  // ---- "You + Friend vs 2 randoms": the room asks the matchmaker for two random opponents with the same entry fee
  const sk = await conn2('create=1&gm=2v2&stake=500&seek=1&type=partner&res=2:usr_frnd22', 'SEEK1'); await sleep(20);
  const mmI = insts.mm; ok('seek: the room registered a request for 2 randoms at its stake', mmI && mmI.reqs.some(q => q.room === 'SEEK1' && q.stake === 500 && q.need === 2));
  const qq = (stake) => { const w = mkws(); mmI.q.push({ ws: w, gm: '2v2', stake, since: Date.now() }); return w; };
  const s1k = qq(0), s2k = qq(500); mmI.tick();
  ok('seek: a random with a different fee is not sent to the room', !s1k.msgs.some(m => m.t === 'matched' && m.room === 'SEEK1'));
  const s3k = qq(500); mmI.tick();
  ok('seek: two randoms with the same fee are sent to the host room (not a new room)', [s2k, s3k].every(w => w.msgs.some(m => m.t === 'matched' && m.room === 'SEEK1' && m.stake === 500)) && !mmI.reqs.some(q => q.room === 'SEEK1'));
  const sk2 = await conn2('create=1&gm=2v2&seek=1&type=partner&res=2:usr_frnd22', 'SEEK2'); await sleep(20);
  sk2.startNow(); await sleep(20); ok('starting the match (bots fill) cancels the search for randoms', !mmI.reqs.some(q => q.room === 'SEEK2'));
  [sk, sk2].forEach(x => x.dispose()); clearInterval(mmI.iv);
  globalThis.Response = R1; globalThis.WebSocketPair = WP1;
  // ---- presence (hibernatable WebSockets)
  class FWS { constructor() { this.msgs = []; this.att = null; this.closed = false } accept() {} send(s) { this.msgs.push(JSON.parse(s)) } close() { this.closed = true } serializeAttachment(a) { this.att = JSON.parse(JSON.stringify(a)); if (JSON.stringify(a).length > 2048) throw new Error('attachment too large') } deserializeAttachment() { return this.att ? JSON.parse(JSON.stringify(this.att)) : null } }
  let lastPair = null; globalThis.WebSocketPair = function () { const w = new FWS(); lastPair = w; this[0] = {}; this[1] = w; }; globalThis.WebSocketRequestResponsePair = function (a, b) { this.a = a; this.b = b };
  globalThis.Response = function (b, i) { this.status = i && i.status; this.webSocket = i && i.webSocket };
  const pr = new Matchmaker(mkState(), {}); const conP = id => { pr.presenceAccept(new Request('https://x/ws?presence=1&pid=' + id)); return lastPair; };
  const PA = 'usr_pa1111', PB = 'usr_pb2222', PC = 'usr_pc3333';
  const wA = conP(PA), wB = conP(PB);
  await pr.webSocketMessage(wB, JSON.stringify({ t: 'watch', ids: [PA, PC, 'bad id'] }));
  let snap = wB.msgs.find(m => m.t === 'pres' && m.all);
  ok('presence: watching friends returns their current status (A online=1, C offline=0, invalid ids ignored)', snap && snap.all[PA] === 1 && snap.all[PC] === 0 && Object.keys(snap.all).length === 2);
  await pr.webSocketMessage(wA, JSON.stringify({ t: 'st', s: 2 }));
  ok('presence: friend starts a game -> watcher is told immediately (in-game=2)', wB.msgs.some(m => m.t === 'pres' && m.id === PA && m.s === 2));
  const wC = conP(PC); ok('presence: friend comes online -> watcher is told (online=1)', wB.msgs.some(m => m.t === 'pres' && m.id === PC && m.s === 1));
  const wA2 = conP(PA); await pr.webSocketClose(wA2);
  ok('presence: a second device of the same player disconnecting does not make him offline', !wB.msgs.filter(m => m.id === PA).some(m => m.s === 0));
  await pr.webSocketClose(wA);
  ok('presence: last socket closes -> watcher is told offline (0)', wB.msgs.filter(m => m.id === PA).pop().s === 0);
  ok('presence: players are not told about themselves / non-watchers get nothing', !wA.msgs.some(m => m.t === 'pres' && m.id === PA) && !wC.msgs.some(m => m.t === 'pres'));
  conP(PA); conP(PA); conP(PA); const w4 = conP(PA); ok('presence: max 3 sockets per player (4th is refused)', w4.msgs.some(m => m.t === 'err') && w4.closed);
  const wBad = conP('nope'); ok('presence: invalid player ids are refused', wBad.msgs.some(m => m.t === 'err'));
  await pr.webSocketMessage(wB, JSON.stringify({ t: 'watch', ids: Array.from({ length: 80 }, (_, i) => 'usr_x' + String(i).padStart(4, '0')) }));
  ok('presence: watch list is capped at 40 (fits the 2 KB attachment limit)', wB.deserializeAttachment().w.length === 40);
  const n0 = wB.msgs.length; await pr.webSocketMessage(wB, 'x'.repeat(5000)); await pr.webSocketMessage(wB, 'not json'); ok('presence: oversized / non-JSON messages are ignored', wB.msgs.length === n0);
  globalThis.WebSocketPair = WP1; globalThis.Response = R1;
  // ---- invites + FCM push (/api/invite, /api/push-token)
  insts.pr = pr;                                       // the Worker reaches presence through env.MATCH 'pr'
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const SA = JSON.stringify({ client_email: 'sd@street-dominoes.iam.gserviceaccount.com', private_key: privateKey, project_id: 'street-dominoes' });
  let oauth = 0, fcm = [], jwtOk = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      oauth++; const jwt = new URLSearchParams(init.body).get('assertion'), [h, c, s] = jwt.split('.');
      const claim = JSON.parse(Buffer.from(c, 'base64url').toString()); jwtOk = nodeCrypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), publicKey, Buffer.from(s, 'base64url')) && claim.scope.includes('firebase.messaging') && claim.iss.startsWith('sd@') && claim.exp > claim.iat;
      return new Response(JSON.stringify({ access_token: 'AT-' + oauth, expires_in: 3600 }), { status: 200 });
    }
    if (String(url).includes('fcm.googleapis.com')) {
      const b = JSON.parse(init.body); fcm.push({ url: String(url), auth: init.headers.authorization, msg: b.message });
      if (b.message.token.includes('GONE')) return new Response('{"error":{"status":"NOT_FOUND"}}', { status: 404 });
      if (b.message.token.includes('FAIL')) return new Response('oops', { status: 500 });
      return new Response('{"name":"ok"}', { status: 200 });
    }
    return oldFetch(url, init);
  };
  const post = (p, body, e = env) => worker.fetch(new Request('https://x' + p, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), e);
  const envF = { PLAYER_STATS, MATCH, FCM_SERVICE_ACCOUNT: SA };
  const TOK = n => 'tok_' + n + '_'.padEnd(30, 'x');
  for (const [id, tk] of [['usr_f2offln', [TOK('f2')]], ['usr_f4gone1', [TOK('GONE')]], ['usr_f5mixed', [TOK('GONE'), TOK('good')]]]) await J(await post('/api/push-token', { playerId: id, token: tk[0] }, envF)), tk[1] && await J(await post('/api/push-token', { playerId: id, token: tk[1] }, envF));
  const F1 = 'usr_f1onlin'; const wF1 = (() => { globalThis.WebSocketPair = function () { const w = new FWS(); lastPair = w; this[0] = {}; this[1] = w }; globalThis.Response = function (b, i) { this.status = i && i.status; this.webSocket = i && i.webSocket }; pr.presenceAccept(new Request('https://x/ws?presence=1&pid=' + F1)); const w = lastPair; globalThis.WebSocketPair = WP1; globalThis.Response = R1; return w })();
  let ir = await J(await post('/api/invite', { from: 'usr_sendr01', name: 'Karim', av: 2, to: [F1, 'usr_f2offln', 'usr_f3notok'], kind: 'invite', room: 'abcde', gm: '2v2', type: 'partner', stake: 500, turn: 15 }, envF));
  ok('invite: online friend gets it in-app, offline friend with a device gets a push, offline friend without a device is reported', ir.s === 200 && ir.j.delivered.join() === F1 && ir.j.pushed.join() === 'usr_f2offln' && ir.j.offline.join() === 'usr_f3notok' && ir.j.push === true);
  if (process.env.DBG) console.log('DBG first invite =>', JSON.stringify(ir), 'fcm calls', fcm.length, 'oauth', oauth);
  const iv = wF1.msgs.find(m => m.t === 'inv'); ok('invite: in-app message carries room, type, fee and timer', iv && iv.room === 'ABCDE' && iv.type === 'partner' && iv.stake === 500 && iv.turn === 15 && iv.name === 'Karim' && iv.from === 'usr_sendr01');
  const pm = fcm[0]; ok('push: FCM v1 request is authenticated, targets the token and carries the room for the tap', pm.url.includes('/projects/street-dominoes/messages:send') && pm.auth === 'Bearer AT-1' && pm.msg.token === TOK('f2') && pm.msg.data.room === 'ABCDE' && pm.msg.data.kind === 'invite' && pm.msg.data.stake === '500' && /Karim/.test(pm.msg.data.name) && pm.msg.android.priority === 'HIGH' && pm.msg.notification === undefined);
  ok('push: service-account JWT is RS256-signed with the right scope', jwtOk === true);
  ir = await J(await post('/api/invite', { from: 'usr_sendr01', to: [F1, 'usr_f2offln'], kind: 'invite', room: 'ABCDE', gm: '2v2' }, envF));
  ok('invite: the same sender cannot re-invite the same player within 20 s', ir.j.limited.length === 2 && ir.j.delivered.length === 0);
  ir = await J(await post('/api/invite', { from: 'usr_sendr02', name: 'Sam', to: ['usr_f4gone1', 'usr_f5mixed'], kind: 'ping', ping: '👋' }, envF));
  ok('Street Ping: pushed to the device that is still valid; a dead token is dropped and the player reported as unreachable', ir.j.pushed.join() === 'usr_f5mixed' && ir.j.offline.join() === 'usr_f4gone1');
  ok('push: invalid (404) tokens are removed from KV, valid ones kept', !kv.has('push:usr_f4gone1') && JSON.parse(kv.get('push:usr_f5mixed')).tokens.length === 1 && JSON.parse(kv.get('push:usr_f5mixed')).tokens[0] === TOK('good'));
  const pingMsg = fcm.filter(x => x.msg.data.kind === 'ping').pop(); ok('Street Ping message', pingMsg && !pingMsg.msg.notification && pingMsg.msg.data.ping === '👋');
  ir = await J(await post('/api/invite', { from: 'usr_sendr02', to: ['usr_f5mixed'], kind: 'ping', ping: '👋' }, envF)); ok('Street Ping cooldown: 60 s per pair', ir.j.limited.join() === 'usr_f5mixed');
  ok('FCM access token is cached (one OAuth call for all of the above)', oauth === 1);
  ok('invite validation: bad sender / no targets / bad room / bad ping / oversized body', (await post('/api/invite', { from: 'x', to: [F1], room: 'ABC' }, envF)).status === 400 && (await post('/api/invite', { from: 'usr_sendr03', to: [], room: 'ABC' }, envF)).status === 400 && (await post('/api/invite', { from: 'usr_sendr03', to: [F1], kind: 'invite', room: '!!' }, envF)).status === 400 && (await post('/api/invite', { from: 'usr_sendr03', to: [F1], kind: 'ping', ping: '💣' }, envF)).status === 400 && (await post('/api/invite', 'x'.repeat(3000), envF)).status === 413);
  ir = await J(await post('/api/invite', { from: 'usr_sendr04', to: ['usr_f2offln'], kind: 'invite', room: 'ABCDE', gm: '1v1' }, { PLAYER_STATS, MATCH }));
  ok('without the FCM secret: still works in-app, push reported as off, nobody crashes', ir.s === 200 && ir.j.push === false && ir.j.offline.join() === 'usr_f2offln' && ir.j.pushed.length === 0);
  // push-token API
  puts = 0; const T1 = TOK('reg1'); let tr = await J(await post('/api/push-token', { playerId: 'usr_regtok1', token: T1 }, envF)); const w1 = puts;
  tr = await J(await post('/api/push-token', { playerId: 'usr_regtok1', token: T1 }, envF));
  ok('push-token: registering the same token again does not write KV again', tr.j.n === 1 && puts === w1);
  for (const n of ['b', 'c', 'd']) await post('/api/push-token', { playerId: 'usr_regtok1', token: TOK(n) }, envF);
  ok('push-token: at most 3 devices per player, newest first', JSON.parse(kv.get('push:usr_regtok1')).tokens.length === 3 && JSON.parse(kv.get('push:usr_regtok1')).tokens[0] === TOK('d'));
  await post('/api/push-token', { playerId: 'usr_regtok1', token: TOK('d'), remove: true }, envF); ok('push-token: remove', !JSON.parse(kv.get('push:usr_regtok1')).tokens.includes(TOK('d')));
  ok('push-token validation', (await post('/api/push-token', { playerId: 'usr_regtok1', token: 'short' }, envF)).status === 400 && (await post('/api/push-token', { playerId: 'bad', token: TOK('z') }, envF)).status === 400);
  globalThis.fetch = oldFetch;
  // views expose the other players' ids (for "recent friends") and the timer
  const rvw = mkRoom('1v1', [{ pid: A, name: 'Ann' }, { pid: B, name: 'Bob' }]); rvw.startNow(); await sleep(10);
  ok('state view carries player ids (humans only) so the app can save recent opponents', JSON.stringify(rvw.view(0).pids) === JSON.stringify([A, null, B, null])); rvw.dispose();
  }

  // =================== v1.3.1b: relay credentials, names, chat ===================
  { const oldF = globalThis.fetch; let upstream = 0, lastReq = null;
    globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://rtc.live.cloudflare.com/')) { upstream++; lastReq = { url: String(url), init }; return new Response(JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u1', credential: 'c1' }] }), { status: 200 }); } return oldF(url, init); };
    const get = (p, e) => worker.fetch(new Request('https://x' + p), e);
    let tr = await J(await get('/api/turn', { PLAYER_STATS, MATCH }));
    ok('relay: not configured -> 503 (the app falls back to STUN only)', tr.s === 503);
    const envT = { PLAYER_STATS, MATCH, TURN_KEY_ID: 'KEY1', TURN_API_TOKEN: 'TOK1' };
    tr = await J(await get('/api/turn', envT));
    ok('relay: returns Cloudflare TURN servers with credentials, port-53 URLs removed (browsers time out on them)', tr.s === 200 && tr.j.iceServers.length === 2 && tr.j.iceServers.every(s => s.urls.every(u => !u.includes(':53'))) && tr.j.iceServers[1].username === 'u1' && tr.j.iceServers[1].credential === 'c1');
    ok('relay: asks the generate-ice-servers endpoint with the bearer token and a 24 h ttl', lastReq.url.endsWith('/v1/turn/keys/KEY1/credentials/generate-ice-servers') && lastReq.init.headers.authorization === 'Bearer TOK1' && JSON.parse(lastReq.init.body).ttl === 86400);
    await get('/api/turn', envT); await get('/api/turn', envT); ok('relay: credentials are cached (one upstream call for many players)', upstream === 1);
    globalThis.fetch = oldF; }
  { const r = mkRoom('2v2', [{ pid: 'usr_nm1111', name: 'ILINE' }]); const add = (pid, name) => { const ws = mkws(); r.attach(ws, pid, name, 1); return ws; };
    add('usr_nm2222', 'ILINE'); add('usr_nm3333', 'iline'); add('usr_nm4444', 'Zed');
    const v = r.view(0).names;
    ok('names: players with the same name get numbered in the room view (ILINE, ILINE 2, iline 3, Zed)', v[0] === 'ILINE' && v[1] === 'ILINE 2' && v[2] === 'iline 3' && v[3] === 'Zed');
    ok('names: the profile / leaderboard name is NOT changed by the numbering', r.seats[1].name === 'ILINE' && r.seats[1].dn === 'ILINE 2');
    ok('names: lobby list uses the same unique names', r.seats[1].dn === 'ILINE 2'); r.dispose(); }
  { const r = mkRoom('1v1', [{ pid: 'usr_ch1111', name: 'Ann' }, { pid: 'usr_ch2222', name: 'Bob' }]); const w0 = r.seats[0].ws, w2 = r.seats[2].ws;
    const msg = (seat, o) => r.onMsg(seat, r.seats[seat].ws, JSON.stringify(o));
    const got = (w, f) => w.msgs.filter(m => m.t === 'rx' && f(m));
    ok('chat: cleanChat strips links, tags and control characters and caps the length', W.cleanChat('hi <b>x</b>\n https://evil.com/a www.spam.io ok') === 'hi b x /b … … ok' && W.cleanChat('x'.repeat(200)).length === 60 && W.cleanChat('   ') === '' && W.cleanChat(5) === '5');
    msg(0, { t: 'rx', k: 'txt', x: 'Salam  <b>khoya</b> 👋' });
    ok('chat: a free-text message is sent to every player in the room with the sender seat', got(w0, m => m.k === 'txt' && m.p === 0 && m.x === 'Salam b khoya /b 👋').length === 1 && got(w2, m => m.k === 'txt' && m.p === 0).length === 1);
    msg(0, { t: 'rx', k: 'txt', x: 'second right away' });
    ok('chat: flood protection (1 free-text message per 1.5 s per player)', got(w2, m => m.k === 'txt').length === 1);
    r.seats[0].rx = Date.now() - 2000; msg(0, { t: 'rx', k: 'txt', x: 'later is fine' });
    ok('chat: next message after the cooldown goes through', got(w2, m => m.k === 'txt').length === 2);
    r.seats[2].rx = 0; msg(2, { t: 'rx', k: 'txt', x: '   ' }); msg(2, { t: 'rx', k: 'txt', x: 12345 }); msg(2, { t: 'rx', k: 'nope', x: 'x' });
    ok('chat: empty, non-text and unknown kinds are ignored', got(w0, m => m.p === 2).length === 0);
    msg(2, { t: 'rx', k: '🔥' }); ok('chat: the existing emoji / phrase quick messages still work', got(w0, m => m.k === '🔥' && m.p === 2).length === 1);
    r.dispose(); }

  // =================== v1.3.2: manual control, optional speed settings, quick match speed, FCM keys ===================
  { const R2 = globalThis.Response, W2 = globalThis.WebSocketPair;
    globalThis.Response = function (b, i) { this.status = i && i.status; this.webSocket = i && i.webSocket };
    globalThis.WebSocketPair = function () { const w = mkws(); this[0] = {}; this[1] = Object.assign(w, { accept() {} }); };
    const cn = async (qs, code = 'MAN01') => { const room = new GameRoom({}, env); await room.fetch(new Request('https://x/ws?room=' + code + '&' + qs + '&pid=usr_hostx9&name=Host&av=0')); return room; };
    const m0 = await cn('create=1&gm=1v1'), m1 = await cn('create=1&gm=1v1&turn=20&auto=manual'), m2 = await cn('create=1&gm=1v1&auto=pass'), m3 = await cn('create=1&gm=1v1&turn=20&auto=play');
    ok('defaults: nothing is forced (no timer, manual control) when the host picks no speed settings', m0.cfg.turn === 0 && m0.cfg.auto === 'manual' && !m0.timed() && m0.turnMs() === CFG.IDLE && m0.view(0).tl === 0);
    ok('a timer with Manual control is allowed but never acts for the player (no countdown, only the inactivity safety net)', m1.cfg.turn === 20 && m1.cfg.auto === 'manual' && !m1.timed() && m1.view(0).tl === 0 && m1.turnMs() === CFG.IDLE);
    ok('Auto Pass without a timer falls back to manual (a rule that needs a timer is ignored without one)', m2.cfg.turn === 0 && m2.cfg.auto === 'manual');
    ok('Auto Play + 20 s is a timed room', m3.cfg.auto === 'play' && m3.timed() && m3.turnMs() === 20000);
    const lobM = m1.seats[0].ws.msgs.find(m => m.t === 'olobby'); ok('lobby tells everyone the control mode', lobM && lobM.auto === 'manual' && lobM.turn === 20);
    [m0, m1, m2, m3].forEach(x => x.dispose());
    globalThis.Response = R2; globalThis.WebSocketPair = W2;
    // manual: the idle safety net is the only thing that moves a stalled seat
    const rm = mkRoom('1v1', [{ pid: 'usr_man111', name: 'M1' }, { pid: 'usr_man222', name: 'M2' }]); rm.cfg.turn = 15; rm.cfg.auto = 'manual';
    rm.startNow(); for (let i = 0; i < 200 && (rm.phase !== 'play' || rm.dealing); i++) await sleep(2);
    const pm = rm.cur, hn2 = rm.hands[pm].length; rm.timeout();
    ok('manual control: only after the long inactivity safety does the server play for an idle player', rm.hands[pm].length === hn2 - 1 && rm.seats[pm].to === undefined);
    rm.dispose();
    // quick match: players are only paired with the same speed settings
    const mmS = new Matchmaker(mkState(), {}); const qn = (turn, auto, stake = 0) => { const w = mkws(); mmS.q.push({ ws: w, gm: '1v1', stake, turn, auto, since: Date.now() }); return w; };
    const a1 = qn(0, 'manual'), a2 = qn(15, 'pass'), a3 = qn(0, 'manual'), a4 = qn(15, 'play'), a5 = qn(15, 'pass'); mmS.tick();
    const ma1 = a1.msgs.find(m => m.t === 'matched'), ma2 = a2.msgs.find(m => m.t === 'matched');
    ok('quick match: same settings are paired (no timer with no timer; 15 s Auto Pass with 15 s Auto Pass), and the match carries them', ma1 && a3.msgs.some(m => m.t === 'matched' && m.room === ma1.room) && ma1.turn === 0 && ma1.auto === 'manual' && ma2 && a5.msgs.some(m => m.t === 'matched' && m.room === ma2.room) && ma2.turn === 15 && ma2.auto === 'pass' && ma1.room !== ma2.room);
    ok('quick match: a different control mode (15 s Auto Play) keeps waiting instead of being forced into another rule set', !a4.msgs.some(m => m.t === 'matched') && a4.msgs.some(m => m.t === 'queue'));
    clearInterval(mmS.iv);
    // the room that searches for randoms passes its speed settings to the matchmaker
    const R3 = globalThis.Response, WP3 = globalThis.WebSocketPair;
    globalThis.Response = function (b, i) { this.status = i && i.status; this.webSocket = i && i.webSocket };
    globalThis.WebSocketPair = function () { const w = mkws(); this[0] = {}; this[1] = Object.assign(w, { accept() {} }); };
    const sk3 = new GameRoom({}, env); await sk3.fetch(new Request('https://x/ws?room=SPD01&create=1&gm=2v2&seek=1&turn=10&auto=pass&type=partner&res=2:usr_frnd22&pid=usr_hostx9&name=H')); await sleep(20);
    ok('"you + friend vs 2 randoms" rooms with a timer only get randoms who chose the same speed settings', insts.mm.reqs.some(q => q.room === 'SPD01' && q.turn === 10 && q.auto === 'pass'));
    const rqn = (turn, auto) => { const w = mkws(); insts.mm.q.push({ ws: w, gm: '2v2', stake: 0, turn, auto, since: Date.now() }); return w; };
    const x1 = rqn(0, 'manual'), x2 = rqn(10, 'pass'); insts.mm.tick(); ok('seek: a random with different settings is not sent to the room', !x1.msgs.some(m => m.t === 'matched'));
    const x3 = rqn(10, 'pass'); insts.mm.tick(); ok('seek: two randoms with the same settings join the room', [x2, x3].every(w => w.msgs.some(m => m.t === 'matched' && m.room === 'SPD01' && m.turn === 10 && m.auto === 'pass')));
    sk3.dispose(); clearInterval(insts.mm.iv); globalThis.Response = R3; globalThis.WebSocketPair = WP3; }
  { // FCM data payload must not use reserved keys (Firebase rejects "from", "message_type", "google*", "gcm*")
    const reserved = k => k === 'from' || k === 'message_type' || k.startsWith('google') || k.startsWith('gcm');
    const post = (p, body, e) => worker.fetch(new Request('https://x' + p, { method: 'POST', body: JSON.stringify(body) }), e);
    const oldF2 = globalThis.fetch, sent2 = [];
    const { privateKey: pk2 } = (await import('node:crypto')).default.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    globalThis.fetch = async (url, init) => { if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600 }), { status: 200 }); if (String(url).includes('fcm.googleapis.com')) { sent2.push(JSON.parse(init.body).message); return new Response('{}', { status: 200 }); } return oldF2(url, init); };
    const envK = { PLAYER_STATS, MATCH, FCM_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com', private_key: pk2, project_id: 'p' }) };
    await post('/api/push-token', { playerId: 'usr_k1offln', token: 'tokK_' + 'x'.repeat(30) }, envK);
    await post('/api/invite', { from: 'usr_senk001', name: 'S', to: ['usr_k1offln'], kind: 'invite', room: 'ABCDE', gm: '2v2' }, envK);
    await post('/api/invite', { from: 'usr_senk002', name: 'S', to: ['usr_k1offln'], kind: 'ping', ping: '🔥' }, envK);
    ok('FCM payloads: no reserved data keys (the sender is sent as "sid")', sent2.length === 2 && sent2.every(m => Object.keys(m.data).every(k => !reserved(k)) && Object.values(m.data).every(v => typeof v === 'string')) && sent2[0].data.sid === 'usr_senk001' && sent2[0].data.room === 'ABCDE' && sent2[0].data.kind === 'invite');
    globalThis.fetch = oldF2; }
  console.log(R.join('\n')); console.log(R.filter(x => x.startsWith('FAIL')).length ? 'SERVER TESTS FAILED' : 'server tests: all ' + R.length + ' passed'); process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
