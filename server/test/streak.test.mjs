// node server/test/streak.test.mjs  -  7-day login streak (v1.7.0): real Worker routes + real Matchmaker 'acct' code, fake storage, controlled clock
import assert from 'node:assert/strict';
import worker, { Matchmaker } from '../src/worker.js';

const mem = new Map();
const storage = {
  async get(k) { return mem.get(k); },
  async put(k, v) { if (v === undefined && k && typeof k === 'object') for (const [a, b] of Object.entries(k)) mem.set(a, b); else mem.set(k, v); },
  async delete(k) { for (const x of [].concat(k)) mem.delete(x); },
  async list(o = {}) { let e = [...mem].filter(([k]) => k.startsWith(o.prefix || '')).sort((a, b) => (a[0] < b[0] ? -1 : 1)); if (o.reverse) e.reverse(); if (o.limit) e = e.slice(0, o.limit); return new Map(e); },
  async setAlarm() {},
};
const mm = new Matchmaker({ storage, getWebSockets: () => [] }, {});
const env = { MATCH: { idFromName: n => n, get: () => ({ fetch: (u, init) => mm.fetch(new Request(u, init)) }) } };

let now = Date.UTC(2026, 10, 4, 12, 0, 0);        // 4 Nov 2026 12:00 UTC = 13:00 Algeria
Date.now = () => now;
const DAY = 864e5;
const call = async (path, method = 'GET', body, token = '') => {
  const r = await worker.fetch(new Request('https://w' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
  return { s: r.status, j: await r.json() };
};
const ok = (c, m) => { assert.ok(c, m); console.log('PASS ' + m); };

async function newPlayer(pid) { const r = await call('/api/auth/init', 'POST', { playerId: pid }); assert.equal(r.s, 200); return r.j.token; }
const status = (pid, tok) => call('/api/streak?playerId=' + pid, 'GET', null, tok);
const claim = (pid, tok) => call('/api/streak/claim', 'POST', { playerId: pid }, tok);
const inbox = async (pid, tok) => (await call('/api/rewards/claim', 'POST', { playerId: pid }, tok)).j.items;

const P1 = 'usr_stk001';
const t1 = await newPlayer(P1);

let r = await status(P1, '');
ok(r.s === 401, 'status needs the account token');
r = await claim(P1, '');
ok(r.s === 401, 'claim needs the account token');

r = await status(P1, t1);
ok(r.s === 200 && r.j.can && r.j.day === 1 && r.j.run === 0 && !r.j.broken && r.j.days.length === 7, 'new player: Day 1 is ready');
ok(r.j.left > 0 && r.j.left <= DAY, 'status carries the time left in the Algeria day');

r = await claim(P1, t1);
ok(r.s === 200 && r.j.day === 1 && r.j.run === 1 && r.j.reward.coins === 1000, 'Day 1 claimed: 1,000 coins');
r = await claim(P1, t1);
ok(r.s === 409 && r.j.error === 'claimed', 'second claim on the same day is refused');
r = await status(P1, t1);
ok(!r.j.can && r.j.done && r.j.day === 1 && r.j.run === 1, 'status after the claim: done for today');

let items = await inbox(P1, t1);
ok(items.some(i => i.k === 'streak' && i.day === 1 && i.coins === 1000), 'the reward is in the inbox (kind streak, day 1)');
ok(items.some(i => i.k === 'welcome_basic'), 'the welcome bonus is untouched next to it');
ok((await inbox(P1, t1)).length === 0, 'the inbox gives each item once');

const EXP = [null, { coins: 2000 }, { coins: 3000, shield: 1 }, { coins: 4000 }, { coins: 5000, xpMin: 30 }, { coins: 7500 }, { coins: 10000, spins: 1 }];
for (let d = 2; d <= 7; d++) {
  now += DAY;
  r = await status(P1, t1);
  ok(r.j.can && r.j.day === d && r.j.run === d - 1 && !r.j.broken, 'next day: Day ' + d + ' is ready, streak continues');
  r = await claim(P1, t1);
  ok(r.s === 200 && r.j.day === d && r.j.run === d, 'Day ' + d + ' claimed');
  for (const k of Object.keys(EXP[d - 1])) assert.equal(r.j.reward[k], EXP[d - 1][k]);
  const it = (await inbox(P1, t1)).find(i => i.k === 'streak');
  ok(it && it.day === d && Object.keys(EXP[d - 1]).every(k => it[k] === EXP[d - 1][k]), 'Day ' + d + ' inbox item carries ' + JSON.stringify(EXP[d - 1]));
}

now += DAY;
r = await claim(P1, t1);
ok(r.s === 200 && r.j.day === 1 && r.j.run === 8, 'after Day 7 the cycle restarts at Day 1 and the run keeps counting');
await inbox(P1, t1);

now += 2 * DAY;                                   // one whole day missed
r = await status(P1, t1);
ok(r.j.can && r.j.broken && r.j.day === 1 && r.j.run === 0, 'a missed day: streak is broken, Day 1 again');
r = await claim(P1, t1);
ok(r.s === 200 && r.j.day === 1 && r.j.run === 1, 'claim after a miss restarts the run at 1');
now += DAY;
r = await claim(P1, t1);
ok(r.s === 200 && r.j.day === 2 && r.j.run === 2, 'and it continues the next day');
await inbox(P1, t1);

// Algeria midnight (UTC+1): 22:59 UTC is still the same Algeria day as 22:00 UTC, 23:00 UTC is already the next one
const P2 = 'usr_stk002';
const t2 = await newPlayer(P2);
now = Date.UTC(2026, 11, 10, 22, 0, 0);
r = await claim(P2, t2);
ok(r.s === 200 && r.j.day === 1, 'player 2 claims Day 1 at 23:00 Algeria time');
now = Date.UTC(2026, 11, 10, 22, 59, 30);
r = await claim(P2, t2);
ok(r.s === 409, '23:59:30 Algeria time: still the same day, refused');
r = await status(P2, t2);
ok(r.j.left > 0 && r.j.left <= 31000, 'about 30 seconds left in the Algeria day');
now = Date.UTC(2026, 11, 10, 23, 0, 5);
r = await claim(P2, t2);
ok(r.s === 200 && r.j.day === 2 && r.j.run === 2, '00:00:05 Algeria time: new day, Day 2 claimed');

// a token never works for another player
r = await claim(P1, t2);
ok(r.s === 401, "another player's token is rejected");
console.log('streak tests: all passed');
