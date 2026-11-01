#!/usr/bin/env bash
# apply-android-ads.sh - AdMob for the Android app: consent (UMP), bottom adaptive banner, rewarded ads, bridge to www/sd-ads.js
# Needs apply-v1.4.0.sh applied first (the page side). Uses Google TEST ad ids unless ADMOB_APP_ID / ADMOB_BANNER / ADMOB_REWARDED are set at build time.
# Run from ~/street-dominoes. Exact-match anchors, automatic restore, idempotent. SD_NO_GIT=1 skips commit/push, SD_TAG=1 also tags v1.4.0.
set -euo pipefail
cd "${SD_REPO:-$HOME/street-dominoes}"
KT=app/src/main/java/com/iline/streetdominoes
MA=$KT/MainActivity.kt; GR=app/build.gradle.kts; MF=app/src/main/AndroidManifest.xml
for f in "$MA" "$GR" "$MF" app/src/main/assets/www/sd-ads.js; do [ -f "$f" ] || { echo "missing $f (apply-v1.4.0.sh first? run from the repo root)"; exit 1; }; done
T="${TMPDIR:-$HOME/tmp}"; mkdir -p "$T"; BK="$(mktemp -d "$T/sdads.XXXXXX")"
FILES=("$MA" "$GR" "$MF" "$KT/Ads.kt" STATE.md ROADMAP.md CHANGELOG.md)
for f in "${FILES[@]}"; do [ -f "$f" ] && { mkdir -p "$BK/$(dirname "$f")"; cp "$f" "$BK/$f"; }; done
trap 'echo "FAILED - restoring"; for f in "${FILES[@]}"; do if [ -f "$BK/$f" ]; then cp "$BK/$f" "$f"; else rm -f "$f"; fi; done' ERR
cat > "$KT/Ads.kt" <<'ADS_KT'
package com.iline.streetdominoes

import android.app.Activity
import android.view.Gravity
import android.view.View
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * AdMob for the web game (page side: www/sd-ads.js).
 *  - consent first (Google UMP; only shows a form where the AdMob console has one, e.g. EEA), then MobileAds.initialize
 *  - bottom adaptive banner drawn over the WebView; the page reserves the same height (window.onBannerState) so nothing is covered
 *  - rewarded ads: preloaded, result reported with window.onAdResult(id, earned); the page grants rewards only when earned is true
 * Ad unit ids come from BuildConfig (Google test ids unless real ones are passed at build time).
 */
class Ads(private val act: Activity, private val web: WebView, private val host: FrameLayout) {
    private val info = UserMessagingPlatform.getConsentInformation(act)
    private val started = AtomicBoolean(false)
    @Volatile private var ready = false
    private var banner: AdView? = null
    private var bannerH = 0
    private var wantBanner = false
    private var rewarded: RewardedAd? = null
    private var loading = false

    val supported: Boolean get() = ready

    fun start() {
        info.requestConsentInfoUpdate(act, ConsentRequestParameters.Builder().build(), {
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(act) { _ -> initAds() }
        }, { _ -> initAds() })
        initAds()   // consent from an earlier session may already allow ads
    }

    private fun initAds() {
        if (!info.canRequestAds() || !started.compareAndSet(false, true)) return
        Thread {
            MobileAds.initialize(act) {
                act.runOnUiThread {
                    ready = true
                    loadRewarded()
                    if (wantBanner) showBanner()
                }
            }
        }.start()
    }

    private fun report(h: Int) {
        act.runOnUiThread { web.evaluateJavascript("window.onBannerState&&window.onBannerState($h)", null) }
    }

    private fun result(id: String, ok: Boolean) {
        act.runOnUiThread { web.evaluateJavascript("window.onAdResult&&window.onAdResult(${JSONObject.quote(id)},$ok)", null) }
    }

    // ---- banner ----
    fun showBanner() {
        wantBanner = true
        if (!ready) return
        act.runOnUiThread {
            val v = banner
            if (v == null) {
                val dm = act.resources.displayMetrics
                val size = AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(act, (dm.widthPixels / dm.density).toInt())
                val nv = AdView(act)
                nv.setAdSize(size)
                nv.adUnitId = BuildConfig.ADMOB_BANNER
                nv.adListener = object : AdListener() {
                    override fun onAdLoaded() { bannerH = size.height; if (wantBanner) report(bannerH) }
                    override fun onAdFailedToLoad(e: LoadAdError) {
                        bannerH = 0
                        report(0)
                        host.postDelayed({ if (wantBanner) banner?.loadAd(AdRequest.Builder().build()) }, 60_000)
                    }
                }
                host.addView(nv, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL))
                banner = nv
                nv.loadAd(AdRequest.Builder().build())
            } else {
                v.visibility = View.VISIBLE
                v.resume()
                if (bannerH > 0) report(bannerH)
            }
        }
    }

    fun hideBanner() {
        wantBanner = false
        act.runOnUiThread {
            banner?.visibility = View.GONE
            banner?.pause()
            report(0)
        }
    }

    // ---- rewarded ----
    private fun loadRewarded() {
        if (!ready || loading || rewarded != null) return
        loading = true
        RewardedAd.load(act, BuildConfig.ADMOB_REWARDED, AdRequest.Builder().build(), object : RewardedAdLoadCallback() {
            override fun onAdLoaded(ad: RewardedAd) { rewarded = ad; loading = false }
            override fun onAdFailedToLoad(e: LoadAdError) {
                rewarded = null
                loading = false
                host.postDelayed({ loadRewarded() }, 30_000)
            }
        })
    }

    fun showRewarded(id: String) {
        act.runOnUiThread {
            val ad = rewarded
            if (ad == null) {
                Toast.makeText(act, "Ad not ready yet, try again in a moment", Toast.LENGTH_SHORT).show()
                loadRewarded()
                result(id, false)
                return@runOnUiThread
            }
            rewarded = null
            var earned = false
            ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                override fun onAdDismissedFullScreenContent() { result(id, earned); loadRewarded() }
                override fun onAdFailedToShowFullScreenContent(e: AdError) { result(id, false); loadRewarded() }
            }
            ad.show(act) { earned = true }
        }
    }

    fun pause() { banner?.pause() }
    fun resume() { if (wantBanner) banner?.resume() }
    fun destroy() { banner?.destroy(); banner = null }
}
ADS_KT
export MA GR MF
node - <<'JS'
const fs = require('fs');
const die = m => { console.error('ABORT: ' + m); process.exit(1); };
const cnt = (s, f) => s.split(f).length - 1;
const exact = (s, tag, a, b) => { const n = cnt(s, a); if (n !== 1) die(tag + ': anchor found ' + n + ' times (need 1): ' + a.slice(0, 80)); return s.replace(a, () => b); };
// ---- MainActivity.kt
{
  const f = process.env.MA; let s = fs.readFileSync(f, 'utf8');
  if (!s.includes('private var ads: Ads?')) {
    s = exact(s, 'field', '    private lateinit var web: WebView', '    private lateinit var web: WebView\n    private var ads: Ads? = null                    // AdMob (banner + rewarded), see Ads.kt');
    s = exact(s, 'content', '        setContentView(web)',
      '        val host = android.widget.FrameLayout(this)   // the banner is drawn over the bottom of the WebView; the page reserves the same height\n        host.addView(web, android.widget.FrameLayout.LayoutParams(android.widget.FrameLayout.LayoutParams.MATCH_PARENT, android.widget.FrameLayout.LayoutParams.MATCH_PARENT))\n        setContentView(host)\n        ads = Ads(this, web, host).also { it.start() }');
    s = exact(s, 'resume', 'override fun onResume() { super.onResume(); isForeground = true }', 'override fun onResume() { super.onResume(); isForeground = true; ads?.resume() }');
    s = exact(s, 'pause', 'override fun onPause() { isForeground = false; super.onPause() }', 'override fun onPause() { isForeground = false; ads?.pause(); super.onPause() }');
    s = exact(s, 'destroy', 'if (current === this) current = null', 'if (current === this) current = null\n        ads?.destroy()');
    s = exact(s, 'bridge', '        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME',
      '        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME\n        // ---- ads (page side: www/sd-ads.js) ----\n        @JavascriptInterface fun adsSupported(): Boolean = ads?.supported == true\n        @JavascriptInterface fun showRewarded(id: String) { val a = ads; if (a != null) a.showRewarded(id) else jsCall("onAdResult", JSONObject.quote(id) + ",false") }\n        @JavascriptInterface fun bannerShow() { ads?.showBanner() }\n        @JavascriptInterface fun bannerHide() { ads?.hideBanner() }');
    fs.writeFileSync(f, s); console.log('MainActivity.kt patched');
  } else console.log('MainActivity.kt already patched');
}
// ---- app/build.gradle.kts
{
  const f = process.env.GR; let s = fs.readFileSync(f, 'utf8');
  if (!s.includes('play-services-ads')) {
    if (!s.includes('firebase-messaging')) die('app/build.gradle.kts is not the v1.3.2+ file (no firebase-messaging line)');
    s = exact(s, 'gradle.fields', '        buildConfigField("String", "REPO", "\\"Aladdinweb/street-dominoes\\"")',
      '        buildConfigField("String", "REPO", "\\"Aladdinweb/street-dominoes\\"")\n        // AdMob: Google\'s public TEST ids by default; pass the real ones with env ADMOB_APP_ID / ADMOB_BANNER / ADMOB_REWARDED\n        manifestPlaceholders["admobAppId"] = env("ADMOB_APP_ID", "ca-app-pub-3940256099942544~3347511713")\n        buildConfigField("String", "ADMOB_BANNER", "\\"" + env("ADMOB_BANNER", "ca-app-pub-3940256099942544/9214589741") + "\\"")\n        buildConfigField("String", "ADMOB_REWARDED", "\\"" + env("ADMOB_REWARDED", "ca-app-pub-3940256099942544/5224354917") + "\\"")');
    s = exact(s, 'gradle.deps', '    implementation("com.google.firebase:firebase-messaging")',
      '    implementation("com.google.firebase:firebase-messaging")\n    implementation("com.google.android.gms:play-services-ads:23.2.0")\n    implementation("com.google.android.ump:user-messaging-platform:2.2.0")');
    fs.writeFileSync(f, s); console.log('app/build.gradle.kts patched');
  } else console.log('gradle already patched');
}
// ---- manifest
{
  const f = process.env.MF; let s = fs.readFileSync(f, 'utf8');
  if (!s.includes('com.google.android.gms.ads.APPLICATION_ID')) {
    s = exact(s, 'mf.adid', '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>', '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>\n    <uses-permission android:name="com.google.android.gms.permission.AD_ID"/>');
    s = exact(s, 'mf.app', '<receiver android:name="com.iline.streetdominoes.InviteActionReceiver" android:exported="false" />', '<receiver android:name="com.iline.streetdominoes.InviteActionReceiver" android:exported="false" />\n        <!-- AdMob app id (Google test id unless ADMOB_APP_ID is set at build time) -->\n        <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${admobAppId}"/>');
    fs.writeFileSync(f, s); console.log('manifest patched');
  } else console.log('manifest already patched');
}
// ---- docs
const add = (f, fn) => { if (fs.existsSync(f)) { const s = fs.readFileSync(f, 'utf8'); if (!s.includes('sd141')) fs.writeFileSync(f, fn(s)); } };
add('STATE.md', s => s.replace(/\s*$/, '\n') + '\n<!-- sd141 -->\n## 19. Android AdMob (v1.4.0)\n- `Ads.kt`: UMP consent -> `MobileAds.initialize` -> adaptive banner (drawn over the bottom of the WebView in a `FrameLayout`; the page reserves the height through `window.onBannerState`) and preloaded rewarded ads (`window.onAdResult(id, earned)`). `MainActivity` bridge: `adsSupported`, `showRewarded(id)`, `bannerShow`, `bannerHide`; lifecycle `pause/resume/destroy`.\n- Ad ids: `app/build.gradle.kts` reads env `ADMOB_APP_ID`, `ADMOB_BANNER`, `ADMOB_REWARDED` (manifest placeholder `admobAppId`, BuildConfig `ADMOB_BANNER` / `ADMOB_REWARDED`); the defaults are Google\'s TEST ids. Dependencies: `play-services-ads:23.2.0`, `user-messaging-platform:2.2.0`.\n- Not compiled in the chat sandbox: the GitHub Actions APK build is the compile check.\n');
add('ROADMAP.md', s => s.includes('- [ ] AdMob in Kotlin:') ? s.replace('- [ ] AdMob in Kotlin:', () => '- [x] AdMob in Kotlin (test ids until real ones are set; compile check = CI):') : s);
add('CHANGELOG.md', s => s.replace(/\s*$/, '\n- Android: AdMob banner + rewarded ads with UMP consent (Google test ids until real ids are configured).\n'));
JS
trap - ERR
if [ -z "${SD_NO_GIT:-}" ]; then
  git add -A
  git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
  git commit -m "Android: AdMob (UMP consent, adaptive banner, rewarded ads)"
  git push
  [ -n "${SD_TAG:-}" ] && { git tag v1.4.0; git push origin v1.4.0; }
fi
echo "Done. Kotlin / Gradle are only compiled by the GitHub Actions APK build (tag v1.4.0). Real ad ids: set ADMOB_APP_ID, ADMOB_BANNER, ADMOB_REWARDED in the build env."
