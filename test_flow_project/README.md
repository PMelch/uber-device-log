# Semantic Flows test project

From the repository root:

```sh
npm run dev -- --project=./test_flow_project
# Or after npm run build:
node bin/uber-device-log.mjs --flows=./test_flow_project
```

The flag resolves relative to the shell's working directory. `.udl/config.yaml` configures `.udl/flows`, containing purchase, login and asset-download blueprints. These fictional patterns are active only when this project is explicitly selected. Blueprint names/descriptions are author data and remain verbatim across UI languages.

## Emit real captured console records

Serve this directory with `python3 -m http.server 8088 --directory test_flow_project`, then open `emit-demo.html` inside the test application's inspected WebView (use the computer's LAN address on a phone, with suitable local network access). Select that WebView provider in Über Device Log, open Flows, then press a demo button. The purchase blueprint requires its final balance event from WebView; device-only capture intentionally cannot prove completion. If your WebView cannot navigate here, copy the emitter script into its developer console, or instrument your test app to emit the lines from `sample-events.jsonl` with `console.log(JSON.stringify(record))`.

The sample demonstrates a happy purchase, an Android route, per-instance receipt transaction ID reused by a differently named field in the submit event, login completion, a known asset error with stack, a missing-start login and a purchase timeout. The submit event deliberately omits the original purchase UID: `equalsFrom` identifies it from the receipt payload. The HTML emitter assigns fresh IDs for each button run. A timeout is observable after 90 seconds; it does not prove an application failure. The cancellation button produces `USER_CANCELLED`.

`sample-events.jsonl` contains original message objects, not LogMessage transport envelopes. It is a source fixture to emit from your application; selecting the project never injects synthetic records into normal capture. The standalone emitter page is a developer fixture, not part of the localized product UI.

Files ending in `.draft.yaml` or `.draft.yml` are inactive and ignored during discovery. An invalid active YAML file still rejects activation of the new set; the last valid set remains active when available. The editor requires an active filename when saving.
