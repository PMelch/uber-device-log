# 1. Recognize a single event

[All tutorials](../README.md) · [Set up capture first](../README.md#set-up-once)

**Goal:** turn each `app.ready` message into its own completed “App ready” card.
There is no request, transaction or correlation ID in this log.

```text
app.ready → completed
```

## 1. Create the Blueprint

Save this as `.udl/flows/single-event.yaml` in your project. The tutorial project
already includes [this file](../.udl/flows/single-event.yaml); do not add a second copy
with the same Blueprint ID. Open **Flows → Blueprints**, validate and save changes.

```yaml
version: 1
id: tutorial-single-event
name: App ready
start: ready
timeout: 30s
correlation: { scope: device-session, primary: event }
steps:
  - id: ready
    name: App is ready
    match: { json: { path: event, equals: app.ready } }
    extract:
      event: { json: event, required: true }
    outcome: completed
```

## 2. Understand the rules

- `match` selects a JSON message whose `event` is exactly `app.ready`.
- `start: ready` points to the only step. That same step declares
  `outcome: completed`, so the card completes immediately.
- Version 1 still requires a `correlation` block and a primary extraction.
  Here we extract the existing `event` value. This is a format requirement,
  **not an operation ID added to your logs**. Each matching message creates a
  separate instance because the start is already terminal.
- `timeout` is also required by the format. It does not delay completion;
  this Blueprint never waits for another step.

Use this pattern for standalone observations. **Do not extend it into a waiting
multipart flow using `event` as identity.** Concurrent operations need distinct
attempt IDs, as the next tutorial explains.

## 3. Emit logs and inspect the result

These are the original messages in [events.jsonl](events.jsonl):

```jsonl
{"event":"app.ready"}
{"event":"app.ready"}
```

Run this in the captured app's WebView context:

```js
console.log(JSON.stringify({ event: 'app.ready' }));
console.log(JSON.stringify({ event: 'app.ready' }));
```

**Expected:** two separate “App ready” cards, both completed with complete evidence
and one observed step. The identical messages do not get merged. In **Timeline**,
each card contains its own original message. Emit it again to get another card.

## If no card appears

Check that the Blueprint is active without validation errors, the intended
WebView source is selected and the original message appears in **Logs**. The
message must contain the JSON keys and values shown above. Emit after loading
the Blueprint; selecting the project does not inject the sample records.

[Next: a multipart operation →](../multipart/README.md)
