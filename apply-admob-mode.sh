#!/usr/bin/env bash
# apply-admob-mode.sh test|real - switches the banner and rewarded ad UNITS in app/build.gradle.kts (the AdMob app id stays yours).
#   test: Google's official sample units: they always fill, so you can verify loading, the reward and the prize pop-up on your phone.
#   real: your own units (banner .../3200494859, rewarded .../1470067055).  NEVER publish to Play in test mode.
# Run from ~/street-dominoes. SD_NO_GIT=1 skips commit/push; the version tag is v1.4.5 (test) or v1.4.6 (real) when SD_TAG=1.
set -euo pipefail
MODE="${1:-}"; [ "$MODE" = test ] || [ "$MODE" = real ] || { echo "usage: bash apply-admob-mode.sh test|real"; exit 1; }
cd "${SD_REPO:-$HOME/street-dominoes}"
GR=app/build.gradle.kts
grep -q 'ADMOB_BANNER' "$GR" || { echo "no AdMob lines in $GR"; exit 1; }
if [ "$MODE" = test ]; then BAN='ca-app-pub-3940256099942544/9214589741'; REW='ca-app-pub-3940256099942544/5224354917'; TAG=v1.4.5
else BAN='ca-app-pub-3991857229262724/3200494859'; REW='ca-app-pub-3991857229262724/1470067055'; TAG=v1.4.6; fi
cp "$GR" "$GR.bak"; trap 'echo "FAILED - restoring"; mv "$GR.bak" "$GR"' ERR
export GR BAN REW
node - <<'JS'
const fs = require('fs'), f = process.env.GR; let s = fs.readFileSync(f, 'utf8');
const sw = (name, val) => { const re = new RegExp('(env\\("' + name + '", ")ca-app-pub-\\d{16}/\\d{10}(")'); if (!re.test(s)) { console.error('ABORT: ' + name + ' default not found'); process.exit(1); } s = s.replace(re, (m, a, b) => a + val + b); };
sw('ADMOB_BANNER', process.env.BAN); sw('ADMOB_REWARDED', process.env.REW);
fs.writeFileSync(f, s); console.log('units set');
JS
grep -n 'ADMOB_BANNER\|ADMOB_REWARDED' "$GR" | cut -c1-150
trap - ERR; rm -f "$GR.bak"
if [ -z "${SD_NO_GIT:-}" ]; then
  git add "$GR"; git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
  git commit -m "AdMob units: $MODE"; git push
  [ -n "${SD_TAG:-}" ] && { git tag "$TAG"; git push origin "$TAG"; }
fi
echo "Done ($MODE)."
