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
The source HTML uses `https://uber-device-log.app/` as its canonical and social
sharing origin. DNS and GitHub Pages custom-domain settings are managed outside
this build; verify those settings when changing hosting.

The page is a product showcase, not the device-capture application. Installation
commands launch the application locally. The website has no analytics, API calls,
or remote fonts. Its language preference is saved under `udl.website.language`.

## Search and sharing metadata

The page targets hybrid app logging, WebView device logging and combined native /
JavaScript logging, while retaining Android Logcat and iOS syslog source terms.
The WebView use case focuses on web app logging in a WebView alongside native
code on one selected device. Support for multiple inspectable WebViews is an
additional option, not the main positioning. It does not advertise standalone
browser capture. English search phrases belong in useful
visible copy and metadata; translate their meaning naturally in other languages.
Keep macOS, Windows and Linux setup guidance, the host validation caveat and legacy
iOS syslog-relay limitations alongside the platform copy.

`website/index.html` contains English text and image descriptions before JavaScript
runs. When changing website translations, update this English fallback too. The
language switcher updates the document title, search description and social title
and description using the website catalog. All languages currently share one URL;
there are no separate localized URLs to advertise with `hreflang`.

The canonical URL and Open Graph/Twitter image URLs use `https://uber-device-log.app/`.
Update them together if the public origin changes. Build and run the website
tests before deploying changes.

## npm boundary

The package's positive `files` allowlist includes only `bin/`, compiled runtime
JavaScript in `build/`, application assets in `dist/`, and README (npm also includes
package.json and LICENSE). Neither `website/` nor `site-dist/` is included.
Website translations are not imported by the application's bundle. Do not add a
wildcard or the website directories to the package allowlist.

Check the final archive with `npm pack --dry-run --json` after building. The
packaging smoke test also rejects files outside the application allowlist.

## Refresh screenshots

Build the application, then run `node scripts/capture-doc-screenshots.mjs`. Set
`PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` as for the browser regression scripts
when using a separately installed Playwright runtime or Chrome. The script uses
the real built UI with fictional device and log fixtures, and updates all four
images in `docs/images/`. Inspect the images before committing, then rebuild the
website so it copies the refreshed assets. No connected device is required.

## Semantic Flows tutorials

The landing page introduces Semantic Flows with an explicitly labeled illustration
and three tutorial cards. The full English tutorials live in
[`tutorials/semantic-flows`](../tutorials/semantic-flows/README.md), keeping complete
Blueprints, sample logs and explanations together in the repository. Website links
use the canonical `main` branch, like the existing documentation links; merge the
README files with the landing page before deploying it.

`server/flow-tutorials.test.ts` validates the tutorial project, checks that README
code blocks match the YAML/JSONL files, and replays single events, overlapping
operations, timeouts and both branch outcomes. `server/website.test.ts` checks
catalog coverage, static English copy and tutorial entry points. Run `npm run test:website:browser` for browser checks across all
seven languages at desktop and mobile sizes.

The browser check uses the repository’s pinned Playwright version. Install its
Chromium with `npx --no-install playwright install chromium`, or set
`CHROME_EXECUTABLE` to an existing compatible browser executable.
