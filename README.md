# CMUBioTriage (XAMPP / PHP version)

## Run locally (XAMPP)
1. Put the project folder inside XAMPP's `htdocs` directory.
2. Start **Apache** in XAMPP (MySQL is not needed).
3. Open `http://localhost/<folder-name>/`, replacing `<folder-name>` with the project folder's name. Use Apache rather than a static preview server so PHP-backed staff features work.
4. Staff login PIN is `1234` (change it in `api/config.php`).

## Open it on a phone
- **Same Wi-Fi:** find the computer's local IP address and open `http://YOUR-PC-IP/<folder-name>/` on the phone. Allow Apache in the computer's firewall. Over plain HTTP, some phone features such as GPS and app installation may be restricted.
- **Full features (https):** keep XAMPP running and use a tunnel (`ngrok http 80` or Cloudflare Tunnel), then open the https address.

## Folder layout
```
CMUBioTriage/
├── index.html            page
├── manifest.json         PWA manifest
├── sw.js                 service worker (offline cache; must stay in root)
├── .htaccess, netlify.toml
├── assets/
│   ├── css/styles.css    all styles (dark, light, sunlight modes)
│   ├── js/app.js         app logic
│   ├── data/data.json    all guide content (numbers, hospitals, options)
│   ├── img/              background images
│   ├── icons/icon.svg
│   └── vendor/leaflet/   Leaflet map library (its own CSS stays separate)
└── api/                  PHP backend
    ├── config.php        PIN + settings (blocked from web)
    ├── _lib.php          shared helpers (blocked from web)
    ├── session.php       staff login / logout / check
    ├── reports.php       users POST reports; staff GET them
    ├── report.php        staff: mark handled / reopen / delete
    └── _data/            stored reports, audit log, throttle (blocked from web)
```

## Notes
- Edit `assets/data/data.json` to update guide wording, contacts, and facility details. Have clinical guidance and emergency contacts reviewed by CMU/UH before public use.
- Change `STAFF_PIN` and `SITE_SALT` in `api/config.php` before real use.
- After changing cached app files, bump the `CACHE` version in `sw.js` so returning users receive the update; then reload the guide online.
- Netlify cannot run PHP; `netlify.toml` blocks `/api/*` there so PHP source is never exposed.
- This is a pitch prototype. Reports and location data are stored as plain JSON on disk; do not enter real patient information or use this storage for a live service.

## QR and printed materials
- Open `/qr/` to print the card or download its QR as an SVG. The QR contains the full card text (emergency contact, first aid, and handoff checklist), not a link or facility status. A compatible scanner can read it offline on a first scan. If the camera does not display text, read the printed card beside the QR.
- If card content changes, install the Python `qrcode` package with `python -m pip install qrcode`, then run `python tools/generate_offline_qr.py`. This regenerates `assets/img/offline-text-qr.svg` directly from the card's `data-qr-line` elements. Test the actual printed card on several phones in airplane mode before distribution.
- The optional interactive guide at `/guide/` is separate. Open it online and wait for “Saved offline” before relying on it in the same browser without internet. Calling and sending SMS still need phone service. The main site's Facility Status is unchanged.
- The card's first-aid wording follows [WHO snakebite first-aid guidance](https://www.who.int/teams/control-of-neglected-tropical-diseases/snakebite-envenoming/treatment). The listed hotlines are published by [DILG](https://ncr.dilg.gov.ph/dilg-leads-nationwide-campaign-for-unified-911-emergency-hotline/) and the [Philippine Red Cross](https://redcross.org.ph/contact-us/). The project remains a prototype; have a local clinical reviewer approve the final card before public distribution.
- Staff stock confirmations require a vial count and verification details. Updates older than 24 hours are shown as stale; call the facility to verify current stock.
