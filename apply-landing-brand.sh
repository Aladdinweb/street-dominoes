#!/usr/bin/env bash
# apply-landing-brand.sh - removes the "ILINE TECH / FERAK ALADDIN" text from the top-left of landing/index.html.
# The empty .brand box stays so the language switcher keeps its place on the right. Nothing else is touched.
set -euo pipefail
cd "${SD_REPO:-$HOME/street-dominoes}"
F=landing/index.html
[ -f "$F" ] || { echo "missing $F - run apply-landing.sh first, from the repo root"; exit 1; }
export F
node - <<'JS'
const fs = require('fs'), f = process.env.F;
const a = '<div class="brand">ILINE TECH <b>/</b> FERAK ALADDIN</div>', b = '<div class="brand" aria-hidden="true"></div>';
let s = fs.readFileSync(f, 'utf8');
if (s.includes(b)) { console.log('already removed'); process.exit(0); }
const n = s.split(a).length - 1;
if (n !== 1) { console.error('ABORT: anchor found ' + n + ' times (need 1)'); process.exit(1); }
fs.writeFileSync(f, s.replace(a, () => b));
console.log('top-left brand text removed');
JS
if [ -z "${SD_NO_GIT:-}" ]; then
  git add landing/index.html
  git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
  git commit -m "Landing: remove developer text from the top-left corner"
  git push
fi
echo "Done. The footer copyright is unchanged."
