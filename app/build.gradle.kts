plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
// Firebase (push notifications): only applied when the build has google-services.json, so the app also builds without it (push stays off)
if (file("google-services.json").exists()) { apply(plugin = "com.google.gms.google-services") }
fun env(k: String, d: String) = System.getenv(k)?.takeIf { it.isNotEmpty() } ?: d
android {
    namespace = "com.iline.streetdominoes"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.iline.streetdominoes"
        minSdk = 26; targetSdk = 34
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 10302
        versionName = (project.findProperty("versionName") as String?) ?: "1.3.2"
        buildConfigField("String", "REPO", "\"Aladdinweb/street-dominoes\"")
        // AdMob: Google's public TEST ids by default; pass the real ones with env ADMOB_APP_ID / ADMOB_BANNER / ADMOB_REWARDED
        manifestPlaceholders["admobAppId"] = env("ADMOB_APP_ID", "ca-app-pub-3991857229262724~1656760152")
        buildConfigField("String", "ADMOB_BANNER", "\"" + env("ADMOB_BANNER", "ca-app-pub-3940256099942544/9214589741") + "\"")
        buildConfigField("String", "ADMOB_REWARDED", "\"" + env("ADMOB_REWARDED", "ca-app-pub-3940256099942544/5224354917") + "\"")
    }
    buildFeatures { buildConfig = true }
    signingConfigs {
        create("release") {
            storeFile = file("release.jks")
            storePassword = env("KS_PASS", "streetdominoes")
            keyAlias = env("KEY_ALIAS", "street")
            keyPassword = env("KEY_PASS", "streetdominoes")
        }
    }
    buildTypes { release { signingConfig = signingConfigs.getByName("release"); isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    lint { checkReleaseBuilds = false; abortOnError = false }
}
dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.java-websocket:Java-WebSocket:1.5.7")
    implementation(platform("com.google.firebase:firebase-bom:33.1.2"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.google.android.gms:play-services-ads:23.2.0")
    implementation("com.google.android.ump:user-messaging-platform:2.2.0")
}
