package com.iline.streetdominoes

import android.app.Activity
import android.content.Context
import android.telephony.TelephonyManager
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
    @Volatile private var lastErr = ""          // last rewarded load error, shown in the "not ready" message
    @Volatile private var stage = "consent"     // which start-up step we are in
    @Volatile private var consentFailed = false
    private var waiting: String? = null            // rewarded request waiting for the ad to finish loading

    val supported: Boolean get() = ready

    fun start() {
        info.requestConsentInfoUpdate(act, ConsentRequestParameters.Builder().build(), {
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(act) { e -> if (e != null) { lastErr = "form ${e.errorCode}: ${e.message}"; consentFailed = true }; initAds() }
        }, { e -> lastErr = "consent ${e.errorCode}: ${e.message}"; consentFailed = true; initAds() })
        initAds()   // consent from an earlier session may already allow ads
    }

    private val gdpr = setOf("AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO","GB","CH")

    // Safety net when Google's consent service is not set up: outside the EU / UK / Switzerland ads may start without it.
    private fun outsideGdpr(): Boolean {
        val tm = act.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        val c = (tm?.networkCountryIso?.takeIf { it.length == 2 } ?: tm?.simCountryIso?.takeIf { it.length == 2 } ?: java.util.Locale.getDefault().country).uppercase()
        return c.length == 2 && c !in gdpr
    }

    private fun initAds() {
        if (!info.canRequestAds() && !(consentFailed && outsideGdpr())) { stage = "consent status ${info.consentStatus}"; return }
        if (!started.compareAndSet(false, true)) return
        stage = "init"
        Thread {
            MobileAds.initialize(act) {
                act.runOnUiThread {
                    ready = true
                    stage = "ready"
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
            override fun onAdLoaded(ad: RewardedAd) { rewarded = ad; loading = false; val w = waiting; if (w != null) { waiting = null; showRewarded(w) } }
            override fun onAdFailedToLoad(e: LoadAdError) {
                lastErr = "load ${e.code}"
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
                // not loaded yet (cold start, consent still running): wait up to 12 s instead of failing at once
                if (waiting != null) return@runOnUiThread
                waiting = id
                loadRewarded()
                host.postDelayed({
                    if (waiting == id) {
                        waiting = null
                        Toast.makeText(act, "Ad not ready yet (" + (if (!ready) "starting: " + stage + (if (lastErr.isEmpty()) "" else " / " + lastErr) else lastErr.ifEmpty { "loading" }) + "), try again in a moment", Toast.LENGTH_LONG).show()
                        result(id, false)
                    }
                }, 12_000)
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
