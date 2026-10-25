import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
// Regression suite for server/src/worker.js (real GameRoom / Matchmaker code, fake KV + Durable Object storage). Run: node server/test/worker.test.mjs
const here = path.dirname(fileURLToPath(import.meta.url)), tmp = path.join(process.env.TMPDIR || os.tmpdir(), 'sd-worker-under-test.mjs');
fs.copyFileSync(path.join(here, '../src/worker.js'), tmp);
const W = await import(pathToFileURL(tmp).href);
const { GameRoom, Matchmaker, CFG, LB, isoWeek } = W; const api = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = []; const ok = (n, v) => R.push((v ? 'PASS ' : 'FAIL ') + n);
CFG.DEAL = 1; CFG.NEXT = 1; CFG.BOT = [1, 1]; CFG.DRAW = 1; CFG.TURN = 600000; CFG.GRACE = 600000;
// ---- fakes
const kv = new Map(); const PLAYER_STATS = { get: async (k, t) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => { kv.set(k, v) } };
const mkState = () => { const m = new Map(); return { storage: { list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])), put: async o => { for (const [k, v] of Object.entries(o)) m.set(k, JSON.parse(JSON.stringify(v))) }, get: async k => m.get(k) } } };
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
  console.log(R.join('\n')); console.log(R.filter(x => x.startsWith('FAIL')).length ? 'SERVER TESTS FAILED' : 'server tests: all ' + R.length + ' passed'); process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
