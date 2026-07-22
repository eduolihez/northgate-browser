# Rebranding Log - Phase 1

Auditing log of all files created, modified, renamed, or deleted during the mechanical rebranding of Mullvad Browser to NorthGate.

## 1. Files Created
- [NOTICE](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/NOTICE) (attribution notice).
- [AMBIGUOUS_REFS.md](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/AMBIGUOUS_REFS.md) (catalog of preserved VPN endpoints/DoH configs).
- [REBRAND_LOG.md](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/REBRAND_LOG.md) (this log).
- [browser/config/mozconfigs/northgate-browser](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/config/mozconfigs/northgate-browser) (main configuration variables).
- [browser/branding/mb-release/northgatebrowser.VisualElementsManifest.xml](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-release/northgatebrowser.VisualElementsManifest.xml) (visual elements definition).
- [browser/branding/mb-alpha/northgatebrowser.VisualElementsManifest.xml](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-alpha/northgatebrowser.VisualElementsManifest.xml)
- [browser/branding/mb-nightly/northgatebrowser.VisualElementsManifest.xml](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-nightly/northgatebrowser.VisualElementsManifest.xml)
- [browser/branding/mb-release/content/northgate-branding.css](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-release/content/northgate-branding.css)
- [browser/branding/mb-alpha/content/northgate-branding.css](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-alpha/content/northgate-branding.css)
- [browser/branding/mb-nightly/content/northgate-branding.css](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-nightly/content/northgate-branding.css)
- [browser/app/profile/000-northgate-browser.js](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/app/profile/000-northgate-browser.js) (main user profile preferences).
- [toolkit/locales/en-US/toolkit/global/northgate-browser.ftl](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/toolkit/locales/en-US/toolkit/global/northgate-browser.ftl) (global locales).
- [browser/components/northgate-browser/](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/components/northgate-browser/) (about:northgate-browser page registration and assets).

## 2. Files Modified
- [README.md](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/README.md) (overwritten with custom NorthGate documentation).
- Platform Mozconfigs (sourced northgate-browser):
  - [mozconfig-linux-aarch64](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/mozconfig-linux-aarch64)
  - [mozconfig-linux-aarch64-dev](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/mozconfig-linux-aarch64-dev)
  - [mozconfig-linux-x86_64](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/mozconfig-linux-x86_64)
  - [mozconfig-linux-x86_64-asan](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/mozconfig-linux-x86_64-asan)
  - [mozconfig-linux-x86_64-dev](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/mozconfig-linux-x86_64-dev)
  - [mozconfig-macos](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/mozconfig-macos)
  - [mozconfig-macos-dev](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/mozconfig-macos-dev)
  - [mozconfig-windows-x86_64](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/mozconfig-windows-x86_64)
- Branding Configurations (`configure.sh`):
  - [mb-release/configure.sh](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-release/configure.sh)
  - [mb-alpha/configure.sh](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-alpha/configure.sh)
  - [mb-nightly/configure.sh](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-nightly/configure.sh)
- Branding Locales (`brand.ftl` and `brand.properties` files):
  - [mb-release/locales/en-US/brand.ftl](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-release/locales/en-US/brand.ftl)
  - [mb-alpha/locales/en-US/brand.ftl](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-alpha/locales/en-US/brand.ftl)
  - [mb-nightly/locales/en-US/brand.ftl](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-nightly/locales/en-US/brand.ftl)
  - [mb-release/locales/en-US/brand.properties](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-release/locales/en-US/brand.properties)
  - [mb-alpha/locales/en-US/brand.properties](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-alpha/locales/en-US/brand.properties)
  - [mb-nightly/locales/en-US/brand.properties](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-nightly/locales/en-US/brand.properties)
- Wordmark Locales (`mullvad-about-wordmark-en.ftl`):
  - [mb-release/locales/mullvad-about-wordmark-en.ftl](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-release/locales/mullvad-about-wordmark-en.ftl)
  - [mb-alpha/locales/mullvad-about-wordmark-en.ftl](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-alpha/locales/mullvad-about-wordmark-en.ftl)
  - [mb-nightly/locales/mullvad-about-wordmark-en.ftl](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-nightly/locales/mullvad-about-wordmark-en.ftl)
- Branding Build Files (`moz.build` and `jar.mn`):
  - [mb-release/moz.build](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-release/moz.build)
  - [mb-alpha/moz.build](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-alpha/moz.build)
  - [mb-nightly/moz.build](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-nightly/moz.build)
  - [mb-release/content/jar.mn](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-release/content/jar.mn)
  - [mb-alpha/content/jar.mn](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-alpha/content/jar.mn)
  - [mb-nightly/content/jar.mn](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/branding/mb-nightly/content/jar.mn)
- Core App Build and Registrations:
  - [browser/installer/package-manifest.in](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/installer/package-manifest.in)
  - [browser/components/BrowserContentHandler.sys.mjs](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/components/BrowserContentHandler.sys.mjs)
  - [browser/components/DesktopActorRegistry.sys.mjs](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/components/DesktopActorRegistry.sys.mjs)
  - [browser/components/tabbrowser/NewTabPagePreloading.sys.mjs](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/components/tabbrowser/NewTabPagePreloading.sys.mjs)
  - [browser/components/about/AboutRedirector.cpp](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/components/about/AboutRedirector.cpp)
  - [browser/components/about/components.conf](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/components/about/components.conf)
  - [browser/components/moz.build](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/components/moz.build)
  - [browser/moz.build](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/moz.build)
  - [browser/base/content/browser-places.js](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/base/content/browser-places.js)
  - [browser/base/content/browser.js](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/base/content/browser.js)
  - [browser/base/content/utilityOverlay.js](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/base/content/utilityOverlay.js)
  - [browser/modules/HomePage.sys.mjs](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/modules/HomePage.sys.mjs)
  - [browser/components/preferences/home.inc.xhtml](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/components/preferences/home.inc.xhtml)
  - [browser/components/preferences/preferences.xhtml](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/browser/components/preferences/preferences.xhtml)
  - [toolkit/content/aboutTelemetryMullvad.xhtml](file:///c:/Users/eduol/Documents/GitHub/northgate-browser/toolkit/content/aboutTelemetryMullvad.xhtml)

## 3. Files Deleted / Removed
- `browser/config/mozconfigs/mullvad-browser`
- `browser/branding/mb-release/mullvadbrowser.VisualElementsManifest.xml`
- `browser/branding/mb-alpha/mullvadbrowser.VisualElementsManifest.xml`
- `browser/branding/mb-nightly/mullvadbrowser.VisualElementsManifest.xml`
- `browser/branding/mb-release/content/mullvad-branding.css`
- `browser/branding/mb-alpha/content/mullvad-branding.css`
- `browser/branding/mb-nightly/content/mullvad-branding.css`
- `browser/app/profile/000-mullvad-browser.js`
- `toolkit/locales/en-US/toolkit/global/mullvad-browser.ftl`
- `browser/components/mullvad-browser/` (entire directory)

## 4. Placeholder Assets (Documented for Phase 2)
The following visual assets contain the old branding designs and remain as placeholders to be replaced when new graphic resources are ready:
- `browser/branding/mb-release/content/about-logo.png`
- `browser/branding/mb-release/content/about-logo.svg`
- `browser/branding/mb-release/content/about-logo@2x.png`
- `browser/branding/mb-release/content/about-wordmark.svg`
- `browser/branding/mb-release/content/about.png`
- `browser/branding/mb-release/content/firefox-wordmark.svg`
- `browser/branding/mb-release/content/about-logo-private.png`
- `browser/branding/mb-release/content/about-logo-private@2x.png`
- Icon binaries (`firefox.ico`, `firefox.icns`, `document.ico`, etc.) in all branding channels.
