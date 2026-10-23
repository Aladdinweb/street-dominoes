# Integration steps (Street Dominoes v1.2.3)

I could not read index.html (GitHub blocks automated access), so these are drop-in files built from STATE.md.

1. Layout: replace the decision part of `layoutTry`/`layoutFit` with `planNext()` from
   patches/layout-policy.js. It returns `{dir, zoomIdx, pivot, rect, head}`; apply `ZL[zoomIdx]`.
   Map `L`/`W` to your stone length/thickness and `tableW/H` to the table size in virtual px.
2. Voice: merge patches/webrtc-voice.js into your voice code (RTC_CONFIG, ontrack + play(), gesture retry).
3. UI: copy www/ux-layer.css to app/src/main/assets/www/, link it last in <head>, rename selectors.
4. Pages: copy pages/ and .github/workflows/deploy-pages.yml to the repo root, then:
   - add `<link rel="manifest" href="/manifest.webmanifest">` and put icon-192/512.png in pages/icons/
   - create the project once: `npx wrangler pages project create street-dominoes --production-branch main`
   - secrets CLOUDFLARE_API_TOKEN (needs Cloudflare Pages: Edit) and CLOUDFLARE_ACCOUNT_ID already exist for the Worker
   - on the web build `window.Native` is absent (no LAN host, no updater): guard those calls.
5. Check the Worker accepts WebSocket/CORS requests from your *.pages.dev origin.
