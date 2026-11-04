// Referral loop + reward inbox (v1.6.0): run with `node server/test/referral.test.mjs`. Mocks the Durable Object storage; no network.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdref-')), mjs = path.join(tmp, 'worker.mjs');
fs.copyFileSync(path.join(here, '../src/worker.js'), mjs);
const { Matchmaker } = await import(pathToFileURL(mjs).href);
let now = 1_800_000_000_000; Date.now = () => now;
const store = new Map();
const state = { storage: { async put(k, v) { store.set(k, structuredClone(v)); }, async get(k) { const v = store.get(k); return v === undefined ? undefined : structuredClone(v); },
  async delete(k) { if (Array.isArray(k)) { k.forEach(x => store.delete(x)); return k.length; } return store.delete(k); },
  async list({ prefix, reverse, limit }) { let ks = [...store.keys()].filter(k => k.startsWith(prefix)).sort(); if (reverse) ks.reverse(); if (limit) ks = ks.slice(0, limit); return new Map(ks.map(k => [k, structuredClone(store.get(k))])); } }, getWebSockets: () => [] };
const mm = new Matchmaker(state, {});
let ipn = 0;
const op = async o => { const r = await mm.acctFetch(new Request('https://acct.internal/_acct/op', { method: 'POST', body: JSON.stringify({ ip: '10.0.0.' + (++ipn), ...o }) }), new URL('https://acct.internal/_acct/op')); return { s: r.status, j: await r.json() }; };
const player = async id => { const r = await op({ op: 'init', pid: id }); return r.j.token; };
const done = (...humans) => op({ op: 'match-done', humans });   // a rated online match
const inbox = async (id, tok) => (await op({ op: 'rw-list', pid: id, token: tok })).j.items;
const A = 'usr_aaaa11', tokA = await player(A);

// the basic welcome bonus arrives at install, and the invite code is the id without the prefix
let r = await op({ op: 'init', pid: 'usr_zzzz99' }); assert.equal(r.j.code, 'ZZZZ99');
let ia = await inbox(A, tokA); assert.equal(ia.length, 1); assert.equal(ia[0].k, 'welcome_basic'); assert.equal(ia[0].coins, 5000);

// claim rules
const B = 'usr_bbbb22', tokB = await player(B);
assert.equal((await op({ op: 'ref-claim', pid: B, token: tokB, code: 'BBBB22' })).s, 409, 'cannot refer yourself');
assert.equal((await op({ op: 'ref-claim', pid: B, token: tokB, code: 'NOPE00' })).s, 404, 'unknown referrer');
assert.equal((await op({ op: 'ref-claim', pid: B, token: tokB, code: '!!' })).s, 400);
assert.equal((await op({ op: 'ref-claim', pid: B, token: 'x'.repeat(30), code: 'AAAA11' })).s, 401);
r = await op({ op: 'ref-claim', pid: B, token: tokB, code: 'usr_aaaa11' }); assert.equal(r.s, 200); assert.equal(r.j.welcome, 10000);
assert.equal((await op({ op: 'ref-claim', pid: B, token: tokB, code: 'AAAA11' })).s, 409, 'only one referrer');
const old = 'usr_old001', tokOld = await player(old); const oa = store.get('a:' + old); oa.c -= 73 * 36e5; store.set('a:' + old, oa);
assert.equal((await op({ op: 'ref-claim', pid: old, token: tokOld, code: 'AAAA11' })).s, 409, 'only new accounts can be referred');

// qualification: not on a solo / unrated result, not against the referrer alone, yes against another human
await done(B); assert.equal((await op({ op: 'ref-status', pid: A, token: tokA })).j.today, 0, 'no human opponent');
await done(B, A); assert.equal((await op({ op: 'ref-status', pid: A, token: tokA })).j.today, 0, 'only the referrer as opponent does not count');
await done(B, 'usr_cccc33');
const ib = await inbox(B, tokB); assert.deepEqual(ib.map(x => x.k), ['welcome_full']); assert.equal(ib[0].coins, 10000); assert.equal(ib[0].spins, 1, 'basic bonus replaced by the full one');
ia = await inbox(A, tokA); const ref1 = ia.find(x => x.k === 'referral'); assert.equal(ref1.coins, 10000); assert.equal(ref1.shield, 1); assert.equal(ref1.tier, 1);
await done(B, 'usr_cccc33'); assert.equal((await inbox(A, tokA)).filter(x => x.k === 'referral').length, 1, 'a referee pays out once');

// 2nd and 3rd of the day, then the cap
const refs = [];
for (let i = 0; i < 4; i++) { const id = 'usr_ref' + i + '00', t = await player(id); await op({ op: 'ref-claim', pid: id, token: t, code: 'AAAA11' }); await done(id, 'usr_cccc33'); refs.push(id); }
const items = (await inbox(A, tokA)).filter(x => x.k === 'referral');
assert.equal(items.length, 3, 'max 3 rewards a day'); assert.deepEqual(items.map(x => x.coins), [10000, 15000, 25000]);
assert.equal(items[1].xpMin, 60); assert.equal(items[2].spins, 2);
const st = (await op({ op: 'ref-status', pid: A, token: tokA })).j; assert.equal(st.today, 5); assert.equal(st.total, 5, 'later referrals still count for the leaderboard');

// next day: the tiers start again
now += 864e5; { const id = 'usr_next00', t = await player(id); await op({ op: 'ref-claim', pid: id, token: t, code: 'AAAA11' }); await done(id, 'usr_cccc33'); }
assert.equal((await inbox(A, tokA)).filter(x => x.k === 'referral').at(-1).tier, 1);

// 3 rated matches against the referrer alone also qualify
{ const id = 'usr_solo01', t = await player(id); await op({ op: 'ref-claim', pid: id, token: t, code: 'AAAA11' }); await done(id, A); await done(id, A); assert.equal((await inbox(id, t)).some(x => x.k === 'welcome_full'), false); await done(id, A); assert.equal((await inbox(id, t)).some(x => x.k === 'welcome_full'), true); }

// full bonus after the basic one was already claimed pays only the difference
{ const id = 'usr_late01', t = await player(id); r = await op({ op: 'rw-claim', pid: id, token: t }); assert.equal(r.j.items[0].coins, 5000);
  await op({ op: 'ref-claim', pid: id, token: t, code: 'AAAA11' }); await done(id, 'usr_cccc33'); const w = (await inbox(id, t))[0]; assert.equal(w.k, 'welcome_full'); assert.equal(w.coins, 5000); assert.equal(w.spins, 1); }

// claiming: once only, by id, authenticated
const pend = await inbox(A, tokA); assert.ok(pend.length >= 2);
assert.equal((await op({ op: 'rw-claim', pid: A, token: tokB })).s, 401);
r = await op({ op: 'rw-claim', pid: A, token: tokA, ids: [pend[0].id] }); assert.equal(r.j.items.length, 1); assert.equal(r.j.items[0].id, pend[0].id);
r = await op({ op: 'rw-claim', pid: A, token: tokA }); assert.equal(r.j.items.length, pend.length - 1);
assert.deepEqual((await op({ op: 'rw-claim', pid: A, token: tokA })).j.items, [], 'second claim gets nothing');

// leaderboard
r = await op({ op: 'ref-lb', limit: 5 }); assert.equal(r.j.entries[0].id, A); assert.equal(r.j.entries[0].n, 8);
console.log('referral.test.mjs: all checks passed');
