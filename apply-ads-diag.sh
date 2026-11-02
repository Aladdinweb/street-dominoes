#!/usr/bin/env bash
# apply-ads-diag.sh - the "Ad not ready yet" message now shows AdMob's reason, e.g. "(load 3)" = no fill, "(load 1)" = invalid ad unit, "(load 2)" = network, "(starting)" = consent / init not finished.
# Run from ~/street-dominoes. SD_NO_GIT=1 skips commit/push, SD_TAG=1 also tags v1.4.2.
set -euo pipefail
cd "${SD_REPO:-$HOME/street-dominoes}"
F=app/src/main/java/com/iline/streetdominoes/Ads.kt
[ -f "$F" ] || { echo "missing $F (apply-android-ads.sh first)"; exit 1; }
cp "$F" "$F.bak"; trap 'echo "FAILED - restoring"; mv "$F.bak" "$F"' ERR
export F
node - <<'JS'
const fs = require('fs'), f = process.env.F; let s = fs.readFileSync(f, 'utf8');
if (s.includes('lastErr')) { console.log('already patched'); process.exit(0); }
const exact = (a, b) => { const n = s.split(a).length - 1; if (n !== 1) { console.error('ABORT: anchor found ' + n + ' times: ' + a.slice(0, 60)); process.exit(1); } s = s.replace(a, () => b); };
exact('    private var loading = false\n', '    private var loading = false\n    @Volatile private var lastErr = ""          // last rewarded load error, shown in the "not ready" message\n');
exact('            override fun onAdFailedToLoad(e: LoadAdError) {\n                rewarded = null', '            override fun onAdFailedToLoad(e: LoadAdError) {\n                lastErr = "load ${e.code}"\n                rewarded = null');
exact('"Ad not ready yet, try again in a moment"', '"Ad not ready yet (" + (if (!ready) "starting" else lastErr.ifEmpty { "loading" }) + "), try again in a moment"');
fs.writeFileSync(f, s); console.log('Ads.kt patched');
JS
trap - ERR; rm -f "$F.bak"
if [ -z "${SD_NO_GIT:-}" ]; then
  git add "$F"; git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
  git commit -m "Ads: show the AdMob load error in the not-ready message"; git push
  [ -n "${SD_TAG:-}" ] && { git tag v1.4.2; git push origin v1.4.2; }
fi
echo "Done."
