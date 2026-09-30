# Public website

The Precision-style landing page is built separately from the local log viewer.

- Source: `website/`
- Website-only translations: `src/i18n/website.ts`
- Translation context: `websiteTranslationContext` in `src/i18n/context.ts`
- Build: `node scripts/build-site.mjs`
- Output: `site-dist/` (ignored by Git)
- Screenshots: copied from `docs/images/` at build time

Preview the output with a static HTTP server, for example:

```sh
node scripts/build-site.mjs
python3 -m http.server 4314 --directory site-dist
```

The GitHub Pages workflow builds and uploads **only `site-dist/`**. Configure
Settings → Pages → Source as GitHub Actions. Pushes affecting the website on
`main` deploy automatically; `workflow_dispatch` also allows a manual deployment.
The expected project URL is https://pmelch.github.io/uber-device-log/.

The page is a product showcase, not the device-capture application. Installation
commands launch the application locally. The website has no analytics, API calls,
or remote fonts. Its language preference is saved under `udl.website.language`.

## Search and sharing metadata

The page targets Android Logcat and iOS syslog searches, with macOS, Windows and
Linux setup guidance. Keep the host validation caveat and legacy iOS syslog-relay
limitations alongside the platform copy.

`website/index.html` contains English text and image descriptions before JavaScript
runs. When changing website translations, update this English fallback too. The
language switcher updates the document title, search description and social title
and description using the website catalog. All languages currently share one URL;
there are no separate localized URLs to advertise with `hreflang`.

The canonical URL and Open Graph/Twitter image URLs use the GitHub Pages project
URL. Update them if the site moves to a custom domain. Build and run the website
tests before deploying changes.

## npm boundary

The package's positive `files` allowlist includes only `bin/`, compiled runtime
JavaScript in `build/`, application assets in `dist/`, and README (npm also includes
package.json and LICENSE). Neither `website/` nor `site-dist/` is included.
Website translations are not imported by the application's bundle. Do not add a
wildcard or the website directories to the package allowlist.

Check the final archive with `npm pack --dry-run --json` after building. The
packaging smoke test also rejects files outside the application allowlist.
