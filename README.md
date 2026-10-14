# Street Dominoes — by ILINE TECH / FERAK ALADDIN

Android app (WebView + Kotlin) with LAN multiplayer and in-app updates from GitHub Releases.

## First release (from Termux)
    pkg install git gh openjdk-17
    gh auth login
    cd street-dominoes
    git init -b main && git add -A && git commit -m "Street Dominoes 1.0.0"
    gh repo create Aladdinweb/street-dominoes --public --source=. --push
    sh tools/make-keystore.sh          # once, BEFORE the first tag
    git tag v1.0.0 && git push origin v1.0.0

GitHub Actions builds the APK and attaches `StreetDominoes-v1.0.0.apk` to the release. The repo must be public (the app reads the releases API).

## Update later
Edit `app/src/main/assets/www/index.html`, commit, then `git tag v1.0.1 && git push origin v1.0.1`.
Installed apps check at launch (and in Settings) and offer "Update now".

## LAN play
Same Wi-Fi (or one phone's hotspot). Host: Host LAN tab, set seats to 📡, share the shown address. Friends: Join LAN, type the address.
