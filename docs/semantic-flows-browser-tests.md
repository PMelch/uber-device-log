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
