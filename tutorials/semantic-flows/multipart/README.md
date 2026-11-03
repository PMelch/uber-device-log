# 2. Connect a multipart operation

[All tutorials](../README.md) · [Set up capture first](../README.md#set-up-once)

**Goal:** recognize a sync that starts, receives data and finishes, even while
another sync is running. Every message carries the same `requestId` for its attempt.

```text
sync.started → sync.received → sync.completed
       requestId stays the same throughout
```

## 1. Create the Blueprint

Save this as `.udl/flows/multipart.yaml` in your project. The tutorial project
already includes [this file](../.udl/flows/multipart.yaml); do not add a second copy
with the same Blueprint ID. Open **Flows → Blueprints**, validate and save changes.

```yaml
version: 1
id: tutorial-multipart
name: Sync data
start: start
timeout: 30s
correlation: { scope: device-session, primary: requestId }
steps:
  - id: start
    name: Start sync
    match: { json: { path: event, equals: sync.started } }
    extract:
      requestId: { json: requestId, required: true }
    next: [received]
  - id: received
    name: Receive data
    match: { json: { path: event, equals: sync.received } }
    extract:
      requestId: { json: requestId, required: true }
    next: [done]
  - id: done
    name: Finish sync
    match: { json: { path: event, equals: sync.completed } }
    extract:
      requestId: { json: requestId, required: true }
    outcome: completed
```

## 2. Understand the rules

- `start` opens an instance when `sync.started` is captured.
- Each `next` names the permitted following step. Only `done` declares completion.
- `correlation.primary: requestId` links messages with the same ID within the
  selected device's analysis session. Each step extracts that field with
  `required: true`; a missing ID cannot silently match an arbitrary instance.
- The 30-second timeout starts with the first observed step; receiving data
  does not reset it. Increase it to match your real operation's expected duration.

Use a fresh ID per attempt, including retries. Two simultaneously active syncs
with the same ID cannot be reliably distinguished; the viewer does not guess
which one is newest. Longer flows are safe to overlap when their IDs distinguish
them and their events are captured within the configured deadline.

## 3. Emit logs and inspect the result

These are the original messages in [events.jsonl](events.jsonl):

```jsonl
{"event":"sync.started","requestId":"sync-1"}
{"event":"sync.started","requestId":"sync-2"}
{"event":"sync.received","requestId":"sync-2"}
{"event":"sync.received","requestId":"sync-1"}
{"event":"sync.completed","requestId":"sync-2"}
{"event":"sync.completed","requestId":"sync-1"}
{"event":"sync.started","requestId":"sync-3"}
```

This fixture deliberately interleaves two syncs and starts a third without finishing it.
To try it repeatedly without reusing IDs, paste this into the captured WebView context:

```js
{
  const run = crypto.randomUUID();
  const emit = (event, id) => console.log(JSON.stringify({
    event, requestId: `${run}-${id}`
  }));
  emit('sync.started', 1);
  emit('sync.started', 2);
  emit('sync.received', 2);
  emit('sync.received', 1);
  emit('sync.completed', 2);
  emit('sync.completed', 1);
  emit('sync.started', 3);
}
```

The random prefix just makes IDs fresh on each run. If `crypto.randomUUID()` is
unavailable in your WebView, replace it with a new unique string each time.

**Expected:** two completed “Sync data” cards, each with `start → received → done`
and only its own request ID in **Timeline**. A third card remains in progress,
then times out after 30 seconds if capture continues. This indicates that completion
was not observed; it does not establish an application failure.

## If no card appears

Check that the Blueprint is active without validation errors, the intended
WebView source is selected and the original message appears in **Logs**. The
message must contain the JSON keys and values shown above. Emit after loading
the Blueprint; selecting the project does not inject the sample records.

[← Single event](../single-event/README.md) · [Next: branching →](../branching/README.md)
