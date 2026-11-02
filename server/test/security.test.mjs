// Accounts, recovery, report / block (v1.5.0): run with `node server/test/security.test.mjs`. Mocks the Durable Object storage and the mail API; no network.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdsec-')), mjs = path.join(tmp, 'worker.mjs');
fs.copyFileSync(path.join(here, '../src/worker.js'), mjs);
const { Matchmaker } = await import(pathToFileURL(mjs).href);
const store = new Map(); let mails = [];
globalThis.fetch = async (url, o) => { if (String(url).includes('api.resend.com')) { mails.push(JSON.parse(o.body)); return { ok: true, status: 200 }; } throw new Error('unexpected fetch ' + url); };
const state = { storage: { async put(k, v) { store.set(k, structuredClone(v)); }, async get(k) { const v = store.get(k); return v === undefined ? undefined : structuredClone(v); },
  async delete(k) { if (Array.isArray(k)) { k.forEach(x => store.delete(x)); return k.length; } return store.delete(k); },
  async list({ prefix, reverse, limit }) { let ks = [...store.keys()].filter(k => k.startsWith(prefix)).sort(); if (reverse) ks.reverse(); if (limit) ks = ks.slice(0, limit); return new Map(ks.map(k => [k, structuredClone(store.get(k))])); } }, getWebSockets: () => [] };
const mm = new Matchmaker(state, { RESEND_API_KEY: 'k', MAIL_FROM: 'Street <no-reply@example.com>', ADMIN_TOKEN: 'adm-secret' });
const op = async (o, ip = '1.1.1.1') => { const r = await mm.acctFetch(new Request('https://acct.internal/_acct/op', { method: 'POST', body: JSON.stringify({ ip, ...o }) }), new URL('https://acct.internal/_acct/op')); return { s: r.status, j: await r.json() }; };
const A = 'usr_aaaa11', B = 'usr_bbbb22';

// guest init: first claim wins, the token is stored hashed
let r = await op({ op: 'init', pid: A }); assert.equal(r.s, 200); const tokA = r.j.token; assert.ok(tokA.length >= 30);
assert.ok(![...store.values()].some(v => JSON.stringify(v).includes(tokA)), 'token is not stored in clear');
assert.equal((await op({ op: 'init', pid: A })).s, 409, 'second claim refused');
assert.equal((await op({ op: 'init', pid: 'bad id' })).s, 400);
const tokB = (await op({ op: 'init', pid: B })).j.token;

// auth is required
assert.equal((await op({ op: 'rk', pid: A, token: 'x'.repeat(30) })).s, 401);
assert.equal((await op({ op: 'rk', pid: A, token: tokB })).s, 401, 'another player token does not work');

// recovery key + snapshot + restore on a new device
r = await op({ op: 'rk', pid: A, token: tokA }); assert.match(r.j.key, /^SD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/); const key1 = r.j.key;
assert.equal((await op({ op: 'save', pid: A, token: tokA, data: { dm_set: '{"c":2900}', dm_eco: '{"xp":135}', evil: 'x' } })).s, 200);
assert.equal((await op({ op: 'save', pid: A, token: tokA, data: { dm_set: '{}' } })).s, 429, 'saves are limited to one a minute');
assert.equal((await op({ op: 'save', pid: B, token: tokB, data: { dm_set: 'x'.repeat(5000) } })).s, 413);
r = await op({ op: 'recover', key: key1.toLowerCase().replace(/-/g, ' ') }); assert.equal(r.s, 200); assert.equal(r.j.playerId, A);
assert.equal(r.j.snap.d.dm_set, '{"c":2900}'); assert.equal(r.j.snap.d.evil, undefined, 'only whitelisted keys are kept');
const tokA2 = r.j.token; assert.equal((await op({ op: 'load', pid: A, token: tokA2 })).s, 200); assert.equal((await op({ op: 'load', pid: A, token: tokA })).s, 200, 'old device still works (up to 3 devices)');
r = await op({ op: 'rk', pid: A, token: tokA2 }); assert.notEqual(r.j.key, key1);
assert.equal((await op({ op: 'recover', key: key1 })).s, 404, 'a replaced key stops working');
assert.equal((await op({ op: 'recover', key: 'SD-ZZZZ-ZZZZ' })).s, 404); assert.equal((await op({ op: 'recover', key: 'nope' })).s, 400);
for (let i = 0; i < 8; i++) await op({ op: 'recover', key: 'SD-ZZZZ-ZZZZ' }, '9.9.9.9');
assert.equal((await op({ op: 'recover', key: 'SD-ZZZZ-ZZZZ' }, '9.9.9.9')).s, 429, 'guessing is rate limited per address');

// email magic link: bind, then restore, single use
assert.equal((await op({ op: 'email', pid: A, token: tokA2, email: 'not-an-email' })).s, 400);
assert.equal((await op({ op: 'email', pid: A, token: tokA2, email: 'Ann@Example.com' })).s, 200);
let link = /\?link=([\w-]+)/.exec(mails.at(-1).html)[1]; assert.ok(mails.at(-1).to[0] === 'ann@example.com');
r = await op({ op: 'verify', link }); assert.equal(r.j.purpose, 'bind'); assert.equal(r.j.email, 'a***@example.com');
assert.equal((await op({ op: 'verify', link })).s, 410, 'link works once');
mails = []; assert.deepEqual((await op({ op: 'email-recover', email: 'nobody@example.com' })).j, { ok: true }); assert.equal(mails.length, 0, 'unknown email sends nothing but answers the same');
assert.deepEqual((await op({ op: 'email-recover', email: 'ann@example.com' })).j, { ok: true }); link = /\?link=([\w-]+)/.exec(mails.at(-1).html)[1];
r = await op({ op: 'verify', link }); assert.equal(r.j.purpose, 'recover'); assert.equal(r.j.playerId, A); assert.ok(r.j.token);
assert.equal((await op({ op: 'email', pid: B, token: tokB, email: 'ann@example.com' })).s, 200); link = /\?link=([\w-]+)/.exec(mails.at(-1).html)[1];
assert.equal((await op({ op: 'verify', link })).s, 409, 'one email, one account');

// block list: stored per player, readable by the server for matching / invites / chat
assert.equal((await op({ op: 'block', pid: A, token: tokA2, target: B, on: 1 })).j.list.join(), B);
assert.equal((await op({ op: 'block', pid: A, token: tokA2, target: A, on: 1 })).s, 400, 'cannot block yourself');
const bo = await mm.acctFetch(new Request('https://acct.internal/_acct/blocks-of', { method: 'POST', body: JSON.stringify({ pid: A }) }), new URL('https://acct.internal/_acct/blocks-of'));
assert.deepEqual((await bo.json()).list, [B]);
assert.deepEqual((await op({ op: 'block', pid: A, token: tokA2, target: B, on: 0 })).j.list, []);

// reports: stored for moderation, limited, admin-only listing
assert.equal((await op({ op: 'report', pid: A, token: tokA2, target: B, reason: 'chat', name: 'Bad<b>', chat: ['hello', 'see http://x.y/z'] })).s, 200);
assert.equal((await op({ op: 'report', pid: A, token: tokA2, target: B, reason: 'chat' })).s, 429, 'same target only once an hour');
assert.equal((await op({ op: 'report', pid: A, token: tokA2, target: B, reason: 'bogus' })).s, 400);
assert.equal((await op({ op: 'admin', admin: 'wrong' })).s, 403); assert.equal((await op({ op: 'admin', admin: '' })).s, 403);
r = await op({ op: 'admin', admin: 'adm-secret' }); assert.equal(r.j.reports.length, 1); assert.equal(r.j.reports[0].target, B); assert.ok(!r.j.reports[0].chat.join().includes('http'));
console.log('security.test.mjs: all checks passed');
