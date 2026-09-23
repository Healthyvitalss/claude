# Healthy Vitalss — Founding 250

The Founding 250 signup for Mr. Olympia 2026. It runs as a kiosk on the booth iPads and as a normal web page on phones. It is one static site on Cloudflare Workers (`hv-founding250`) and writes to Supabase project `dxsihfggouctydraqctd`.

Attract → one form → confirmation → full reset. There is nothing else on it.

## What's here

```
public/            the site, deployed as-is (no build step)
  index.html       three panels: attract, capture, payoff; plus the hidden staff panel
  app.css          the wall, the teal plinth, type, layout for portrait / landscape / phone
  app.js           flow, validation, on-device queue + sync, light and tilt engine, staff panel
  sw.js            offline shell (network-first pages, cached assets)
  _headers         CSP and security headers; Supabase is the only outside host allowed
  assets/          HV monogram + wordmark (SVG), plaster grain, icons, self-hosted fonts (SIL OFL)
brand/             clean HV monogram master, the original trace, and the script that builds one from the other
tests/             34 browser tests (layout with keyboard up, offline, sync, tilt permission, reset timers)
wrangler.jsonc     Cloudflare config
```

## How a signup is recorded

- The page calls one database function, `claim_founding_place`, with the publishable key. The tables themselves are locked (RLS on, no policies, no grants). The public key cannot read or change the list.
- The function takes a lock, ignores repeat emails, and is idempotent by request key. A retry after a dropped connection never creates a second entry. It stops at 250 (`CAPACITY_REACHED`) or when `founding_settings.signups_open` is false.
- **Kiosk mode:** the entry is saved on the iPad first, and the visitor sees their confirmation immediately. It syncs in the background every 10 s and whenever the connection returns. Once Supabase confirms, the name and email are deleted from the device.
- **Phone mode:** the page waits for the server. If there is no connection, the visitor stays on the form with their details kept.
- The list lives in the Supabase dashboard → Table Editor → `founding_members`.

## Deploy

Always publish a review copy first. It gets its own URL and does not touch the live kiosk:

```sh
npx wrangler deploy --name hv-founding250-preview
```

Replace the live site only after sign-off:

```sh
npx wrangler deploy
```

After a live deploy, open the kiosk URL on each iPad and reload once. If the old version still shows, delete the Home Screen app and add it again. A service worker from the previous build can hold the old page.

## Kiosk setup (each iPad, event morning)

1. In Safari, open `https://<site>/?kiosk=1`, then Share → **Add to Home Screen**. Launch it from the Home Screen icon.
2. **Motion:** on the first tap, iPadOS asks to allow Motion & Orientation. Staff tap **Allow**. Safari remembers this until the app is closed, so never force-quit it during the day. You can also enable it from the staff panel.
3. **Privacy between visitors:**
   - Settings → Apps → Safari → AutoFill: all off. On older iPadOS the path is Settings → Safari.
   - Settings → General → Keyboard: Predictive off.
   - At the end of each day: General → Transfer or Reset → Reset → **Reset Keyboard Dictionary**.
4. Accessibility → **Guided Access** on (triple-click to lock the app). Display → Auto-Lock: Never. Brightness: maximum. Focus: Do Not Disturb.
5. **Staff panel:** tap the HEALTHY VITALSS wordmark five times, or press and hold it for 2 s. It shows entries waiting to sync, last sync, connection and motion status.
   - **Never clear Safari data or delete the app while anything is waiting to sync.** Use *Export waiting* first; it downloads a CSV.
6. Timers: an abandoned form clears after 45 s. The confirmation holds for 10 s (the brass line along the plinth fills), then resets for the next visitor.

## Brand files

- `brand/hv-monogram.svg` is the clean monogram: straight strokes are true lines, joins are exact, and each serif is one smooth curve. `python3 brand/build_monogram.py` rebuilds it from `brand/hv-monogram-traced-original.svg` and reports how far each serif sits from the trace. It needs numpy, scipy and svgpathtools.
- The wordmark (`assets/hv-wordmark.svg`) is still the original trace. It holds up at kiosk size. For print and signage, replace it with the designer's master vector.

## Tests

```sh
cd tests && npm install && npm test
```

The tests use Playwright's Chromium. Set `CHROMIUM_PATH` to use a system Chromium instead. They serve `public/` locally and mock the database, so they never write to the real list.
