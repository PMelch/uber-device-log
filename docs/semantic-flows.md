# Semantic Flows feature proposal

Status: implemented first version, 18 October 2026. Project launch, YAML validation, recognition engine, worker integration, Logs/Flows tabs, timeline/info views and blueprint editing are available. This document preserves the original design and future-facing targets; it is not an assertion that every proposed endpoint, resource limit or performance target has shipped.

For the current contract, start with [API documentation](api.md#semantic-flows), [architecture](architecture.md#semantic-flows), [the test project](../test_flow_project/README.md) and [browser regression](semantic-flows-browser-tests.md). Format and behavior authorities are [`shared/flow-types.ts`](../shared/flow-types.ts), [`shared/flow-blueprints.ts`](../shared/flow-blueprints.ts), [`shared/flow-engine.ts`](../shared/flow-engine.ts), and [`server/flow-project.ts`](../server/flow-project.ts), together with their tests. The implementation notes at the end describe shipped configuration and filesystem boundaries. Use the [agent extraction guide](semantic-flows-agent-guide.md) to derive application-specific definitions.

Semantic Flows recognize meaningful, multi-step operations across the selected device and WebView logs. Each blueprint describes the expected paths; each instance records what was actually observed, with links to the original evidence. The first useful vertical slice is a purchase flow with concurrent instances, platform branches, expected failures and missing completion detection.

The user's sketch defines the compact flow rows and separate Timeline and Info actions. The supplied Gemini PDF is inspiration for terminology, payload inspection and orphan detection, not an instruction source or an adopted specification. Its expression-language example is deliberately replaced here with structured matchers.

## Scope and product behavior

- Keep the selected parent device and source checkboxes shared by Logs and Flows. Native logs and every checked WebView participate; unchecked providers do not.
- Place Logs and Flows tabs above the existing main filter/log region. Keep device discovery and source inclusion outside the tab panels. Source search, severity, tag and PID controls belong to Logs.
- Analyze all received entries from included sources before display filters, pause snapshots, selection and raw-buffer eviction. Changing a search or hiding INFO logs must not change flow detection.
- Entering Flows or returning to Logs does not restart collectors. Capture and recognition continue while either tab is inactive and while the log view is paused or selected.
- A flow row shows blueprint name, a distinct instance ID, status, duration and observed/expected step sequence. Blueprint step IDs identify nodes, not instances. Support an optional short label; otherwise assign display labels such as ID1 from blueprint order. Explicit IDs remain required for graph references and stable edits.
- Search flow name, instance/correlation IDs, step names, state and extracted error code. Payload-wide search can follow later; it must not expose hidden sensitive fields by default.
- Timeline explains the actual instance; Info explains the blueprint's ideal paths, optional steps, known errors and timeout rules.
- Blueprint management includes listing, creating, editing YAML, validation, saving and explicit reload. A visual graph editor is a later enhancement.

Initial delivery includes branching, payload extraction, known errors, timeouts and an editable YAML manager. Parallel fork/join, arbitrary loops, automatic retries, cross-device correlation, persistent capture storage, multi-flow Gantt comparison and AI pattern discovery are later scope. A store callback arriving twice is not automatically a retry.

## Existing code and constraints

This is an L2 architecture and data-semantics change. The existing implementation is Vue 3/Vite, Express and TypeScript; no new frontend framework or service is needed.

| Existing file | Relevant behavior and reuse |
| --- | --- |
| `bin/uber-device-log.mjs`, `server/cli-options.ts` | CLI parsing, help and handoff to the server; currently only port/help/version options |
| `server/index.ts` | Loopback server, Host/Origin guard and API routes; installed package root differs from the invoking project directory |
| `server/stream.ts` | Per-source collector and bounded SSE queue; can drop records, truncates messages to 16,384 characters |
| `src/log-streams.ts` | One EventSource per selected source, stale callback protection and a 50 ms batcher that may compact pending records |
| `src/App.vue` | Source selection, metadata assignment, raw buffering, pause, clear and collector reconciliation |
| `shared/types.ts` | `LogMessage` has original timestamp/message and optional level/tag/PID/source; no application request ID or durable transport event ID |
| `shared/log-sources.ts` | Immutable-record merge, source identity and display filtering; display timestamp sorting cannot establish causality |
| `shared/log-details.ts`, `shared/log-view.ts` | Existing conservative payload/stack presentation; reuse presentation without silently inferring correlation |
| `src/components/PrecisionMenu.vue`, `src/composables/useDisclosureDismissal.ts` | Existing keyboard/disclosure patterns |
| `src/i18n/`, `shared/notifications.ts` | Seven catalogs, context descriptions and stable notification codes with English fallback |
| `docs/design/README.md`, `docs/testing.md` | Precision design direction, UI invariants and validation workflow |

A browser tab currently owns its collectors. The initial engine should therefore run per browser session in a worker, with pure shared TypeScript logic. Server-side recognition would otherwise require a new shared capture/session model and could mix tabs' selected providers. Filesystem access belongs exclusively to the local server.

Proposed names follow local conventions: `shared/flow-types.ts`, `shared/flow-blueprints.ts`, `shared/flow-engine.ts`, `server/flow-project.ts`, `server/flow-blueprints.ts`, `src/composables/useFlows.ts`, `src/flow-worker.ts`, and focused Vue components such as `FlowList.vue`, `FlowTimeline.vue`, `FlowInfo.vue`, `FlowBlueprints.vue`. New domain names FlowBlueprint, FlowInstance and FlowStep have no existing local equivalent and are introduced intentionally. Tests remain discoverable as `server/*.test.ts`, including shared and browser logic.

## Project discovery and configuration

Proposed equivalent invocations:

```sh
npx uber-device-log --project=.
npx uber-device-log --flows=.
```

Both flags identify a project directory using `.udl/config.yaml`; `--flows` is an alias for the project root, not a direct YAML file or blueprint directory. Accept `--project <dir>` and `--flows <dir>` too. Reject using both flags, even when equal, to avoid ambiguous precedence. Resolve the flag relative to the invoking `process.cwd()`, never the installed package or worktree path. Do not walk parent directories implicitly.

Without either flag, retain normal log-only startup. With a flag, require a readable project directory; create a missing `.udl/` directory and empty `.udl/config.yaml`. Invalid existing configuration fails clearly at startup, with path and useful diagnostics. `--help` and `--version` remain usable without loading project files.

Use YAML for `.udl/config.yaml`, with the optional flow setting below; other project settings may coexist:

```yaml
blueprints: .udl/flows
```

An empty configuration defaults to `.udl/flows`. Resolve the directory relative to the project root. For the initial version require it to stay within the project root after realpath resolution. Read `.yaml` and `.yml` directly inside that directory, excluding `.draft.yaml` and `.draft.yml` suffixes, sorted by filename; no recursive discovery in v1. A missing blueprint directory produces a recoverable Flows state and a create-directory action; an empty directory is valid. Bad blueprints leave Logs usable and display file/line diagnostics; there is no partial activation of an invalid file. Reject duplicate blueprint IDs across the active set.

Use a maintained YAML parser with a restricted JSON-compatible schema, no executable tags, no aliases, duplicate-key rejection, and explicit file/depth/node/count limits. Dependency choice and exact limits are implementation decisions to verify against current official documentation before adding the dependency. Keep the example below under `docs/` until a loader and schema exist; do not accidentally enable sample patterns on real logs.

## Agent documentation for extracting blueprints

[Extracting Flow Blueprints from application code](semantic-flows-agent-guide.md) is the agent-facing Markdown guide. It defines code tracing, evidence reports, emitted log format verification, payload producer/consumer references, branch/error analysis, missing instrumentation and fixture validation. Keep this guide aligned with the versioned schema as SF2 is implemented. Validate the workflow against a real application repository before calling extraction production-ready.

## Blueprint model and purchase example

Use a versioned directed graph. A step matcher establishes evidence; graph edges establish valid progress. Mandatory means required on the chosen route, not required on every possible route. Optional nodes may be bypassed explicitly; unchosen routes are not missing steps.

The version 1 DSL is implemented by `shared/flow-blueprints.ts`; `test_flow_project/.udl/flows` contains executable examples. Example messages are fictional JSON records inside `LogMessage.message`. Existing adapters also deliver unstructured text, which needs blueprint-specific extraction.

```yaml
version: 1
id: purchase
name: Purchase
description: Follow a purchase from backend initialization to balance update.
start: backend_init
timeout: 90s
correlation:
  scope: device-session
  primary: attemptId
  aliases: [purchaseUid]
steps:
  - id: backend_init
    shortLabel: ID1
    name: Initialize purchase on backend
    match: { source: any, json: { path: event, equals: purchase.init } }
    extract:
      attemptId: { json: attemptId, required: true }
    next: [backend_ready]
  - id: backend_ready
    name: Receive backend UID
    match: { source: any, json: { path: event, equals: purchase.ready } }
    extract:
      attemptId: { json: attemptId, required: true }
      purchaseUid: { json: uid, required: true }
    next: [store_ios, store_android]
  - id: store_ios
    name: Start App Store purchase
    match: { source: any, json: { path: event, equals: store.ios.start } }
    extract:
      purchaseUid: { json: uid, required: true }
    next: [receipt]
  - id: store_android
    name: Start Play Store purchase
    match: { source: any, json: { path: event, equals: store.android.start } }
    extract:
      purchaseUid: { json: uid, required: true }
    next: [receipt]
  - id: receipt
    name: Receive store result
    match: { source: any, json: { path: event, equals: store.receipt } }
    extract:
      purchaseUid: { json: uid, required: true }
      storeTransactionId: { json: payload.transactionId, required: true }
      receipt: { json: receipt, sensitive: true }
      payload: { json: payload, sensitive: true }
    next: [receipt_debug, submit]
  - id: receipt_debug
    name: Optional receipt diagnostic
    optional: true
    match: { source: any, json: { path: event, equals: store.receipt.debug } }
    extract:
      purchaseUid: { json: uid, required: true }
    next: [submit]
  - id: submit
    name: Send receipt and payload to backend
    match:
      source: any
      all:
        - json: { path: event, equals: purchase.submit }
        - json: { path: transaction_id, equalsFrom: { step: receipt, field: storeTransactionId } }
    next: [confirmed]
  - id: confirmed
    name: Backend confirms purchase
    match: { source: any, json: { path: event, equals: purchase.confirmed } }
    extract:
      purchaseUid: { json: uid, required: true }
    next: [balance]
  - id: balance
    name: Receive new balance over socket
    match: { source: webview, json: { path: event, equals: balance.updated } }
    extract:
      purchaseUid: { json: purchaseUid, required: true }
      balance: { json: balance }
    outcome: completed
errors:
  - id: store_failure
    appliesTo: active
    match: { source: any, json: { path: event, equals: store.error } }
    extract:
      purchaseUid: { json: uid, required: true }
      code: { json: code, required: true }
      stack: { json: stack }
    codeField: code
    codes:
      USER_CANCELLED: { description: User cancelled the purchase., outcome: cancelled }
      PAYMENT_DECLINED: { description: Store declined payment., outcome: failed }
    unknownOutcome: failed
```

`source` supports `any`, `device` and `webview`, with optional platform/tag/level constraints. It selects providers that are already included; it never opens a provider. The example intentionally requires a WebView balance event: without that provider, completion is unobservable and the UI should warn about coverage. Real socket events may carry only account ID and balance; those cannot reliably distinguish simultaneous purchases. Add a shared purchase identifier to logging or explicitly document heuristic ambiguity; a balance change alone must not complete an arbitrary pending purchase.

Matchers support literal containment, equality and bounded regular-expression matching on original message text, plus JSON field equality. JSON paths initially mean dot-separated object properties only, without JSONPath expressions, wildcards or script execution. Parse JSON only when the entire trimmed message is valid JSON; prefixed native records use explicit text/regex extractors. A regex extractor names its capture group and field; missing required extracts fail that candidate with a diagnostic. Optional extract absence does not invalidate a match. No `eval`, embedded JavaScript or free-form query language.

Validate syntax and semantics: version, unknown fields, duration units, unique IDs, start existence, edge targets, reachability, at least one reachable terminal, illegal terminal edges, unsupported cycles, extractor shapes, correlation requirements and error-code outcomes. Each optional node needs an explicit bypass from its predecessor. `optional` documents that bypass; it does not invent edges. Error rules can target all active positions or selected step IDs, including initialization failures correlated by attemptId before a purchaseUid exists.

## Payload values as inputs to later steps

A step's extracted payload is also an input to recognition. Later steps must be able to compare incoming fields against values extracted by earlier accepted steps in the same flow instance. This supports new identifiers introduced during the operation, not only the primary correlation keys configured at the top of a blueprint.

For example, the accepted receipt step can extract a store transaction ID from its payload:

```yaml
# Field in receipt.extract:
storeTransactionId: { json: payload.transactionId, required: true }
```

The submit step can then require that ID, even when the next log uses a different field name. It does not require a `purchaseUid` extraction when that field is absent from the submission record:

```yaml
# submit.match (no uid extraction is needed):
match:
  source: any
  all:
    - json: { path: event, equals: purchase.submit }
    - json:
        path: transaction_id
        equalsFrom: { step: receipt, field: storeTransactionId }
```

`all` combines structured predicates. `equalsFrom` is a typed reference into the candidate instance's accepted step extractions, not string interpolation or executable code. The referenced step/field must exist in the blueprint. Values are resolved per instance; an ID learned by one purchase never becomes a global matching variable. A downstream record without the original attemptId or purchaseUid can be assigned using this predicate only when the referenced value uniquely identifies one eligible instance in the current session/device/revision scope. Multiple candidates remain ambiguous.

Evaluate matching and extraction provisionally, then commit the observation, its payload and any new bindings atomically only after the step is accepted. A rejected candidate cannot seed later matches. Referencing an unobserved step or absent extraction never matches, including when both sides are missing. Use exact type-preserving equality for scalar values; IDs should be logged/extracted as strings to preserve leading zeros and large integers. Never treat extracted content as a regex or query. Reject conflicting rebindings rather than overwriting accepted evidence.

Validate references and dependency order alongside graph edges. A reference to a future step, itself, or a field unavailable on a possible incoming route is invalid unless the blueprint explicitly constrains that route. A reference to an optional step therefore requires a route on which that step was observed; bypass routes need a separate matcher. Out-of-order records may be retried inside the existing bounded pending window once their referenced values become available. Missing-start candidates preserve unresolved references as missing evidence and cannot fabricate the required context.

Timeline should show each extracted value's source step and original field path, and explain which comparison identified a later step. Display concealment for sensitive fields also applies to these explanations. Implement this in SF2/SF3 as part of the initial blueprint language and engine.

## Recognition and correlation rules

1. Normalize each received record into an immutable envelope with session ID, provider generation, source key, local sequence, original timestamp and monotonic receipt time. Keep original message and metadata intact. Attach source metadata before worker delivery.
2. Feed the worker before the existing browser batcher can compact data. Candidate indexes by literal/event/source narrow matching work. Keep worker ingress bounded and emit an explicit analysis-gap diagnostic if overloaded; never silently discard analysis records.
3. Partition by capture session and physical device, then blueprint revision. Match primary/alias identifiers exactly. A bridging record containing attemptId and purchaseUid can register an alias only if it resolves uniquely and does not conflict. Account/session IDs alone are not unique operation IDs.
4. A valid start creates an instance. A missing primary ID does not fall back to the most recently started flow. A non-start event without a known start creates an orphan candidate only with a unique configured correlation identifier; otherwise retain a bounded unmatched diagnostic. Conflicting aliases never merge instances silently.
5. Evaluate eligible successors, including explicit optional bypasses. Outgoing alternatives are exclusive branches; selecting one records the route, and merge nodes converge that route. If one record matches multiple eligible successors, record ambiguity instead of using YAML order. Global error rules take precedence over ordinary progression; overlapping error rules also require unambiguous selection.
6. A terminal success completes only when every mandatory node on the chosen route is observed. An early success marker is evidence of an incomplete sequence, not proof of completion. Failure or cancellation can terminate at any applicable step. Unknown error codes preserve the original code and data and use the configured fallback outcome.
7. Store payloads per step occurrence with provenance. Provide an aggregate context view, but preserve field conflicts and extraction history instead of overwriting earlier receipt/error evidence. An observation is an instant; step-to-step duration measures a gap, not proven execution time.

At most one progression step consumes a given envelope within one blueprint instance. One record may be evidence for different blueprints. Exact transport IDs, when available, support deduplication; the local sequence alone does not deduplicate replay. Never hash text and timestamp as a universal duplicate rule because repeated identical logs may be real events.

Source reopening currently replays history and removes the source's old raw buffer. For v1, changing included sources or reconnecting starts a new analysis epoch and interrupts active instances, retaining their history with its original source set. Start fresh collectors for the included set so one epoch does not combine fresh native capture with replayed WebView history. This is a deliberate change from current source reconciliation: test it explicitly and show that sources restarted. Exact replay deduplication within the same epoch remains a future transport contract; epoch boundaries prevent replay from changing old instances.

## Time, missing evidence and orphaned flows

Use separate concepts rather than overloading a single error badge:

| Dimension | Values and meaning |
| --- | --- |
| Outcome | running, completed, failed, cancelled, timed_out, interrupted |
| Completeness | complete, missing_start, missing_steps, capture_gap, ambiguous |
| Step observation | observed, expected, skipped_optional, not_on_route, failed, missing |

The UI can group timed-out instances and missing-start candidates under Orphaned, while explaining the exact cause. A timeout means the expected end was not observed within the blueprint deadline; it does not prove a crash or purchase failure. `interrupted` applies when the device/session/source set ends before the deadline.

Use monotonic receipt time for live elapsed duration and deadlines, injected for tests. Keep original event timestamps for the timeline; mark clock conflicts, invalid timestamps and inferred timing. SSE currently exposes no reliable historical/live boundary: historical replay is only the observed evidence, and its actual original execution duration must not be replaced with a claimed device runtime. Add adapter replay metadata before offering event-time timeout accuracy.

Buffer out-of-order evidence per instance for a bounded 2-second receipt window, with a maximum record count. Re-evaluate pending evidence as predecessors arrive; preserve original timestamps. After the window, keep unmatched/late evidence and mark missing sequence instead of inventing predecessors. Record the chosen ordering basis in Timeline. Retain timed-out instances for late evidence: keep the timeout event and show a late terminal result without rewriting the original timeout. Do not resurrect an old epoch or silently attach ambiguous identifier reuse.

Propagate per-source capture-gap controls for SSE drops, terminal queue loss, truncation and worker overflow. Today SSE reports some dropped counts but does not identify every loss or expose truncation. Extend the envelope/control contract to make these limitations visible; until then completeness is best-effort. A disconnected source, disabled required provider or loss of records must not be presented as a proven application failure.

## Views and interactions

Retain Precision's restrained colors, typography and compact density. Use color plus icon/text for status. The sketch's circles/arrows become a compact sequence per row; show all chosen-route steps in Timeline and all branches in Info. Collapse long sequences with an accessible expand control. Desktop rows show actions alongside the title; mobile stacks metadata/actions and scrolls the step sequence within its own region.

Timeline opens a drawer with observed and expected steps, elapsed gaps, source attribution, payloads, known/unknown error code and original stack/log records. Link to raw evidence by stable capture ID; if its raw-buffer row was evicted, show retained evidence locally instead of pretending a scroll target exists. Info uses the pinned blueprint revision to show possible branches, known errors and mandatory/optional nodes. Blueprint edits must not change the meaning of historical instances.

Clear in Flows starts a new analysis epoch and discards flow instances, pending matches and ingress queued before the boundary. Capture continues, and raw Logs remain intact. Clear in Logs keeps its existing viewer-only behavior and does not erase Flows. Events after a flow clear can form missing-start candidates; explain why. Search filters only the flow list. No implicit flow persistence or payload upload.

Provide distinct states for no project mode, loading, missing directory, empty blueprint set, invalid blueprint diagnostics, no selected sources, no matches, no search results, analysis gaps and worker failure. A worker failure keeps Logs functional and offers an explicit restart that opens a new epoch. Blueprint manager needs dirty-state protection, validation results, external-file conflict handling and failed-save recovery.

Use semantic tablist/tab/tabpanel roles, arrow/Home/End tab navigation, visible focus, labelled search, keyboard-accessible step details, Escape dismissal and focus restoration. Do not announce every incoming event to screen readers; summarize meaningful status changes. Check 360 px mobile and desktop widths, long German/French translations, light/dark themes and reduced motion.

Every product string and accessibility label needs translator context first, then English, Spanish, German, French, Italian, Japanese and Simplified Chinese catalogs. Stable state/error codes remain in state; translate on render so switching language updates open panels and existing messages. Blueprint-authored names/descriptions and extracted data remain verbatim. Built-in explanations and unknown-code messages are localized; original logs, payloads, codes, identifiers and product name stay verbatim.

## File management and API proposal

The server owns one configured project root; the browser never submits arbitrary filesystem paths. Retain Host/Origin checks. Writes additionally require JSON content type and a per-process capability token obtained by the same-origin client; cross-origin pages must not get a file-write primitive. Never run blueprint code or render extracted HTML.

| Route | Proposed contract |
| --- | --- |
| `GET /api/flows/snapshot` | One complete validated active set, project metadata, per-process token, files/sources/content revisions and diagnostics in a single response; ETag supports conditional polling |
| `POST /api/flows/validate` | Draft source to schema/graph diagnostics; no write or activation |
| `POST /api/flows/blueprints` | Validated basename plus source; create only, conflict if already exists |
| `PUT /api/flows/blueprints/:filename` | Source plus expected revision; validate complete candidate set and atomically replace |
| `POST /api/flows/reload` | Read/validate full set and activate one immutable snapshot |

Diagnostics carry stable code, parameters, English fallback, relative file, line, column and schema path. Use existing notification conventions for UI messages; file excerpts remain data. A save activates the full valid snapshot for new instances; active instances pin the old snapshot, and old instances are excluded from new-start matching. Existing instances still process against their pinned revision. An invalid reload keeps the last valid set active and clearly reports the rejected files; an invalid initial load activates none.

Each client fetches `/api/flows/snapshot` on initialization, immediately after its own successful save/reload, on window focus, and every three seconds while open. The complete response is captured from one server snapshot; clients never assemble active definitions through individual file reads. On a changed ETag, deliver that complete set to the worker in one activation message. The worker validates the contract, installs it atomically at a record boundary, and acknowledges the revision before the client shows it as active. Existing instances keep their pinned definitions. Records already queued retain their activation boundary; new starts after activation use only the new set. Other tabs may lag until their next poll and must show the last worker-acknowledged revision rather than claiming server-wide instantaneous activation. Bound retained revisions by instance lifetime; polling errors keep the acknowledged snapshot with an explicit stale status.

Limit filenames to plain `.yaml`/`.yml` basenames; resolve opaque handles server-side. Reject traversal, symlinks and paths outside the configured real directory on reads and writes. Use exclusive creation, atomic same-directory replacement and revision checks to prevent overwriting external edits. Enforce request/file/blueprint/graph/extraction limits, disallow YAML alias expansion, and run regex work in an interruptible worker with a time budget so a pathological pattern cannot freeze capture or the UI.

Sensitive payload fields are concealed by default and explicitly revealable. This is display concealment, not secure deletion: the original raw log may already contain the receipt. Do not put flow payloads in localStorage, URLs, telemetry or diagnostics. Initial v1 has no flow export; raw-log export keeps its existing original-data contract.

## Implementation sequence and acceptance criteria

| Ticket | Deliverable and dependencies | Acceptance criteria |
| --- | --- | --- |
| SF1 | CLI and filesystem discovery | Both aliases and argument forms resolve from caller cwd; conflicting flags fail; help/version bypass loading; missing/invalid config and default directory behavior covered; installed-package smoke works outside checkout |
| SF2 | Versioned schema, parser, graph validator and fixtures; SF1 | Agent extraction guide matches the schema and includes source evidence, payload dependencies and draft handling; purchase blueprint validates; unknown fields, duplicate IDs/keys, invalid regex, alias expansion, unreachable nodes, cycles, bad edges and ambiguous optional bypasses give located diagnostics |
| SF3 | Pure engine with injected clock; SF2 | Concurrent purchases never mix; per-instance payload references across differently named fields, identification without the original correlation key, absent/wrong-type/conflicting values, ambiguous reused IDs, rejected-candidate isolation, optional-branch dependencies, deferred out-of-order references, alias binding, platform route merge, optional steps, known/unknown error codes, cancellation, missing start, early terminal, conflicting candidates and timeout/late evidence pass deterministic fixtures |
| SF4 | Capture envelope, gap controls, worker and session lifecycle; SF3 | Recognition precedes browser compaction and display filters; pause/tab/selection preserve recognition; clear boundary discards queued analysis; source changes open epochs; overload/disconnect/replay cannot silently claim completeness |
| SF5 | Logs/Flows tabs, list, search, Timeline and Info; SF4 | Sketch behavior, original payload/stack evidence, evicted raw-row fallback, pinned revisions, all empty/error states, mobile/desktop keyboard and seven-locale checks pass |
| SF6 | Blueprint list/create/edit/validate/save/reload; SF1/SF2/SF5 | Invalid drafts never activate; atomic save and external-edit conflicts covered; live/historical instances keep revisions; concurrent edits cannot produce mixed snapshots, two tabs converge through polling and acknowledge worker activation; traversal, symlinks and cross-origin writes rejected |
| SF7 | Hardening, package/docs and performance; SF1-SF6 | `npm test`, `npm run build`, package smoke and browser fixtures pass; source capture remains responsive under pathological matchers and bounded overload |

Use Red-Green-Refactor for each implementation ticket. The testability audit supports Node's existing test runner for parser/engine/worker contracts, temporary filesystem fixtures for configuration and writes, mock clocks for deadlines, and Vue SSR plus browser fixtures for UI. No physical phone is required for deterministic flow semantics; real Android/iOS/native/WebView capture needs its own hardware smoke evidence.

Start with recorded fictional fixtures for two overlapping purchases, iOS/Android branches, optional diagnostics, cancellation, backend error, uncorrelated balance event, missing start, timeout, late terminal, truncated JSON, multiline error, provider loss and replay. Run the full existing suite/build at completion. Check installed-package boundaries when adding modules/dependencies; the existing package allowlist covers only flat `build/server/*.js` and `build/shared/*.js`, so nested output would need an explicit update. Vite's emitted worker asset must work under production static serving.

Historical design targets (not the implemented resource contract): 100 blueprints, 100 nodes each, 256 KiB per YAML file, 500 active and 2,000 retained terminal instances, 100 pending records per instance and a 32 MiB aggregate evidence budget. Retain at most 64 KiB of extracted payload per step and keep original-record excerpts with truncation flags. Evict terminal history first; if active/evidence limits are reached, mark affected instances incomplete/interrupted and report counts rather than dropping evidence invisibly. Bound retained revision snapshots by retained instance lifetime and include them in the memory budget.

Measure against the committed synthetic workload (10,000 initial records, bursts up to 5,000 records/second), with a separate 20-blueprint representative fixture. Require bounded memory/queue growth and working tab/search/clear controls during load. Record baseline and added analysis latency; target 95th-percentile receipt-to-flow-update under 250 ms on the documented test host, then adjust limits from measurements rather than claiming this as an established guarantee.

## Decisions to verify with real project logs

The defaults above allow preparation to proceed. Before binding actual purchase patterns, obtain representative anonymized lines showing where attemptId, purchaseUid, store receipt and socket balance correlation appear in each selected source. If no stable bridge exists, logging instrumentation is needed for reliable concurrency; broad time-window matching can only offer explicitly ambiguous suggestions.

Confirm the chosen v1 epoch behavior when a source is toggled, and whether future projects need blueprints outside the project root or nested directories. Neither is needed for the initial graph/engine design. Implementing payload joins without real evidence is the largest correctness risk; prioritize that validation before polishing the blueprint editor.

## Implemented local project workflow

Run `npm run dev -- --project=./test_flow_project` from the repository root, or `node bin/uber-device-log.mjs --flows=./test_flow_project` after a build. The fixture README describes emitting matching JSON console events from an inspected WebView. No sample events are injected automatically.

The snapshot endpoint includes the configured project name and relative blueprint directory, token, active blueprints/revision, current file sources/revisions and diagnostics. The client sends `X-Flow-Token` plus `Content-Type: application/json` on every flow mutation, including validation and reload. Create accepts `{filename, source}`, update accepts `{source, revision}` and validate accepts `{filename, source}`. A successful create/update returns a complete snapshot; invalid sets return status 422 with `{diagnostics}`, and conflicts return 409 with `{diagnostics}`. Initial invalid blueprints activate none; invalid external reloads retain the last complete valid definitions and active revision while exposing current file sources and diagnostics for repair. The project root and `.udl/config.yaml` are fixed at startup; changing `.udl/config.yaml` requires restarting.

Initial limits: 256 KiB per file, 100 blueprint files, 100 steps per blueprint, 50 error rules, 50 extraction fields, 20 conjunctive predicates per matcher, matcher depth 12, YAML depth 32 and 12,000 YAML nodes. Paths reject prototype properties; regex extractors require an existing named capture group. `equalsFrom` producer steps must dominate the consuming step on every route; optional branch-dependent values therefore require distinct route steps. Error rules currently support ordinary matchers; `equalsFrom` in an error rule is rejected because guaranteed availability cannot be established for all active positions.

Filesystem consistency boundary: API saves are serialized and compare the expected content revision again immediately before atomic replacement. Regular files are opened with `O_NOFOLLOW`/`O_NONBLOCK`, descriptor type/size are verified, and reads are capped even if a file grows. Portable Node filesystem APIs do not provide an external-process compare-and-swap rename or descriptor-relative directory traversal: a same-user process racing a parent-directory replacement or writing between the last revision check and rename remains outside this consistency guarantee. Static symlinks and traversal paths are rejected; ordinary external editor changes observed before the final check produce a conflict.
