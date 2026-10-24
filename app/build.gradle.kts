plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
fun env(k: String, d: String) = System.getenv(k)?.takeIf { it.isNotEmpty() } ?: d
android {
    namespace = "com.iline.streetdominoes"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.iline.streetdominoes"
        minSdk = 26; targetSdk = 34
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 10204
        versionName = (project.findProperty("versionName") as String?) ?: "1.2.4"
        buildConfigField("String", "REPO", "\"Aladdinweb/street-dominoes\"")
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
}
