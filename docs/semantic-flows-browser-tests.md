# Semantic Flows browser regression

The synthetic fixture serves the production build, discovers one fictional iPhone with a Shop WebView, and replays concurrent purchases, login, known asset errors, missing-start evidence, and timeouts through the actual SSE and worker pipeline. No device is required. Every run copies `test_flow_project` into temporary storage; editor saves never change the committed examples. Only the temporary copy shortens blueprint deadlines to three seconds.

```sh
npm run build
node --import tsx scripts/test-semantic-flows.mjs
```

Playwright must be available. Set `PLAYWRIGHT_MODULE` to an absolute installed Playwright `index.mjs` path if it is not in this checkout. Set `CHROME_EXECUTABLE` to an installed browser executable when needed. `SEMANTIC_FLOWS_SCREENSHOTS` optionally names an output directory. `SEMANTIC_FLOWS_DIST` selects a different build directory.

The regression checks concurrent receipt identifier correlation, completion/error/timeout outcomes, sensitive evidence reveal, blueprint info, validation and filesystem saves, preservation of local drafts on revision conflicts, search, clear, and desktop/mobile overflow. Runtime browser errors fail the test.

For manual inspection:

```sh
node --import tsx server/fixtures/semantic-flows-ui.mts
```

Open http://127.0.0.1:4313, select the fixture phone, and include both Device logs and Shop WebView. Once both streams are connected, the fixture replays once. Open the Flows tab. To replay additional events, send `POST /fixture/replay`; each run uses fresh correlation IDs. `SEMANTIC_FLOWS_PORT` overrides the manual fixture port. Stop with Ctrl+C to remove the temporary project.

These fictional events exercise implementation behavior. Actual application log formats and cross-provider identifiers still need validation against the target application.

## Dynamic labels and condensed summaries

After building, run `node --import tsx scripts/test-flow-labels.mjs` with the same
`PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` settings described above. The separate
fixture checks live labels, unchanged steps, semantic text tones, latest Result
values, HTML escaping, sensitive-value concealment and search, timeline reveal,
keyboard display switching, preference persistence, seven locales and 320 px,
390 px and desktop layouts. Condensed overview cards must contain no node or
edge elements. Only the display preference is stored locally. Set
`FLOW_LABEL_SCREENSHOTS` to a local directory to capture the tested layouts.

## Repeatable loading-progress checks

The separate sample project includes `loading-progress-demo.html` and `loading-progress-events.jsonl`; selecting the project does not replay either. Serve `test_flow_project` locally, open the demo in an inspectable captured WebView, and choose a fresh-ID route. See [the test-project instructions](../test_flow_project/README.md#repeatable-loading-progress-example).

Verify a single instance accepts progress 0, 25, 50, 75 and 100 before an explicit completion event. Check backward progress 50 to 40, zero-update completion through the optional bypass, explicit error and cancellation, and timeout without completion. The original deadline must not move with each update. In Detailed and Condensed, the label and result percentage should agree; Timeline must retain the repeated observations within the analysis memory budget. After a successor or terminal is accepted, additional old progress cannot alter its label/results or start a standalone orphan. Repeat updates must retain exact per-instance identity when two demo runs overlap.

Run `node --import tsx --test server/loading-progress-sample.test.ts` for deterministic schema, engine, presentation and no-network emitter checks. These synthetic checks do not establish real loading percentages, physical capture or actual source emissions in an application.

## Blueprint priority

After building, run `node --import tsx scripts/test-flow-priority.mjs` with the same
Playwright/browser overrides as above. It uses synthetic evidence to cover all five
levels and the omitted default, light/dark palettes, primary/secondary/semantic
label contrast, three densities and widths, preserved draft comments, validation
and save, pinned revisions, invalid YAML and all seven editor languages. Priority
affects presentation only; no device operation is performed.

## Adversarial display regression

Run `node --import tsx scripts/test-flow-long-labels.mjs` with the same browser
overrides. It checks 4096-character node labels, real Timeline/Info hit boxes and
keyboard selection at 1440, 390 and 320 pixels. `scripts/test-flow-labels.mjs` also
checks that sensitive error codes stay concealed in overview/header/search and only
appear in explicitly revealed Timeline evidence. Engine adversarial regressions are
in `server/flow-adversarial.test.ts`; the dense-DAG display regression uses a bounded
adjacency-read counter rather than relying on machine-specific rendering times.

## Alternative entries and shared variables

Run `node --import tsx scripts/test-flow-multi-start.mjs` with the same Playwright
and browser overrides. This fixture uses the actual parser, engine and workspace
with `entry-routes.yaml`. It checks both entry paths reaching a common stream,
unchosen-route classification in overview and Timeline, sensitive optional values,
keyboard selection and live status language switching in all seven locales at
1800px and 390px. `SEMANTIC_FLOWS_SCREENSHOTS` optionally captures the German
overview and Timeline. Deterministic availability, reassignment, malformed draft,
ambiguity, revision and reordered-evidence tests are in
`server/flow-multi-start.test.ts`.

## Global Blueprint bundles

Run `node --import tsx scripts/test-flow-bundles.mjs` after building, using the same
Playwright/browser overrides. It serves fictional bundles over local HTTP, uses
temporary home/project directories, and tests global/project installation, enable,
disable, retained evidence, form errors, keyboard access and seven-language layout
at desktop and mobile widths. No external download or physical device is needed.

## Android diagnostic bundles

After building, run `node --import tsx scripts/test-android-diagnostics.mjs` with
the same Playwright/browser overrides. It installs the three curated archives
into an isolated temporary project through the real API, then emits fictional
Logcat-shaped records through SSE and the analysis worker. It verifies nine
diagnostic kinds, repeats, immediate outcomes, results/affected PID, raw-evidence
reveal, HTML escaping, keyboard Timeline navigation and all seven languages at
1440, 390 and 320 pixels in three display modes and light/dark themes.
`SEMANTIC_FLOWS_SCREENSHOTS` optionally captures the German layouts. Source evidence,
known limits and installation instructions are in [the bundle library](../blueprints/README.md).
