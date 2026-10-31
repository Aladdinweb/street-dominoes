// Persistent invites (v1.3.3): run with `node server/test/invites.test.mjs`. Mocks the Durable Object state, KV and FCM; no network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdinv-'));
const mjs = path.join(tmp, 'worker.mjs');
fs.copyFileSync(path.join(here, '../src/worker.js'), mjs);
const { Matchmaker } = await import(pathToFileURL(mjs).href);

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const kv = new Map();
const PLAYER_STATS = { async get(k, t) { const v = kv.get(k); return v === undefined ? null : (t === 'json' ? JSON.parse(v) : v); }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); } };
const sent = [];
globalThis.fetch = async (url, o) => {
  if (String(url).includes('oauth2.googleapis.com')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
  if (String(url).includes('fcm.googleapis.com')) { sent.push(JSON.parse(o.body).message); return { ok: true, status: 200, text: async () => '' }; }
  throw new Error('unexpected fetch ' + url);
};
let now = 1_800_000_000_000;
Date.now = () => now;

const store = new Map(); let alarmAt = null; const socks = [];
const state = {
  storage: {
    async put(k, v) { store.set(k, structuredClone(v)); }, async get(k) { const v = store.get(k); return v === undefined ? undefined : structuredClone(v); },
    async delete(k) { return store.delete(k); }, async list({ prefix }) { const m = new Map(); for (const [k, v] of store) if (k.startsWith(prefix)) m.set(k, structuredClone(v)); return m; },
    async setAlarm(t) { alarmAt = t; }, async getAlarm() { return alarmAt; },
  },
  getWebSockets: () => socks, acceptWebSocket() {},
};
const mkSock = id => { const s = { id, got: [], att: { id, st: 1, w: [] }, send(x) { s.got.push(JSON.parse(x)); }, deserializeAttachment() { return s.att; }, serializeAttachment(a) { s.att = a; } }; return s; };
const mm = new Matchmaker(state, { PLAYER_STATS, FCM_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: privateKey, project_id: 'proj' }) });
const post = (p, o) => mm.prFetch(new Request('https://pr.internal' + p, { method: 'POST', body: JSON.stringify(o) }), new URL('https://pr.internal' + p)).then(r => r.json());

const A = 'usr_aaaa1', B = 'usr_bbbb1';
kv.set('push:' + B, JSON.stringify({ tokens: ['x'.repeat(30)] }));
const SA = mkSock(A); socks.push(SA);
const inv = { kind: 'invite', from: A, name: 'Ann', av: 1, room: 'ABC123', gm: '1v1', type: 'h2h', stake: 0, turn: 0 };

// 1. invite to an offline player creates a pending record and arms the alarm
let out = await post('/_pr/invite', { inv, to: [B] });
assert.deepEqual(out.offline, [B]);
const iid = out.iids[B];
assert.match(iid, /^[\w-]{12}$/);
assert.ok(store.has('inv:' + iid));
assert.ok(alarmAt >= now + 19000 && alarmAt <= now + 21000, 'alarm armed ~20 s ahead');

// 2. the alarm repeats it as a DATA-ONLY high-priority push
now += 20001; await mm.alarm();
assert.equal(sent.length, 1);
assert.equal(sent[0].notification, undefined, 'no notification block');
assert.equal(sent[0].data.kind, 'invite'); assert.equal(sent[0].data.iid, iid); assert.equal(sent[0].data.rid, B); assert.equal(sent[0].data.rep, '1');
assert.equal(sent[0].android.priority, 'HIGH');
assert.ok(Object.values(sent[0].data).every(v => typeof v === 'string'), 'FCM data values are strings');
assert.ok(alarmAt > now, 'alarm re-armed');

// 3. the invited player opens the app: the ringing invite is shown again, later repeats go in-app (no push)
const SB = mkSock(B); socks.push(SB);
await mm.webSocketMessage(SB, JSON.stringify({ t: 'watch', ids: [] }));
const shown = SB.got.find(m => m.t === 'inv');
assert.ok(shown && shown.iid === iid && shown.rep === 1 && shown.ttl > 0);
now += 20001; await mm.alarm();
assert.equal(sent.length, 1, 'no extra push while the app is open');
assert.equal(SB.got.filter(m => m.t === 'inv').pop().rep, 2);

// 4. only the invited player can answer; a decline stops everything and tells the sender
assert.equal((await post('/_pr/respond', { iid, pid: A, ok: 1 })).ok, false);
assert.ok(store.has('inv:' + iid));
assert.equal((await post('/_pr/respond', { iid, pid: B, ok: 0 })).ok, true);
assert.equal(store.size, 0);
assert.ok(SA.got.some(m => m.t === 'invr' && m.iid === iid && m.id === B && m.ok === 0));
assert.ok(SB.got.some(m => m.t === 'invx' && m.iid === iid));
assert.equal(sent.at(-1).data.kind, 'cancel'); assert.equal(sent.at(-1).data.iid, iid);
assert.equal((await post('/_pr/respond', { iid, pid: B, ok: 1 })).ok, false, 'second answer is ignored');

// 5. an unanswered invite expires after 3 minutes everywhere
socks.splice(socks.indexOf(SB), 1);
now += 21000; out = await post('/_pr/invite', { inv, to: [B] });
const iid2 = out.iids[B];
sent.length = 0; SA.got.length = 0;
for (let i = 0; i < 12; i++) { now += 20001; await mm.alarm(); }
assert.equal(store.size, 0, 'expired invite removed');
assert.ok(sent.filter(m => m.data.kind === 'invite').length >= 6, 'it rang repeatedly');
assert.ok(SA.got.some(m => m.t === 'invr' && m.iid === iid2 && m.why === 'exp'));
assert.equal(sent.at(-1).data.kind, 'cancel');

// 6. pings stay one-off
now += 61000; out = await post('/_pr/invite', { inv: { kind: 'ping', from: A, name: 'Ann', av: 1, ping: '\u{1F44B}' }, to: [B] });
assert.equal(Object.keys(out.iids).length, 0); assert.equal(store.size, 0);

console.log('invites.test.mjs: all checks passed');
