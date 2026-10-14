#!/usr/bin/env sh
# One-time: creates the signing key and stores it as GitHub secrets (run inside the repo, after `gh auth login`).
set -e
PASS=$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 16)
keytool -genkeypair -keystore release.jks -alias street -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=Street Dominoes, O=ILINE TECH"
base64 -w0 release.jks > release.jks.b64
gh secret set KEYSTORE_B64 < release.jks.b64
printf %s "$PASS" | gh secret set KS_PASS
printf %s "$PASS" | gh secret set KEY_PASS
printf %s street | gh secret set KEY_ALIAS
echo "Secrets set. BACK UP release.jks and this password: $PASS  (losing them breaks in-app updates)"
