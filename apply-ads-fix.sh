#!/usr/bin/env bash
# apply-ads-fix.sh (v1.4.3)
#  1. Wheel: one FREE spin per day (no ad needed), so the wheel works before any ad has loaded; ad spins and tokens stay as they were.
#  2. Ads.kt: the "Ad not ready yet (starting ...)" message now says WHICH step is stuck: consent status / consent error / init.
# Needs apply-v1.4.0.sh, apply-android-ads.sh and apply-ads-diag.sh applied. SD_NO_GIT=1 skips commit/push, SD_TAG=1 also tags v1.4.3.
set -euo pipefail
cd "${SD_REPO:-$HOME/street-dominoes}"
KT=app/src/main/java/com/iline/streetdominoes/Ads.kt; JS=app/src/main/assets/www/sd-ads.js
for f in "$KT" "$JS"; do [ -f "$f" ] || { echo "missing $f"; exit 1; }; done
grep -q lastErr "$KT" || { echo "run apply-ads-diag.sh first"; exit 1; }
cp "$KT" "$KT.bak"; cp "$JS" "$JS.bak"; trap 'echo "FAILED - restoring"; mv "$KT.bak" "$KT"; mv "$JS.bak" "$JS"' ERR
export KT JS
node - <<'JS'
const fs = require('fs'), vm = require('vm');
const patch = (f, edits) => { let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of edits) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ABORT ' + f + ': anchor found ' + n + ' times: ' + a.slice(0, 70)); process.exit(1); } s = s.replace(a, () => b); }
  fs.writeFileSync(f, s); return s; };
let k = fs.readFileSync(process.env.KT, 'utf8');
if (!k.includes('stage =')) patch(process.env.KT, [
  ['    @Volatile private var lastErr = ""          // last rewarded load error, shown in the "not ready" message\n', '    @Volatile private var lastErr = ""          // last rewarded load error, shown in the "not ready" message\n    @Volatile private var stage = "consent"     // which start-up step we are in\n'],
  ['UserMessagingPlatform.loadAndShowConsentFormIfRequired(act) { _ -> initAds() }', 'UserMessagingPlatform.loadAndShowConsentFormIfRequired(act) { e -> if (e != null) lastErr = "form ${e.errorCode}: ${e.message}"; initAds() }'],
  ['}, { _ -> initAds() })', '}, { e -> lastErr = "consent ${e.errorCode}: ${e.message}"; initAds() })'],
  ['        if (!info.canRequestAds() || !started.compareAndSet(false, true)) return\n', '        if (!info.canRequestAds()) { stage = "consent status ${info.consentStatus}"; return }\n        if (!started.compareAndSet(false, true)) return\n        stage = "init"\n'],
  ['                    ready = true\n', '                    ready = true\n                    stage = "ready"\n'],
  ['(if (!ready) "starting" else lastErr.ifEmpty { "loading" })', '(if (!ready) "starting: " + stage + (if (lastErr.isEmpty()) "" else " / " + lastErr) else lastErr.ifEmpty { "loading" })'],
  ['Toast.LENGTH_SHORT', 'Toast.LENGTH_LONG']]);
let j = fs.readFileSync(process.env.JS, 'utf8');
if (!j.includes('S.fd')) {
  j = patch(process.env.JS, [
    ["var S={xd:'',sh:0,xb:0,tk:0,sd:'',sn:0};", "var S={xd:'',sh:0,xb:0,tk:0,sd:'',sn:0,fd:''};"],
    ["S.sd=String(o.sd||'');", "S.sd=String(o.sd||'');S.fd=String(o.fd||'');"],
    ["f.textContent=s('free')+' ('+S.tk+')';f.disabled=!S.tk||busy;", "var fc=S.tk+(S.fd!==day()?1:0);f.textContent=s('free')+' ('+fc+')';f.disabled=!fc||busy;"],
    ["f.onclick=function(){if(busy||!S.tk)return;S.tk--;save();spin()};", "f.onclick=function(){if(busy)return;if(S.fd!==day())S.fd=day();else if(S.tk>0)S.tk--;else return;save();spin()};"]]);
  try { new vm.Script(j); } catch (e) { console.error('ABORT: sd-ads.js syntax: ' + e.message); process.exit(1); }
}
console.log('Ads.kt + sd-ads.js patched');
JS
trap - ERR; rm -f "$KT.bak" "$JS.bak"
if [ -z "${SD_NO_GIT:-}" ]; then
  git add "$KT" "$JS"; git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
  git commit -m "Wheel: one free spin per day; ads: show which start-up step is stuck"; git push
  [ -n "${SD_TAG:-}" ] && { git tag v1.4.3; git push origin v1.4.3; }
fi
echo "Done."
