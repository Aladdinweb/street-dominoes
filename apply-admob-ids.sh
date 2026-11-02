#!/usr/bin/env bash
# apply-admob-ids.sh - switches the app from Google's TEST ad ids to the real AdMob ids (default values in app/build.gradle.kts).
# AdMob ids are not secrets (they are visible inside every APK). The CI env vars ADMOB_APP_ID / ADMOB_BANNER / ADMOB_REWARDED still override them.
# Optional: REWARDED=ca-app-pub-XXXXXXXXXXXXXXXX/NNNNNNNNNN bash apply-admob-ids.sh   (a "Rewarded" unit; until then the rewarded test id stays)
# Run from ~/street-dominoes. SD_NO_GIT=1 skips commit/push, SD_TAG=1 also tags v1.4.1.
set -euo pipefail
cd "${SD_REPO:-$HOME/street-dominoes}"
GR=app/build.gradle.kts
APP='ca-app-pub-3991857229262724~1656760152'
BANNER='ca-app-pub-3991857229262724/3200494859'
REWARDED="${REWARDED:-}"
[ -f "$GR" ] && grep -q 'ADMOB_APP_ID' "$GR" || { echo "run apply-android-ads.sh first (no ADMOB_APP_ID in $GR)"; exit 1; }
[[ "$APP" =~ ^ca-app-pub-[0-9]{16}~[0-9]{10}$ && "$BANNER" =~ ^ca-app-pub-[0-9]{16}/[0-9]{10}$ ]] || { echo "bad id format"; exit 1; }
[ -z "$REWARDED" ] || [[ "$REWARDED" =~ ^ca-app-pub-3991857229262724/[0-9]{10}$ ]] || { echo "REWARDED must look like ca-app-pub-3991857229262724/NNNNNNNNNN"; exit 1; }
cp "$GR" "$GR.bak"; trap 'echo "FAILED - restoring"; mv "$GR.bak" "$GR"' ERR
export GR APP BANNER REWARDED
node - <<'JS'
const fs = require('fs'), f = process.env.GR; let s = fs.readFileSync(f, 'utf8');
const T = { app: 'ca-app-pub-3940256099942544~3347511713', ban: 'ca-app-pub-3940256099942544/9214589741', rew: 'ca-app-pub-3940256099942544/5224354917' };
const swap = (from, to) => { if (s.includes(to)) return; if (s.split(from).length !== 2) { console.error('ABORT: default ' + from + ' not found exactly once'); process.exit(1); } s = s.replace(from, () => to); };
swap(T.app, process.env.APP); swap(T.ban, process.env.BANNER);
if (process.env.REWARDED) swap(T.rew, process.env.REWARDED);
fs.writeFileSync(f, s);
console.log('app id + banner: real' + (process.env.REWARDED ? ', rewarded: real' : ', rewarded: still Google test id'));
JS
trap - ERR; rm -f "$GR.bak"
if [ -z "${SD_NO_GIT:-}" ]; then
  git add "$GR"; git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
  git commit -m "AdMob: real app id and banner unit${REWARDED:+, rewarded unit}"; git push
  [ -n "${SD_TAG:-}" ] && { git tag v1.4.1; git push origin v1.4.1; }
fi
echo "Done."
