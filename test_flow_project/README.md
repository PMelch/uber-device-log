# Semantic Flows test project

From the repository root:

```sh
npm run dev -- --project=./test_flow_project
# Or after npm run build:
node bin/uber-device-log.mjs --flows=./test_flow_project
```

The flag resolves relative to the shell's working directory. `.udl/config.yaml` configures `.udl/flows`, containing purchase, login, asset-download, fictional bank-transaction and repeatable loading-progress blueprints. These fictional patterns are active only when this project is explicitly selected. Blueprint names/descriptions are author data and remain verbatim across UI languages.

## Emit real captured console records

Serve this directory with `python3 -m http.server 8088 --directory test_flow_project`, then open `emit-demo.html` inside the test application's inspected WebView (use the computer's LAN address on a phone, with suitable local network access). Select that WebView provider in Über Device Log, open Flows, then press a demo button. The purchase blueprint requires its final balance event from WebView; device-only capture intentionally cannot prove completion. If your WebView cannot navigate here, copy the emitter script into its developer console, or instrument your test app to emit the lines from `sample-events.jsonl` with `console.log(JSON.stringify(record))`.

The sample demonstrates a happy purchase, an Android route, per-instance receipt transaction ID reused by a differently named field in the submit event, login completion, a known asset error with stack, a missing-start login and a purchase timeout. The submit event deliberately omits the original purchase UID: `equalsFrom` identifies it from the receipt payload. The HTML emitter assigns fresh IDs for each button run. A timeout is observable after 90 seconds; it does not prove an application failure. The cancellation button produces `USER_CANCELLED`.

`sample-events.jsonl` contains original message objects, not LogMessage transport envelopes. It is a source fixture to emit from your application; selecting the project never injects synthetic records into normal capture. The standalone emitter page is a developer fixture, not part of the localized product UI.

Files ending in `.draft.yaml` or `.draft.yml` are inactive and ignored during discovery. An invalid active YAML file still rejects activation of the new set; the last valid set remains active when available. The editor requires an active filename when saving.

## Fictional bank transaction example

`bank-transaction-events.jsonl` is a **separate synthetic application-message fixture** for `.udl/flows/bank-transaction.yaml`. Its event names, recipients, account strings and references are invented; it is not a real banking integration or evidence of a bank API. The default emitter and `sample-events.jsonl` remain unchanged. Selecting this project never emits or replays the bank records automatically.

For an easy interactive check, serve this directory with `python3 -m http.server 8088 --directory test_flow_project`, then navigate an inspectable application WebView to `http://<computer-LAN-address>:8088/bank-transaction-demo.html`. Keep the test app's WebView inspection enabled, select that WebView provider in Über Device Log, and open Flows. Choose a bank-demo button; each click emits fresh IDs, so several routes can run concurrently. The page also offers a pending-review case with no decision and a completion-free timeout case. It performs no network requests or real transactions. Use Detailed to see branches or Condensed to inspect labels/results; open Timeline for payloads and explicit sensitive reveal.

The bank fixture interleaves seven distinct transaction IDs: automatic completion, insufficient funds, fraud screening, explicit user cancellation, manual review followed by approval, manual review followed by rejection, and an accepted request whose completion is not observed. Emit its JSON objects through a selected captured logger, for example with `console.log(JSON.stringify(record))`. Keep each object's `transactionId` unchanged within that transaction. Emit in file order to reproduce the scenarios; completion-free transactions time out after 60 seconds, indicating missing completion evidence rather than an invented bank failure.

Each state can change the instance label. Known error codes have specific labels; manual review is pending until an explicit decision arrives. `amount`, `currency`, `recipient`, `reference` and `errorCode` illustrate `result: true`. The fictional recipient `account` result is marked sensitive, as is its use in a separate completion-label part. Detailed and Condensed show the same labels/results, while only Detailed shows overview nodes. Both overview modes conceal sensitive values; Timeline remains available for evidence and explicit sensitive reveal.

Run `node --import tsx --test server/bank-transaction-sample.test.ts` from the viewer checkout for synthetic recognition and presentation checks. Derive production blueprints from actual source/log evidence using [the agent guide](../docs/semantic-flows-agent-guide.md), and validate the [label/result syntax](../docs/flow-format.md#labels-and-result-fields) before activation.

## Repeatable loading progress example

`.udl/flows/loading-progress.yaml` recognizes a fictional `loading.started → loading.progress → loading.completed` operation. The progress step is `optional: true` and `repeatable: true`, and start explicitly permits direct completion. Zero, one or many progress messages therefore belong to the same instance; the `loadId` on every event identifies it. The graph has no self-loop, and unrelated standalone progress does not create a missing-start instance.

Serve this directory with `python3 -m http.server 8088 --directory test_flow_project`, then open `http://<computer-LAN-address>:8088/loading-progress-demo.html` inside an inspectable application WebView. Start the viewer with this project, select that WebView provider and open Flows. Each button emits a new load ID and performs no network requests or downloads. Routes cover normal progress, backward percentages, no progress, explicit errors, cancellation and no completion. Click several buttons quickly to test overlapping instances.

`loading-progress-events.jsonl` is a separate synthetic application-message fixture; it leaves `sample-events.jsonl` and the existing demos unchanged. Emit its objects in order through a captured logger. Progress 0 → 50 → 40 → 100 updates one label/result as received. A terminal completion supplies a distinct success label; a deliberately late progress record cannot replace it. The percentage does not prove completion. Repeated updates never extend the original 30-second deadline, and timeout is missing-completion evidence rather than an invented loading error.

Detailed shows the same latest label/results as Condensed, plus overview nodes. Timeline retains repeated observations within the analysis memory budget. The latest accepted progress occurrence supplies later `equalsFrom` comparisons; no keyless or most-recent-instance correlation is used. Run `node --import tsx --test server/loading-progress-sample.test.ts` from the viewer checkout to validate and replay the fixture and exercise the emitter without network APIs. Read [the format reference](../docs/flow-format.md#repeatable-progress-phases) before adapting it to a real application's verified logs.

The fictional [alternative-entry example](.udl/flows/entry-routes.yaml) recognizes
`entry.interactive` and `entry.background` as separate starts of the same graph,
then continues through `entry.processing` and `entry.completed`. Both entries
publish a required shared `token` from their respective payload shapes. See the
[format reference](../docs/flow-format.md#multiple-entry-points-and-shared-variables)
for optional references and guarantees at joins.
