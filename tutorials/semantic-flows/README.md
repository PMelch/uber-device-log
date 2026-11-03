# Your first Semantic Flows

**Turn application logs into a readable record of what happened.** A Blueprint is
a small YAML file that tells Über Device Log which messages belong to an operation,
what order to expect and which message proves its outcome. It recognizes captured
evidence; it does not run your app or infer events that were never logged.

Follow these three tutorials in order, or start with the shape that matches your logs.
Each includes a complete Blueprint, copyable log records and the expected result.

| Tutorial | You will build | What you learn |
| --- | --- | --- |
| [1. A single event](single-event/README.md) | An “App ready” card from one message | Matching and immediate completion, without an operation ID |
| [2. A multipart operation](multipart/README.md) | A sync with start, receive and finish steps | Correlation IDs, overlapping operations and timeouts |
| [3. An operation with branches](branching/README.md) | A checkout that is accepted or rejected | Alternative routes and explicit outcomes |

## Set up once

These examples follow the source version in this checkout. First complete
[Run from source](../../README.md#run-from-source), including dependency installation.
Then, **from the viewer repository root**, start with this tutorial project:

```sh
npm run dev -- --project=./tutorials/semantic-flows
```

Open the address printed by the server. The included `.udl/config.yaml` contains:

```yaml
blueprints: .udl/flows
```

It loads the three files in [`.udl/flows`](.udl/flows). Open **Flows → Blueprints**
to inspect them. You can edit and validate a Blueprint there; save it to activate
the new definition. Start with the supplied files before changing event names.

### Get the example logs into the viewer

1. Connect an Android or iOS device and make your test app's WebView inspectable.
   Follow the [Android](../../README.md#android-webview-consoles) or
   [iOS](../../README.md#iphone-and-ipad-webview-consoles) setup instructions.
2. Select that WebView source in the viewer and keep capture connected. Stay on
   **Logs** while you prepare the example; flow analysis also runs while Logs is open.
3. Open the WebView source's **>_** JavaScript console button and select the app's
   execution context. Paste a chapter's emitter into the console and click **Run**.
   It emits records with `console.log(JSON.stringify(record))` inside that WebView.
4. Close the console and open **Flows** to see the resulting cards. The source-row
   console button is on Logs, so return there when you want to emit another example.

Alternatively, emit from an external debugger attached to the **test app's inspected
WebView context**. Do not use the browser console of the viewer page: its own
messages are not the selected app's logs.

Each chapter has a ready-to-paste emitter. JSONL blocks show **one original message
per line**, not transport envelopes. Selecting a project, opening a README or
saving a Blueprint does not replay these files. You need captured matching logs.
For a repeatable check without a device, run the engine tests from the repository root:

```sh
node --import tsx --test server/flow-tutorials.test.ts
```

Those tests replay the same records and check the documented outcomes; they do not
open the viewer or simulate a connected phone.

## Create a Blueprint in your own project

1. Create `.udl/config.yaml` in your app repository with `blueprints: .udl/flows`.
2. Create `.udl/flows` and copy one tutorial YAML file into it. Use a unique top-level
   `id` across all enabled Blueprints; the filename and `id` are separate names.
3. From the viewer checkout, run `npm run dev -- --project=/absolute/path/to/your/app`.
4. In **Flows → Blueprints**, adapt `match` to real log messages, validate and save.
   Emit a new operation from the app, then inspect its **Timeline** to check the evidence.

Global Blueprints can also be active alongside the project. **Flows → Blueprint
sources** shows what is enabled. These examples use distinct `tutorial-` IDs and
fictional event names; they are not automatically enabled for other projects.
Blueprint names and original log values are author data and stay unchanged when
you switch the viewer's interface language.

## Understand the result

- **Blueprint:** the reusable definition. **Flow instance:** one observed occurrence.
- **Match:** selects a log message. **Extract:** reads values from that message.
- **Next:** lists allowed following steps. **Outcome:** explicitly ends a route.
- **Correlation ID:** connects messages from the same attempt. Use a different ID
  for each new attempt, including retries; a user or product ID is usually not enough.
- **Timeout:** the deadline measured from the first observed step. Missing completion
  is missing evidence, not proof that the app failed. Capture gaps and missing starts
  can also leave the evidence incomplete, even if a terminal message is observed.

For all supported fields, plain-text matchers, optional/repeated steps and error
codes, continue with the [format reference](../../docs/flow-format.md). For richer
working examples, visit the [test project](../../test_flow_project/README.md).
