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
- [x] **App: claim and apply rewards:** call `/api/rewards/claim` and add coins, shields, XP boost minutes and spins to the local wallet / `dm_sdx`; animated Welcome Bonus popup.
- [x] **Deferred Referral Reward:** `?ref=PLAYER_ID` link support (landing page forwards `?ref=`; the game calls `/api/ref/claim`), Full Welcome Bonus popup after the first server-verified online match.
- [x] **Tiered Referrer Rewards (Daily Triple Incentive):** show "x / 3 today" and the reward ladder; reward popup when a friend qualifies.
- [x] **Global Referral Leaderboard (`Classement`):** dedicated tab using `/api/referral/leaderboard`.
- [x] **Manual Invite Code Entry:** an "Enter Invite Code" field in the app settings / onboarding sheet to handle sideloaded APKs where URL query parameters are lost.
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
