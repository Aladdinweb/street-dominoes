#!/usr/bin/env bash
# apply-roadmap.sh - replaces ROADMAP.md with the new structure (phases 4-6, completed features, backlog, product rules, working agreements).
# The previous version stays in git history. Run from ~/street-dominoes. SD_NO_GIT=1 skips commit / push.
set -euo pipefail
cd "${SD_REPO:-$HOME/street-dominoes}"
[ -d .git ] || { echo "run this from the repo root"; exit 1; }
T="${TMPDIR:-$HOME/tmp}"; mkdir -p "$T"; NEW="$(mktemp "$T/roadmap.XXXXXX")"
cat > "$NEW" <<'ROADMAP_EOF'
# Street Dominoes - Project Roadmap

Developed by ILINE TECH / FERAK ALADDIN.

Read `STATE.md` for how the code works today; this file is where the project is going. Keep both files in sync whenever a feature ships (tick the box here, describe the code in `STATE.md`).

---

## 🚀 Upcoming Phases & Next Features

### Phase 4 — Smart Referral Loop & Balanced Economy (v1.5.1 / v1.6.0)
- [ ] **Initial Bonus & Deferred Referral Reward:**
  - Standard app installation grants a basic initial coins balance.
  - Installing via a referral link (`?ref=PLAYER_ID`) unlocks the full Welcome Bonus, displayed with an engaging animated popup immediately after the new player completes their first full domino round.
- [ ] **Tiered Referrer Rewards (Daily Triple Incentive):**
  - **1st Referral of the day:** High base coins reward.
  - **2nd & 3rd Referrals:** Scaled/tiered rewards to encourage completing the "Daily Trio".
  - **Daily Cap:** Enforce a strict daily referral cap server-side to prevent farming and fake account abuse.
- [ ] **Global Referral Leaderboard (`Classement`):**
  - Dedicated global ranking tab highlighting the top referrers bringing active players to the game.

> Design notes (added by Claude; delete if not wanted)
> - A `?ref=` link survives only in the browser. A sideloaded APK install loses it (the Play Install Referrer API needs a Play listing), so also add an "Enter invite code" field in the app.
> - Count a referral only when the new player has finished a round the **server** saw (an online match). Solo rounds are reported by the phone and can be faked.
> - Grant rewards through a server-side inbox that the app claims once, so the daily cap and double-claim checks live on the server. Coins themselves are still held on the phone until server-held balances exist.
> - The landing page currently forwards only `?room=` and `?link=`; it must forward `?ref=` too.

### Phase 5 — Code Protection & Production Ads (Store Polish)
- [ ] **Switch to Real Ads Mode:**
  - Execute `bash apply-admob-mode.sh real` prior to public release.
- [ ] **Production Code Obfuscation:**
  - Enable `OBFUSCATE=1` in GitHub repository variables to run `tools/obfuscate-html.mjs` on GitHub Actions builds before packaging the release APK/AAB.
- [ ] **Optional Mail & Magic Link Setup:**
  - Configure Worker secrets (`RESEND_API_KEY` & `MAIL_FROM`) to enable email-based account magic links alongside the primary `Recovery Key`.

### Phase 6 — Google Play Store Launch
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
- [ ] Themes hub (table / tile skins, material audio) and street audio emotes.
- [ ] Known gap: the leaderboard store loads every player into memory (move to SQL / D1 beyond a few thousand players).

---

## Product rules (keep when changing code)

- Palette: deep black / charcoal, rich red accents, white type. Gold only for VIP / special states (exclusive avatars, special banners).
- Coins and XP are virtual; no real money. The Boost Wheel never gives coins.
- The country picker intentionally excludes `IL` (owner decision); keep that filter.
- The server profile API only accepts emoji avatars from a whitelist: never send photo or street-avatar data to it.
- Rank points are server-owned: never let the client write them.
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
ROADMAP_EOF
[ -f ROADMAP.md ] && cmp -s "$NEW" ROADMAP.md && { echo "ROADMAP.md is already up to date"; exit 0; }
[ -f ROADMAP.md ] && cp ROADMAP.md "$T/ROADMAP.previous.md" && echo "previous version saved in $T/ROADMAP.previous.md (and in git history)"
cp "$NEW" ROADMAP.md; rm -f "$NEW"
echo "ROADMAP.md updated ($(wc -l < ROADMAP.md) lines)"
if [ -z "${SD_NO_GIT:-}" ]; then
  git add ROADMAP.md
  git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
  git commit -m "ROADMAP: referral loop, production polish, store launch; completed features and backlog"
  git push
fi
echo "Done."
