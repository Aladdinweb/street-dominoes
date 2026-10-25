# Street Dominoes - Roadmap

by ILINE TECH / FERAK ALADDIN. Read `STATE.md` for how the code works today; this file is where the project is going.
Keep both files in sync whenever a feature ships (tick the box here, describe the code in `STATE.md`).

## Current status - v1.2.9 (completed, verified on a phone)

**UI / UX**
- [x] Centred glowing title; glass panels, dark charcoal + red accents, white type, scale micro-interactions
- [x] Main-menu profile card (avatar, name, flag) with a separate wallet row (coins, rank points, level); version number only in Settings
- [x] Emoji avatar grid removed: 12 Street Avatars + custom photo upload (250x250 crop, stored in localStorage; native picker on Android)
- [x] Country flag picker; active-turn pulse glow on the player HUD; localized "Pass" voice (device TTS)

**Engagement**
- [x] 24 h Daily Mystery Box with opening animation: coins, XP or one of 4 exclusive gold-ringed avatars
- [x] XP and levels (200 XP per level; +40 per match win, +15 per match loss)
- [x] Friends leaderboard by Player ID (uses the existing `/api/profile`)
- [x] Invite links: `https://street-dominoes.pages.dev/?room=CODE` auto-joins an online room

**Game**
- [x] Strict double / successor layout (stone after a double never turns; zoom first, start-point search, floor 0.45)
- [x] Online rooms, LAN host/join, WebRTC voice chat, Cloudflare Pages web build + APK releases from tags
- [x] Solo entry fee against bots (free / 100 / 500 / 1,000 / 5,000 coins; winner takes the pot)

## Phase 1 - Server side and cloud sync (shipped in v1.3.0, awaiting on-device / Cloudflare verification)

Implemented as additive patches to `server/src/worker.js`; rooms, matchmaking, voice relay and the profile API behave as before. Regression suite: `node server/test/worker.test.mjs`.

- [x] `GET /api/leaderboard?scope=daily|weekly|global&limit=50` -> `{scope,entries:[{playerId,name,avatar,rankPoints,wins,matches}],updated}`; the client Leaderboard window uses it (Global is the default tab).
- [x] Rank points are now changed only by results the server saw itself (online rooms): win +25 (+5 per blocked-round win, max +10), loss -15, floor 0, start 1000. Client-posted online results are ignored by `/api/match-result` (no double counting); solo / LAN results still count for profile stats but never change rank.
- [x] "Rated" rules: at least 2 human players; a 1v1 forfeit only counts after 2 rounds; a player who forfeits always takes the loss; max 40 rated matches per player per day.
- [x] Daily / weekly boards rank by points earned in the UTC day / ISO week (then wins); Global ranks by total rank points then wins. Stored in plain Durable Object storage (separate `lb` instance of the Matchmaker class, no `wrangler.toml` change).
- [x] Online match stakes: the entry fee (0 / 100 / 500 / 1,000 / 5,000) is part of the room (Create Room or Quick Match); quick match only pairs equal fees; joiners who cannot pay leave before the match starts; the result screen shows the rank change.
- [ ] Verify after deploy: `/api/leaderboard?scope=global`, a real two-phone rated match, a staked match, forfeit behaviour.
- [ ] Coin balances still live on each device, so stakes are consistent between players but not tamper-proof; server-held balances need accounts (Phase 4).
- [ ] Known gaps: the leaderboard store loads every player into memory (fine for thousands, move to SQL / D1 beyond that); collusion between two accounts can still farm rank (Phase 3).

## Phase 2 - Monetization (AdMob and economy)

AdMob needs the native Android SDK, so this means Kotlin work in `MainActivity.kt` plus a JS bridge. Check current AdMob / Play policies on ad placement and consent (EEA/UMP) before building.

- [ ] **Bottom banner ad** during online games, laid out outside the domino board and the zoom area (reserve the strip in CSS so the board never resizes).
- [ ] **Rewarded video - Loss Shield:** optional prompt after a match loss to avoid the coin and rank-point deduction.
- [ ] **Rewarded video - Multiplier Wheel:** spin wheel (x1.5 up to x100, weighted) after a win or a Daily Box to multiply the coin reward.
- [ ] Rewards granted only after the ad-completed callback; server-side validation once rewards touch server-held balances.

## Phase 3 - Security and anti-cheat

- [ ] **Server-authoritative game logic:** deal tiles and validate every move in the Worker / Durable Object (online already validates turns and legality; extend to all modes that count for ranking and stakes).
- [ ] **Code obfuscation:** obfuscate the JS before APK builds. This slows copying but is not security; real protection is the server-side items above.
- [ ] **Licensing / integrity:** block pirated or tampered APKs. Google Play Licensing (LVL) is the legacy route; check whether the Play Integrity API (licensing and app-integrity verdicts) is Google's current recommendation before implementing.
- [ ] Rate limits and validation already exist for profile writes and room messages; extend them to the new endpoints.

## Phase 4 - Authentication and cloud sync

- [ ] **Google Play Games Services:** one-tap sign-in on Android, achievements, leaderboard sync.
- [ ] **Email authentication:** cross-platform accounts for web / PWA players.
- [ ] Server-held coins, XP, inventory (exclusive avatars) and Daily Box timer tied to the account; migrate from the device-only `dm_*` data.
- [ ] Upload avatar photo / flag so opponents can see them (today only emoji avatars cross the wire).

## Phase 5 - IP protection and global release

- [ ] Trademark registration for "Street Dominoes" (confirm the procedure and classes with an IP professional; national office plus international options).
- [ ] Formal IP documentation: `© ILINE TECH by Ferak Aladdin` in app, store listing, repo licence / notices.
- [ ] Google Play Store publication (store listing, privacy policy, data-safety form, content rating).
- [ ] Launch marketing built around live WebRTC voice chat.

## Product rules (keep when changing code)

- Palette: deep black / charcoal, rich red accents, white type. Gold only for VIP / special states (exclusive avatars, special banners).
- Coins and XP are virtual; no real money.
- The country picker intentionally excludes `IL` (owner decision); keep that filter.
- Server profile API only accepts emoji avatars from a whitelist: never send photo or street-avatar data to it.
- Rank points are server-owned: never let the client write them.

## Working agreements (for any new chat session)

- Changes ship as `apply-vX.Y.Z.sh` patch scripts: exact-match anchors in `index.html` (abort if not exactly one match), inline-script syntax check with automatic restore, idempotent, version bump, changelog line, commit, push, tag.
- Scripts must use `$TMPDIR` (Termux has no writable `/tmp`) and run from `~/street-dominoes`.
- Tag `vX.Y.Z` builds the APK (installed apps then offer the update); a push to `main` redeploys the web build to https://street-dominoes.pages.dev; a push under `server/` redeploys the Worker.
- `app/src/main/assets/www/` is the source of truth for the web assets; `pages/` holds Pages-only files (`_headers`, manifest, mirrored copies).
- Kotlin changes cannot be compiled in the chat sandbox: the GitHub Actions APK build is the compile check, so send the log if it fails.
- Test logic with scripts first (the layout engine and the new features each have a harness), and still check on a real phone.
