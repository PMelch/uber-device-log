# Testing and validation

Run commands from the repository root after `npm ci`, using Node.js 22.12+.
No connected device is required for the automated suite. Physical capture and host
compatibility are separate checks; a simulated protocol test cannot establish them.

## Standard checks

```sh
npm test
npm run build
git diff --check
```

`npm test` uses Node's built-in test runner with the tsx import hook and discovers
`server/*.test.ts`. That directory also holds tests for shared/browser modules;
its name does not imply backend-only coverage. `npm run build` runs vue-tsc, Vite,
and server TypeScript compilation, producing `dist/` and `build/`. There is no
separate lint command or committed general-purpose browser test runner.

For a focused test, pass files directly rather than appending them to the wildcard
npm script:

```sh
node --import tsx --test server/log-export.test.ts server/webview-export.test.ts
node --import tsx --test --test-name-pattern='slow browsers' server/stream.test.ts
```

Protocol fixtures bind ephemeral loopback HTTP/TCP/WebSocket servers. Environments
that prohibit localhost listeners need permission to run those tests; connection
refusals or bind errors in such an environment are not physical-device failures.
Some tests use Node mock timers and emit an experimental-API warning.

## Coverage map

| Area | Tests and what they establish |
| --- | --- |
| SSE lifecycle | `stream.test.ts`: framing, close-once cleanup, late collector disposal, connection errors, queue/backpressure behavior |
| Android WebViews | `webviews.test.ts`: socket matching, simulated ADB tunnel and HTTP/CDP transport, target validation, console mapping, deadlines and cleanup |
| iOS WebViews | `ios-webviews.test.ts`, `ios-inspector.test.ts`: simulated listings and protocol commands, readiness, lease routing/reuse/release, timeout recovery |
| Browser transport | `log-streams.test.ts`, `log-batches.test.ts`: concurrent sources, stale callbacks, explicit retry, coalescing and bounded pending batches |
| Search/filter/merge | `search.test.ts`, `log-view.test.ts`, `log-sources.test.ts`, `log-performance.test.ts`: search semantics, exact metadata, chronological retention, cache correctness/invalidation |
| Export/selection | `log-export.test.ts`, `webview-export.test.ts`, `log-selection.test.ts`: schemas, provenance, raw multiline text, display order and inclusive ranges |
| Message presentation | `crash-format.test.ts`, `log-message-text.test.ts`, `log-details.test.ts`, `log-details-view.test.ts`: formatting, safe rendering, explicit metadata and conservative interpretation |
| UI interaction | `log-details-interaction.test.ts`, `disclosure-dismissal.test.ts`, `device-picker.test.ts`, `source-filters.test.ts`: controlled DOM/event simulations and Vue SSR contracts |
| Preferences/diagnostics | `preferences.test.ts`, `remembered-device.test.ts`, `performance.test.ts`: storage fallback, initial restoration, elapsed-time sampling and lifecycle cleanup |
| Localization/website | `i18n.test.ts`, `website.test.ts`: catalog/context coverage, placeholders, locale resolution, live status translation, static HTML and package boundary |
| CLI | `cli-options.test.ts`: defaults, environment/flag precedence, help/version and argument rejection |

UI unit/SSR tests do not replace actual keyboard, touch, layout or screen-reader
checks. Catalog tests do not judge translation quality or find every hard-coded
string. Native `server/devices.ts` capture requires a hardware smoke test.

## Installed-package smoke test

For CLI, dependency, build-output or packaging changes:

```sh
npm run test:package
```

Requires npm, Bun (`bunx`), Node, loopback listeners and dependency-install access.
The script builds, packs into a temporary directory, validates the archive allowlist,
installs without development dependencies, checks help/version, and launches with
npx, bunx and a temporary global `udl` installation from outside the checkout. It
checks frontend assets, discovery and the Origin guard, then removes its temporary
files. It does not publish anything or prove physical capture. See
[publishing.md](publishing.md) for the minimum-Node regression check.

## Repeatable browser fixtures

For manual source-picker and WebView UI checks, first build the app, then run:

```sh
npm run build
node --import tsx server/fixtures/webview-ui.mts
```

Open `http://127.0.0.1:4312`. The fixture serves fictional native and WebView sources;
it is not a connection to hardware. Stop it with Ctrl+C. It is excluded from
production server compilation and package output.

The committed performance browser script requires Playwright to be available
separately; it is not a package dependency. It launches Chromium against an ephemeral
fixture with 10,000 initial records and traffic up to 5,000 records/second:

```sh
npm run build:debug
PERFORMANCE_DIST=dist-debug node scripts/test-log-performance.mjs
npm run build
PERFORMANCE_RELEASE_CHECK=true node scripts/test-log-performance.mjs
```

See [log-performance.md](log-performance.md) for optional module/executable paths,
screenshots, measured metrics, assertions and limitations. This is a committed
synthetic browser regression; broader manual UI checks are not an automated E2E suite.

## Manual checks by change type

For UI changes, check desktop and narrow mobile widths, light/dark appearance,
keyboard access, focus restoration, all seven languages and long translations.
Exercise empty discovery, warnings, unavailable devices and stopped sources. Switch
language with an existing notification and retained selection. Follow the
[localization checklist](localization.md).

For capture/state changes, combine native logs and multiple WebViews; stop one
source and confirm the others continue. Pause, select whole entries and native text,
change filters/order/capacity, scroll away from latest, resume, clear, and reconnect.
Verify Copy/Save includes offscreen filtered records in display order and retains
original text. Test clipboard denial and blocked localStorage.

For adapter changes, use authorized physical Android/iOS devices. Record host OS,
Node and device OS versions, app/debugging configuration and tested sources.
Compare known console calls, warnings, errors, multiline traces and long messages
with the platform tools. Exercise page replacement, app restart, lock/unlock,
unplug/replug, switching during connection and repeated capture/stop. Inspect for
leaked sockets and verify no unexpected retry or switching.

The historical [WebView validation record](webview-prototype.md#physical-android-validation-2026-10-13)
documents one Android device/setup. Other hardware, native iOS/syslog coverage,
iOS WebViews and Windows/Linux require their own evidence. Preserve dated results
as historical evidence rather than describing them as current guarantees. Report
commands, environment, failures and hardware limitations with each change; avoid
maintaining an undated hard-coded test count in general guides.
