#!/usr/bin/env bash
# apply-referral-v1.6.0.sh - SERVER side of Phase 4: referral loop, reward inbox, referral leaderboard (+ new ROADMAP.md with your reward table and ideas).
# Needs apply-security-v1.5.0.sh applied. Run from ~/street-dominoes. Exact-match anchors, automatic restore, idempotent.
# SD_NO_GIT=1 skips commit / push; SD_TAG=1 also tags v1.6.0. ROADMAP.md is replaced (the old one stays in git history).
set -euo pipefail
cd "${SD_REPO:-$HOME/street-dominoes}"
WORKER=server/src/worker.js
[ -f "$WORKER" ] && grep -q 'const SEC =' "$WORKER" || { echo "apply apply-security-v1.5.0.sh first (run from the repo root)"; exit 1; }
T="${TMPDIR:-$HOME/tmp}"; mkdir -p "$T"; W="$(mktemp -d "$T/sd160.XXXXXX")"; BK="$W/bak"; export W
FILES=("$WORKER" ROADMAP.md STATE.md CHANGELOG.md server/test/referral.test.mjs)
for f in "${FILES[@]}"; do [ -f "$f" ] && { mkdir -p "$BK/$(dirname "$f")"; cp "$f" "$BK/$f"; }; done
trap 'echo "FAILED - restoring"; for f in "${FILES[@]}"; do if [ -f "$BK/$f" ]; then cp "$BK/$f" "$f"; else rm -f "$f"; fi; done' ERR
cat > "$W/consts.js" <<'PAYLOAD_EOF'
// ---------- v1.6.0: referral loop + reward inbox ----------
// Rewards are never added by the phone on its own: the server puts them in an inbox ('ib:<pid>') and the app claims each item exactly once (POST /api/rewards/claim).
// A referral "qualifies" when the new player finishes a RATED online match (>= 2 humans) AFTER entering the code, and either played a human other than the referrer or has 3 rated matches.
const REF = { BASIC: 5000, FULL: 10000, FULL_SPINS: 1, AGE_MAX: 72 * 36e5, CLAIMS_PER_IP: 5, DAY_MS: 864e5, TZ: 36e5,   // TZ: the "day" changes at midnight Algeria time (UTC+1)
  TIERS: [{ coins: 10000, shield: 1 }, { coins: 15000, xpMin: 60 }, { coins: 25000, spins: 2 }] };      // 1st / 2nd / 3rd qualified referral of the day; the 4th and later only count for the leaderboard
const refCode = pid => String(pid).slice(4).toUpperCase();
const normRef = c => { const id = 'usr_' + String(c || '').trim().toLowerCase().replace(/^usr[_-]?/, ''); return validId(id) ? id : ''; };
const refDay = () => Math.floor((Date.now() + REF.TZ) / REF.DAY_MS);
PAYLOAD_EOF
cat > "$W/methods.js" <<'PAYLOAD_EOF'
  // ---- v1.6.0 referral loop / reward inbox ----
  async give(pid, item) {
    const S = this.state.storage, ib = (await S.get('ib:' + pid)) || { items: [], done: [] };
    ib.items.push({ id: Date.now().toString(36) + b64u(crypto.getRandomValues(new Uint8Array(3))), at: Date.now(), ...item });
    ib.items = ib.items.slice(-50); await S.put('ib:' + pid, ib);
  }
  async giveWelcomeFull(pid) {        // the full welcome bonus replaces the basic one; if the basic one was already claimed only the difference is paid
    const S = this.state.storage, wb = (await S.get('wb:' + pid)) || {};
    if (wb.full) return;
    wb.full = 1; await S.put('wb:' + pid, wb);
    const ib = (await S.get('ib:' + pid)) || { items: [], done: [] };
    ib.items = ib.items.filter(x => x.k !== 'welcome_basic'); await S.put('ib:' + pid, ib);
    await this.give(pid, { k: 'welcome_full', coins: REF.FULL - (wb.basicClaimed ? REF.BASIC : 0), spins: REF.FULL_SPINS });
  }
  async rewardReferrer(by) {
    const S = this.state.storage, day = refDay();
    let rd = await S.get('rd:' + by); if (!rd || rd.d !== day) rd = { d: day, n: 0 };
    rd.n++; await S.put('rd:' + by, rd);
    const total = ((await S.get('rt:' + by)) || 0) + 1; await S.put('rt:' + by, total);
    const lb = ((await S.get('rlb')) || []).filter(x => x.id !== by); lb.push({ id: by, n: total }); lb.sort((a, b) => b.n - a.n); await S.put('rlb', lb.slice(0, 100));
    const tier = REF.TIERS[rd.n - 1];
    if (tier) await this.give(by, { k: 'referral', tier: rd.n, ...tier });
  }
PAYLOAD_EOF
cat > "$W/cases.js" <<'PAYLOAD_EOF'
      case 'ref-claim': {      // the new player enters an invite code (link ?ref=ID or typed): referrer id or its short code
        const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401);
        const by = normRef(q.code);
        if (!by) return R({ error: 'bad_code' }, 400);
        if (by === pid) return R({ error: 'self' }, 409);
        if (!this.rlOk('rfc:' + ip, REF.CLAIMS_PER_IP, REF.DAY_MS) || !this.rlOk('rfc:' + pid, 5, 36e5)) return R({ error: 'rate' }, 429);
        if (Date.now() - a.c > REF.AGE_MAX) return R({ error: 'too_old' }, 409);
        if (!(await S.get('a:' + by))) return R({ error: 'unknown' }, 404);
        if (await S.get('rf:' + pid)) return R({ error: 'already' }, 409);
        await S.put('rf:' + pid, { by, at: Date.now(), st: 'pending' });
        return R({ ok: true, state: 'pending', welcome: REF.FULL, spins: REF.FULL_SPINS });
      }
      case 'ref-status': {
        const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401);
        const rf = await S.get('rf:' + pid), rd = await S.get('rd:' + pid);
        return R({ ok: true, code: refCode(pid), by: rf ? rf.by : null, state: rf ? rf.st : null, today: rd && rd.d === refDay() ? rd.n : 0, cap: REF.TIERS.length, total: (await S.get('rt:' + pid)) || 0, tiers: REF.TIERS });
      }
      case 'rw-list': { const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401); const ib = await S.get('ib:' + pid); return R({ ok: true, items: (ib && ib.items) || [] }); }
      case 'rw-claim': {       // each item can be claimed once; only storage calls between the read and the write, so two taps cannot both succeed
        const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401);
        const ib = (await S.get('ib:' + pid)) || { items: [], done: [] }, want = Array.isArray(q.ids) ? q.ids.map(String) : null;
        const take = ib.items.filter(x => !want || want.includes(x.id));
        if (!take.length) return R({ ok: true, items: [] });
        ib.items = ib.items.filter(x => !take.includes(x)); ib.done = [...ib.done, ...take.map(x => x.id)].slice(-50); await S.put('ib:' + pid, ib);
        if (take.some(x => x.k === 'welcome_basic')) { const wb = (await S.get('wb:' + pid)) || {}; wb.basicClaimed = 1; await S.put('wb:' + pid, wb); }
        return R({ ok: true, items: take });
      }
      case 'ref-lb': { const l = (await S.get('rlb')) || []; return R({ ok: true, entries: l.slice(0, Math.min(100, +q.limit || 50)) }); }
      case 'match-done': {     // internal (GameRoom.doRecord): humans of a RATED online match
        const hs = (Array.isArray(q.humans) ? q.humans : []).filter(validId);
        for (const id of hs) {
          const n = ((await S.get('pm:' + id)) || 0) + 1; await S.put('pm:' + id, n);
          const rf = await S.get('rf:' + id);
          if (!rf || rf.st !== 'pending') continue;
          if (!(hs.some(h => h !== id && h !== rf.by) || n >= 3)) continue;   // needs a human other than the referrer, or 3 rated matches
          rf.st = 'done'; rf.q = Date.now(); await S.put('rf:' + id, rf);
          await this.giveWelcomeFull(id); await this.rewardReferrer(rf.by);
        }
        return R({ ok: true });
      }
PAYLOAD_EOF
cat > "$W/referral.test.mjs" <<'PAYLOAD_EOF'
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
PAYLOAD_EOF
cat > "$W/ROADMAP.new.md" <<'PAYLOAD_EOF'
# Street Dominoes - Project Roadmap

Developed by ILINE TECH / FERAK ALADDIN.

Read `STATE.md` for how the code works today; this file is where the project is going. Keep both files in sync whenever a feature ships (tick the box here, describe the code in `STATE.md`).

---

## 🚀 Upcoming Phases & Next Features

### Phase 4 — Smart Referral Loop & Economy (v1.6.0)

**Reward table (decided)**

| Event | Reward |
|---|---|
| New install, no referral (Base Welcome Bonus) | 5,000 coins |
| New install via referral link or code (Full Welcome Bonus, after the first server-verified online match) | 10,000 coins + 1 free Boost Wheel spin (replaces the base bonus; if the base bonus was already claimed, the difference is paid) |
| Referrer, 1st qualified referral of the day | 10,000 coins + 1x Loss Shield |
| Referrer, 2nd qualified referral of the day | 15,000 coins + 1x XP Booster x2 (1 hour) |
| Referrer, 3rd qualified referral of the day | 25,000 coins + 2x Boost Wheel spins |
| Referrer, 4th and later | No payout; counts for the referral leaderboard only (daily cap: 3 rewards) |

The "day" changes at midnight Algeria time (UTC+1). A referral is **qualified** when the new player finishes a rated online match (at least 2 humans) after entering the code, and either played a human other than the referrer or has 3 rated matches. New accounts only (72 hours), one referrer per account.

- [x] **Server: referral engine and reward inbox** (`/api/ref/claim`, `/api/ref/status`, `/api/rewards`, `/api/rewards/claim`, `/api/referral/leaderboard`; qualification hooked into the rated-match result; tests in `server/test/referral.test.mjs`).
- [ ] **App: claim and apply rewards:** call `/api/rewards/claim` and add coins, shields, XP boost minutes and spins to the local wallet / `dm_sdx`; animated Welcome Bonus popup.
- [ ] **Deferred Referral Reward:** `?ref=PLAYER_ID` link support (landing page forwards `?ref=`; the game calls `/api/ref/claim`), Full Welcome Bonus popup after the first server-verified online match.
- [ ] **Tiered Referrer Rewards (Daily Triple Incentive):** show "x / 3 today" and the reward ladder; reward popup when a friend qualifies.
- [ ] **Global Referral Leaderboard (`Classement`):** dedicated tab using `/api/referral/leaderboard`.
- [ ] **Manual Invite Code Entry:** an "Enter Invite Code" field in the app settings / onboarding sheet to handle sideloaded APKs where URL query parameters are lost.
- [ ] **First-Win Moment & Guided Onboarding:** a brief 2-move guided tutorial for brand-new players, followed by the animated Welcome Bonus popup after their first match win.
- [ ] **Daily Login Streak (7-Day Rewards):** Day 1 to 6 grant coins/XP, Day 7 grants a free Boost Wheel Spin to drive daily retention (issue through the same server inbox).

> Design notes (added by Claude; delete if not wanted)
> - A `?ref=` link survives only in the browser. A sideloaded APK install loses it (the Play Install Referrer API needs a Play listing), hence the manual code field.
> - Rewards come from a server inbox that the app claims once; coins themselves are still held on the phone until server-held balances exist (see Backlog).
> - Farming limits today: 3 paid referrals a day per referrer, rated 2-human matches only, new accounts only, 5 code claims a day per address. Two accounts played by the same person can still cycle rewards; real protection needs verified accounts (Play Integrity or login).
> - Accounts that existed before v1.6.0 did not get the base welcome bonus.

### Phase 5 — Engagement & Social Features
- [ ] **Rematch & Friend Rivalry:** instant "Rematch" button at game end and a persistent H2H (head-to-head) win/loss counter against friends.
- [ ] **Rate-the-App Prompt:** shown once only, after a match victory (never on a loss).
- [ ] **Street Audio Emotes:** quick audio taunts/emotes during live matches using the WebRTC channel.

### Phase 6 — Monetization Hub & Customization
- [ ] **Skins & Themes Shop:** spend coins on custom domino tile backings and street-themed table mats.
- [ ] **Weekly Leaderboard Prizes:** the top 3 players of the weekly leaderboard earn exclusive golden avatars and VIP badges.

### Phase 7 — Code Protection & Production Ads (Store Polish)
- [ ] **Switch to Real Ads Mode:**
  - Execute `bash apply-admob-mode.sh real` prior to public release.
- [ ] **Production Code Obfuscation:**
  - Enable `OBFUSCATE=1` in GitHub repository variables to run `tools/obfuscate-html.mjs` on GitHub Actions builds before packaging the release APK/AAB.
- [ ] **Optional Mail & Magic Link Setup:**
  - Configure Worker secrets (`RESEND_API_KEY` & `MAIL_FROM`) to enable email-based account magic links alongside the primary `Recovery Key`.

### Phase 8 — Google Play Store Launch
- [ ] **AdMob Store Linking:**
  - Link the published Google Play store URL inside the AdMob dashboard to trigger store review and active ad serving.
- [ ] **Privacy & Data Safety Compliance:**
  - Finalize the privacy policy and Google Play Data Safety form.

---

## ✅ Completed Features (as of v1.5.0)

### UI / UX & Audio
- [x] Dark charcoal aesthetic, red glows, white typography, and polished CSS transitions.
- [x] Profile card, wallet counters, custom avatars grid, and native file cropper integration.
- [x] Country flag selector with custom excluded regions (e.g., `IL`).
- [x] Turn indicator pulse, voice chat (WebRTC), and TTS pass speech announcements.

### Engagement & Game Modes
- [x] 24h Daily Mystery Box, Boost Wheel (XP Boosters x2, Loss Shields), and Speed Mode.
- [x] Bot Play with tiered entry fees (Free / 100 / 500 / 1k / 5k coins) with winner-takes-all logic.
- [x] Online Friends, LAN Multiplayer, Direct Room Link Invites (`?room=CODE`), and Native FCM Push Notifications.

### Security, Accounts & Moderation (v1.5.0)
- [x] **Account Recovery:** Device-bound hash tokens, Cloudflare Durable Objects data sync, and unique `SD-XXXX-XXXX` recovery keys.
- [x] **Report & Block Tools:** Moderation endpoints (`/api/admin/reports`), in-game report/block sheet, voice mute, and matchmaking/chat filtering for blocked users.

---

## 📌 Backlog (carried over from the previous roadmap, not scheduled)
- [ ] Server-authoritative game logic for every mode that counts for ranking or stakes (online rooms already validate moves).
- [ ] Require the account token on `/api/match-result`, WebSocket joins and invites (today they trust the player id).
- [ ] Server-held coins, XP and inventory tied to the account (the cloud snapshot is client-reported).
- [ ] Upload avatar photo / flag so opponents can see them (only emoji avatars cross the wire today).
- [ ] Google Play Games sign-in and Play Integrity / licensing (both need a Play Console account).
- [ ] Trademark registration for "Street Dominoes" and formal IP notices (`© ILINE TECH by Ferak Aladdin`).
- [ ] Launch marketing built around live WebRTC voice chat.
- [ ] Known gap: the leaderboard store loads every player into memory (move to SQL / D1 beyond a few thousand players).

---

## Product rules (keep when changing code)

- Palette: deep black / charcoal, rich red accents, white type. Gold only for VIP / special states (exclusive avatars, special banners).
- Coins and XP are virtual; no real money. The Boost Wheel never gives coins.
- The country picker intentionally excludes `IL` (owner decision); keep that filter.
- The server profile API only accepts emoji avatars from a whitelist: never send photo or street-avatar data to it.
- Rank points are server-owned: never let the client write them.
- Referral and welcome rewards come only from the server inbox (`/api/rewards/claim`); the client never creates them itself.
- The profile name / avatar come from `ME` (`dm_me`), never from the `names` / `avs` arrays (those hold the current table's seats).
- Secrets (`FCM_SERVICE_ACCOUNT`, `TURN_*`, `ADMIN_TOKEN`, `RESEND_API_KEY`, keystore, account tokens) live in Cloudflare / GitHub secrets, never in the repo or in chat. AdMob ids are not secrets.
- Rewards from ads are granted only after the rewarded-ad callback says it was earned.
- Before any public build: ad units must be the real ones (`bash apply-admob-mode.sh real`), never Google's test units.

## Working agreements (for any new chat session)

- Changes ship as `apply-vX.Y.Z.sh` patch scripts: exact-match anchors (abort if not exactly one match), syntax checks with automatic restore, idempotent, docs updated, commit, push, tag.
- Scripts must use `$TMPDIR` (Termux has no writable `/tmp`) and run from `~/street-dominoes`.
- Tag `vX.Y.Z` builds the APK (installed apps then offer the update); a push to `main` redeploys the web build to https://street-dominoes.pages.dev (landing at `/`, game at `/play`); a push under `server/` redeploys the Worker.
- `app/src/main/assets/www/` is the source of truth for the game; `landing/index.html` for the landing page; `pages/` holds Pages-only files (`_headers`, manifest, icons).
- Kotlin changes cannot be compiled in the chat sandbox: the GitHub Actions APK build is the compile check, so send the log if it fails.
- Test logic with scripts first (`node server/test/*.test.mjs`), and still check on a real phone.
PAYLOAD_EOF
cat > "$W/docs_state.md" <<'PAYLOAD_EOF'

<!-- sd160 -->
## 21. v1.6.0 (server): referral loop and reward inbox
- Rewards are issued by the server, never created by the phone: `ib:<pid>` inbox in the `acct` Durable Object (items `{id,k,at,coins?,shield?,xpMin?,spins?,tier?}`, kinds `welcome_basic` 5,000 coins, `welcome_full` 10,000 + 1 spin, `referral` tiers). `POST /api/rewards/claim {playerId, ids?}` returns and removes items (atomic: only storage calls between read and write); `GET /api/rewards?playerId=` lists. The app must add coins, shield (`dm_sdx.sh`, cap 3), XP boost minutes (`xb`, cap 120 min) and spins (`tk`, cap 9) once per claimed item.
- `POST /api/auth/init` now also creates the `welcome_basic` item and returns `code` (the player id without `usr_`, upper case; links use `?ref=usr_xxxxxx`, both accepted). `POST /api/ref/claim {playerId, code}`: account younger than 72 h, one referrer per account, not yourself, referrer must exist, 5 claims a day per address; state `pending`. `GET /api/ref/status?playerId=` returns code, referrer, state, `today` (qualified referrals counted today), cap 3, total, tiers.
- Qualification: `GameRoom.doRecord` calls `/_acct/op` `match-done` for every RATED online match (>= 2 humans, forfeiters excluded). A pending referee qualifies when the match had a human other than the referrer, or at their 3rd rated match. Then: `welcome_full` replaces an unclaimed `welcome_basic` (or pays 10,000 - 5,000 if the base bonus was already claimed) and the referrer gets tier n of the day (1: 10,000 + shield, 2: 15,000 + XP x2 60 min, 3: 25,000 + 2 spins); the 4th and later only raise the counter. The day changes at midnight UTC+1 (`REF.TZ`).
- `GET /api/referral/leaderboard?limit=` (public): top referrers (`rlb`, top 100 kept) with name / avatar from the KV profile.
- Constants: `REF` in `worker.js`. Tests: `node server/test/referral.test.mjs`. Not built yet: the app side (claim + popups, invite-code field, `?ref=` handling, leaderboard tab), accounts that existed before v1.6.0 got no base welcome bonus.
PAYLOAD_EOF
export WORKER
node - <<'JS'
const fs = require('fs'), path = require('path');
const W = process.env.W, P = n => fs.readFileSync(path.join(W, n), 'utf8').replace(/\n$/, '');
const die = m => { console.error('ABORT: ' + m); process.exit(1); };
const cnt = (s, f) => s.split(f).length - 1;
const exact = (s, tag, a, b) => { const n = cnt(s, a); if (n !== 1) die(tag + ': anchor found ' + n + ' times (need 1): ' + a.slice(0, 80)); return s.replace(a, () => b); };
const rd = f => { const s = fs.readFileSync(f, 'utf8'); if (s.includes('\r\n')) die(f + ' uses CRLF'); return s; };
{
  const f = process.env.WORKER; let s = rd(f);
  if (!s.includes('const REF =')) {
    s = exact(s, 'consts', 'const hex = buf =>', P('consts.js') + '\nconst hex = buf =>');
    s = exact(s, 'routes.post', "'/api/report': 'report', '/api/block': 'block' };", "'/api/report': 'report', '/api/block': 'block', '/api/ref/claim': 'ref-claim', '/api/rewards/claim': 'rw-claim' };");
    s = exact(s, 'routes.get', "    else if (p === '/api/admin/reports') { op = 'admin'; payload = { limit: url.searchParams.get('limit') }; }",
      "    else if (p === '/api/admin/reports') { op = 'admin'; payload = { limit: url.searchParams.get('limit') }; }\n    else if (p === '/api/ref/status') { op = 'ref-status'; payload = { pid: url.searchParams.get('playerId') }; }\n    else if (p === '/api/rewards') { op = 'rw-list'; payload = { pid: url.searchParams.get('playerId') }; }\n    else if (p === '/api/referral/leaderboard') { op = 'ref-lb'; payload = { limit: url.searchParams.get('limit') }; }");
    s = exact(s, 'routes.api', "['/api/report', '/api/block', '/api/blocks', '/api/admin/reports'].includes(url.pathname)", "['/api/report', '/api/block', '/api/blocks', '/api/admin/reports', '/api/ref/claim', '/api/ref/status', '/api/rewards', '/api/rewards/claim', '/api/referral/leaderboard'].includes(url.pathname)");
    s = exact(s, 'secApi.return', "  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });",
      "  let body = await r.text();\n  if (op === 'ref-lb' && r.ok && env.PLAYER_STATS) {      // names / avatars come from the KV profiles\n    try { const j = JSON.parse(body); j.entries = await Promise.all(j.entries.map(async e => { const pr = await env.PLAYER_STATS.get('profile:' + e.id, 'json'); return { playerId: e.id, count: e.n, name: (pr && pr.name) || 'Player', avatar: (pr && pr.avatar) || '' }; })); body = JSON.stringify(j); } catch (err) {}\n  }\n  return new Response(body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });");
    s = exact(s, 'init', "return R({ ok: true, token: await this.issue(pid, { th: [], c: Date.now() }) });", "const token = await this.issue(pid, { th: [], c: Date.now() });\n        await this.give(pid, { k: 'welcome_basic', coins: REF.BASIC });       // v1.6.0: basic welcome bonus, claimed by the app once\n        return R({ ok: true, token, code: refCode(pid) });");
    s = exact(s, 'methods', '  async acctFetch(req, u) {', P('methods.js') + '\n  async acctFetch(req, u) {');
    s = exact(s, 'cases', "      default: return R({ error: 'not_found' }, 404);", P('cases.js') + "\n      default: return R({ error: 'not_found' }, 404);");
    s = exact(s, 'hook', '    const rk = {};\n    await Promise.all(rows.map(async (r, i) => {', "    if (rated && env.MATCH) {      // v1.6.0: referral qualification + inbox rewards (instance 'acct')\n      try { await env.MATCH.get(env.MATCH.idFromName('acct')).fetch('https://acct.internal/_acct/op', { method: 'POST', body: JSON.stringify({ op: 'match-done', humans: rows.filter(r => !r.s.fn).map(r => r.id) }) }); } catch (e) {}\n    }\n    const rk = {};\n    await Promise.all(rows.map(async (r, i) => {");
    fs.writeFileSync(f, s); console.log('worker.js patched');
  } else console.log('worker.js already patched');
}
fs.mkdirSync('server/test', { recursive: true }); fs.writeFileSync('server/test/referral.test.mjs', fs.readFileSync(path.join(W, 'referral.test.mjs'), 'utf8'));
fs.writeFileSync('ROADMAP.md', fs.readFileSync(path.join(W, 'ROADMAP.new.md'), 'utf8')); console.log('ROADMAP.md replaced');
const add = (f, fn) => { if (fs.existsSync(f)) { const s = rd(f); if (!s.includes('v1.6.0')) fs.writeFileSync(f, fn(s)); } };
add('STATE.md', s => s.replace(/\s*$/, '\n') + P('docs_state.md') + '\n');
add('CHANGELOG.md', s => s.replace(/\s*$/, '\n') + '\n## 1.6.0 (server)\n- Referral loop: invite codes, welcome bonuses, tiered daily referrer rewards, referral leaderboard.\n- Reward inbox: the server issues rewards, the app claims each once.\n');
console.log('patched OK');
JS
cp "$WORKER" "$W/worker-check.mjs" && node --check "$W/worker-check.mjs"
for t in security invites referral; do [ -f "server/test/$t.test.mjs" ] && node "server/test/$t.test.mjs"; done
[ -f server/test/worker.test.mjs ] && node server/test/worker.test.mjs
trap - ERR
if [ -z "${SD_NO_GIT:-}" ]; then
  git add -A
  git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
  git commit -m "v1.6.0 (server): referral loop, reward inbox, referral leaderboard; new roadmap"
  git push
  [ -n "${SD_TAG:-}" ] && { git tag v1.6.0; git push origin v1.6.0; }
fi
echo "Done. Server deploys from the push (wrangler). The app side of Phase 4 (claim + popups, invite code field, ?ref= handling, leaderboard tab) is the next patch."
