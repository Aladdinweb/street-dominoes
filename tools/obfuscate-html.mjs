// CI-only: obfuscates the inline <script> blocks of HTML files and the given .js files (usage: node tools/obfuscate-html.mjs dist/play.html dist/sd-ads.js ...).
// Run `npm install --no-save javascript-obfuscator@4` first. Safe by design: globals are NOT renamed (the page, its inline handlers and sd-*.js share globals),
// object keys are kept (localStorage / JSON), and a file whose output does not compile is left exactly as it was. Obfuscation only slows copying; the real protection is server-side.
import fs from 'node:fs';
import vm from 'node:vm';
let JO;
try { JO = (await import('javascript-obfuscator')).default; } catch (e) { console.log('javascript-obfuscator is not installed: files left as they are'); process.exit(0); }
const OPT = { compact: true, renameGlobals: false, identifierNamesGenerator: 'hexadecimal', stringArray: true, stringArrayThreshold: 0.75, stringArrayEncoding: [], transformObjectKeys: false,
  controlFlowFlattening: false, deadCodeInjection: false, selfDefending: false, debugProtection: false, disableConsoleOutput: false, unicodeEscapeSequence: false, target: 'browser' };
const ob = code => { const out = JO.obfuscate(code, OPT).getObfuscatedCode(); new vm.Script(out); return out; };
for (const f of process.argv.slice(2)) {
  if (!fs.existsSync(f)) { console.log('skip (missing)', f); continue; }
  const src = fs.readFileSync(f, 'utf8');
  try {
    const out = f.endsWith('.html') ? src.replace(/(<script(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/g, (m, a, b, c) => (b.trim() ? a + ob(b) + c : m)) : ob(src);
    fs.writeFileSync(f, out); console.log('obfuscated', f, src.length, '->', out.length);
  } catch (e) { console.log('SKIPPED', f, '-', e.message); }
}
