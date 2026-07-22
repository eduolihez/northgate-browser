# Ambiguous References Log

The following references to "Mullvad" or "Mullvad Browser" were intentionally left untouched during Phase 1 rebranding to avoid breaking private resolving (DoH), updater systems, or original code comments describing Tor Browser relationships.

## DNS-over-HTTPS (DoH) Infrastructure
Preserved in `browser/app/profile/000-northgate-browser.js` (originally `000-mullvad-browser.js`):
- `dns.mullvad.net` / `adblock.dns.mullvad.net` DoH endpoints and lists.
- DoH provider identifier `"mullvad"`.

## Application Updates & Support URLs
Preserved in `browser/app/profile/000-northgate-browser.js`:
- `browser.base-browser-support-url` -> `https://mullvad.net/en/help/`
- `app.update.url.manual` / `app.update.url.details` -> `https://mullvad.net/download/browser`
- `app.feedback.baseURL` -> `https://mullvad.net/help/tag/browser/`

Preserved in `browser/branding/mb-release/pref/firefox-branding.js` (and alpha, nightly):
- Manual update URLs pointing to `https://mullvad.net/download/browser`
- Release notes URLs pointing to `github.com/mullvad/mullvad-browser/releases`

## Code comments & issues
Numerous comments throughout the code referencing `mullvad-browser#<issue_number>` or technical annotations (e.g. `mullvad-browser#163`, `mullvad-browser#20`, `mullvad-browser#222`) were left untouched to maintain issue traceability.
