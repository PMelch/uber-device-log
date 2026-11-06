# Testing and validation

Run commands from the repository root after `npm ci`, using Node.js 22.12+.
No connected device is required for the automated suite. Physical capture and host
compatibility are separate checks; a simulated protocol test cannot establish them.

## Standard checks

```sh
npm run format:check
npm run lint
npm test
npm run build
npm run blueprints:check
npm run skill:check
git diff --check
```

`npm test` uses Node's built-in test runner with the tsx import hook and discovers
`server/*.test.ts`. That directory also holds tests for shared/browser modules;
its name does not imply backend-only coverage. `npm run build` runs vue-tsc, Vite,
and server TypeScript compilation, producing `dist/` and `build/`. The bounded Flow style rollout uses `npm run format:check` and `npm run lint`;
see [Contributing](../CONTRIBUTING.md) for scope and intentional exceptions.

The Product checks workflow runs those commands on pull requests, pushes to `main`
and manual dispatch. The matrix includes the exact minimum Node 22.12.0 and Node
26.12.0. A separate browser job runs the Semantic Flow, labels and bundle/source
regressions against a production build with the locked Playwright/Chromium pair:

```sh
npm ci
npx --no-install playwright install chromium
npm run build
npm run test:flows:browser
```

Linux CI installs browser system libraries with `playwright install --with-deps
chromium`. `CHROME_EXECUTABLE` can select an existing browser locally, but that
checks a different browser version from CI. All fixtures bind loopback and use
temporary storage. The tests do not establish hardware compatibility, hosted CI
success, or release readiness. Additional UI suites are listed in the
[Flow browser guide](semantic-flows-browser-tests.md).

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

## Update notification actions

After building, run `node scripts/test-update-notice.mjs` with Playwright available
(or set `PLAYWRIGHT_MODULE` to its module path and optionally `CHROME_EXECUTABLE`).
The local fixture checks reminder/dismiss persistence, reactive 24-hour expiry,
newer versions, keyboard activation/focus and layout at 1440, 390 and 320 pixels
in all seven languages. Screenshots are written to `/tmp/update-actions-1440.png`
and `/tmp/update-actions-390.png`. Unit coverage in
`server/update-preference.test.ts` additionally checks exact time boundaries,
malformed records and unavailable storage. No live registry is used.

## Coverage map

| Area | Tests and what they establish |
| --- | --- |
| SSE lifecycle | `stream.test.ts`: framing, close-once cleanup, late collector disposal, connection errors, queue/backpressure behavior |
| Android WebViews | `webviews.test.ts`: socket matching, simulated ADB tunnel and HTTP/CDP transport, target validation, console mapping, deadlines and cleanup |
| iOS WebViews | `ios-webviews.test.ts`, `ios-inspector.test.ts`: simulated listings and protocol commands, readiness, lease routing/reuse/release, timeout recovery |
| Browser transport | `log-streams.test.ts`, `log-batches.test.ts`: concurrent sources, stale callbacks, explicit retry, coalescing and bounded pending batches |
| Search/filter/merge | `search.test.ts`, `log-view.test.ts`, `log-sources.test.ts`, `log-performance.test.ts`: search semantics, exact metadata, chronological retention, cache correctness/invalidation |
| Export/selection | `log-export.test.ts`, `webview-export.test.ts`, `log-selection.test.ts`: schemas, provenance, raw multiline text, oldest-first exports for both display orders and inclusive ranges |
| Message presentation | `crash-format.test.ts`, `log-message-text.test.ts`, `log-details.test.ts`, `log-details-view.test.ts`: formatting, safe rendering, explicit metadata and conservative interpretation |
| UI interaction | `log-details-interaction.test.ts`, `disclosure-dismissal.test.ts`, `device-picker.test.ts`, `source-filters.test.ts`: controlled DOM/event simulations and Vue SSR contracts |
| Preferences/diagnostics | `preferences.test.ts`, `remembered-device.test.ts`, `performance.test.ts`: storage fallback, initial restoration, elapsed-time sampling and lifecycle cleanup |
| Localization/website | `i18n.test.ts`, `website.test.ts`: catalog/context coverage, placeholders, locale resolution, live status translation, static HTML and package boundary |
| Semantic Flows | `flow-blueprints.test.ts`, `flow-engine.test.ts`, `flow-project.test.ts`, `flow-analysis.test.ts`, `flow-workspace.test.ts`, `flow-sample.test.ts`: schema/dependency validation, per-instance correlation and branches, filesystem/API boundaries, worker lifecycle, UI contracts and example project recognition |
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
also installs the archive independently with Bun, rejects bundled dependencies
and vulnerable source-map-js or follow-redirects copies, and reports installed
shell-quote versions. Redirect regressions use two loopback HTTP servers and
synthetic credentials to check stripping of object/array headers and custom
sensitive header names containing regular-expression metacharacters.
The upstream shell-quote pin remains a known consumer finding; root overrides
apply only to the development checkout. A successful smoke test is not a clean
security audit.
The fixture gives Bun its own manifest so it cannot inherit the npm test project.
It checks frontend assets, discovery and the Origin guard, then removes its temporary
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

## Semantic Flows checks

Focused checks use the same Node test runner:

```sh
node --import tsx --test server/flow-blueprints.test.ts server/flow-engine.test.ts server/flow-project.test.ts server/flow-analysis.test.ts server/flow-workspace.test.ts server/flow-sample.test.ts
```

For an actual project launch from the checkout root:

```sh
npm run dev -- --project=./test_flow_project
# Or after building:
npm run build
node bin/uber-device-log.mjs --flows=./test_flow_project
```

Choose the intended device/WebView sources, then emit matching application logs
as described in [the test project README](../test_flow_project/README.md). Its
`.udl/config.yaml` and `.udl/flows/` directory are ordinary project inputs. Selecting this
project does not fabricate capture traffic. The example HTML emitter must run in
the inspected WebView, or equivalent lines must be emitted by the tested app.

For isolated synthetic testing without hardware, explicitly launch the
[Semantic Flows browser fixture/regression](semantic-flows-browser-tests.md).
It uses a temporary project copy for editor writes and shortened deadlines, never
the committed example files. Keep this distinction when reporting results:
synthetic recognition checks do not prove real device log formats or correlation.

Exercise simultaneous operations with distinct IDs, later steps identified only
by extracted payload values, alternative and optional paths, expected error codes,
missing-start evidence, out-of-order evidence and timeouts. Check that log filters,
pause and selection leave analysis active; changing source inclusion/reconnecting
interrupts the prior epoch. Verify Flows Clear leaves raw Logs intact and Logs
Clear leaves flow history intact. Confirm search, explicitly revealed sensitive
values, pinned blueprint revisions, validation, save conflicts and draft recovery.
Check keyboard access, language switching with existing statuses, long translations,
and mobile overflow. Use the [agent extraction guide](semantic-flows-agent-guide.md)
when adding blueprints derived from application code, and retain representative
log fixtures to demonstrate their actual matching and identifier dependencies.

## Manual checks by change type

For UI changes, check desktop and narrow mobile widths, light/dark appearance,
keyboard access, focus restoration, all seven languages and long translations.
Exercise empty discovery, warnings, unavailable devices and stopped sources. Switch
language with an existing notification and retained selection. Follow the
[localization checklist](localization.md).

For capture/state changes, combine native logs and multiple WebViews; stop one
source and confirm the others continue. Pause, select whole entries and native text,
change filters/order/capacity, scroll away from latest, resume, clear, and reconnect.
Verify Copy/Save includes offscreen filtered records oldest first for both display orders and retains
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

## Stable workflow layout regression

After `npm run build`, run `node scripts/test-workflow-layout.mjs` with Playwright
available separately. `PLAYWRIGHT_MODULE` can point to its `index.mjs` and
`CHROME_EXECUTABLE` can point to an installed Chrome executable. Optionally set
`WORKFLOW_SCREENSHOT` to save the final dark/mobile filter state.

The synthetic fixture checks 1440, 900, 390 and 320px widths. It measures actual
log-row positions across filter/advanced-filter overlays, selection, copy success,
manual clipboard fallback, action menus and arrivals during pause. It also checks
JSON export of offscreen selections, arrivals exceeding buffer capacity, all seven
languages with selection retained, keyboard Escape/focus restoration, horizontal
overflow and reduced motion. It does not establish physical-device compatibility.

### Compact WebView selection

After building, run `node scripts/test-webview-selection.mjs` with the same
`PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` overrides as the workflow layout check.
It checks all seven languages at desktop and touch widths, URL details, selection,
keyboard focus restoration and stationary rows. Fixtures use synthetic page URLs.

Run `node scripts/test-log-details.mjs` after building (with the same browser
overrides) to check hover-then-click, keyboard activation, touch and Escape focus
restoration. The test waits beyond the preview dismissal timer and streams synthetic
iOS and Android SSE batches in both message orders at desktop and touch widths.
Pinned snapshots must survive auto-follow scrolling and removal of their original
virtualized row; wheel/touch scrolling and outside pointer input still dismiss them.

## Startup update check

The update check follows the existing split between server API snapshots and Vue
state. `server/update-check.test.ts` injects registry responses to cover startup
without waiting, timeouts/offline/HTTP failures, invalid metadata, stable version
ordering, and installation paths. `server/update-notice.test.ts` covers polling
and cancellation independently of capture. No package manager is invoked during
startup; uncertain installation layouts return `unknown` and offer alternatives.
Only fixed registry/changelog URLs and fixed commands are used; log data and local
paths are not sent. `--help` and `--version` exit before starting the server.

For UI verification, return an `available` response from `/api/update`, including
all four commands for `unknown`. Check all seven languages at desktop, 375px and
320px widths, light/dark themes, collapse/reopen, Escape focus restoration, and
language switching while the notice exists. Source row heights must not change.

## External WebView inspection

After building, run `node scripts/test-webview-inspector.mjs` with the same
`PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` overrides described above. The
synthetic fixture exercises Android target requests and popup fallback, Safari
setup and target copying, clipboard denial, keyboard focus and nested console
inspection, all seven languages, desktop/mobile widths and both themes.

The server tests inject CDP targets and loopback connections to verify selected
page isolation, rejected hosts/origins/paths, connection cleanup, session reuse,
expiry and capacity recovery. They do not require an attached phone.

On 2026-10-20, an additional isolated smoke test used installed Chrome
155.0.8059.85 as a synthetic CDP target and its advertised hosted DevTools
frontend, through `openAndroidInspector`. With local-network permission granted,
DOM, Runtime and Debugger messages reached the frontend and the page DOM was
visible. Without permission, Chrome rejected the WebSocket with
`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`, confirming the need for the UI's
permission guidance. This establishes the browser/proxy integration, not physical
Android WebView compatibility. Safari guidance has synthetic UI coverage only;
no physical iOS Safari inspection was performed for this change.

## Global Blueprint bundle regression

`server/flow-bundle-skill.test.ts` copies the portable skill to temporary storage
and executes its helper for pack/inspect/unpack/whole-bundle validation. These
tests require Python 3.9+ (`python3`, or `python` on Windows; override with `PYTHON`).
They exercise offline draft status, the actual viewer validator, existing-bundle
extension without data loss, no-overwrite behavior, unsafe paths, duplicates,
symlinks, CRC/size/count failures and malformed manifest/DSL. No bundle is installed
or activated by the helper. The independent skill review also checks ambiguous
creation requests and explicit project/new-bundle/extension prompts.

`server/flow-bundles.test.ts`, `flow-catalog.test.ts`, `flow-bundle-api.test.ts`,
`flow-download.test.ts`, `flow-cli.test.ts` and `flow-source-ui.test.ts` exercise
ZIP/manifest validation, temporary homes and projects, activation, duplicate IDs,
disabling pinned recognition, atomic installs, API permissions and translated UI.
The [bundle guide](blueprint-bundles.md) documents the contract and browser fixture.
Tests must inject temporary homes, never use or modify the real user's bundle store.

## Android diagnostic bundle regression

`server/android-diagnostics.test.ts` validates the nine source-derived definitions,
their extracted values, immediate terminal outcomes, repeated identical records,
device isolation and negative source/tag/platform cases. It also checks that the
three distributed archives match their source YAML and install disabled before
explicit activation. `npm run blueprints:build` regenerates the archives;
`npm run blueprints:check` verifies them without writing. Evidence and supported
shapes are documented in [the bundle library](../blueprints/README.md).

After building, `node --import tsx scripts/test-android-diagnostics.mjs` installs
the real archives through the API and exercises the SSE/worker/production UI with
fictional Android records. It checks repeated single events, affected PID/results,
raw-evidence reveal, escaping, keyboard Timeline access, three display modes and
seven languages at desktop/mobile widths in light/dark themes. No physical Android
validation is implied by these synthetic checks.
