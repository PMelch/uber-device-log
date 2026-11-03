# 3. Describe alternative routes

[All tutorials](../README.md) · [Set up capture first](../README.md#set-up-once)

**Goal:** show whether a checkout was accepted or rejected, using the actual
result message. Each checkout takes one of two routes.

```text
                   ┌→ checkout.accepted → completed
checkout.started ──┤
                   └→ checkout.rejected → failed
```

## 1. Create the Blueprint

Save this as `.udl/flows/branching.yaml` in your project. The tutorial project
already includes [this file](../.udl/flows/branching.yaml); do not add a second copy
with the same Blueprint ID. Open **Flows → Blueprints**, validate and save changes.

```yaml
version: 1
id: tutorial-branching
name: Checkout
start: start
timeout: 30s
correlation: { scope: device-session, primary: requestId }
steps:
  - id: start
    name: Start checkout
    match: { json: { path: event, equals: checkout.started } }
    extract:
      requestId: { json: requestId, required: true }
    next: [accepted, rejected]
  - id: accepted
    name: Checkout accepted
    match: { json: { path: event, equals: checkout.accepted } }
    extract:
      requestId: { json: requestId, required: true }
    outcome: completed
  - id: rejected
    name: Checkout rejected
    match: { json: { path: event, equals: checkout.rejected } }
    extract:
      requestId: { json: requestId, required: true }
    outcome: failed
```

## 2. Understand the rules

- `next: [accepted, rejected]` offers alternatives. It does **not** require both
  steps or mean parallel execution. The next matching, correlated message
  determines the route.
- Both alternatives extract the same `requestId`, so overlapping checkouts
  remain separate. Use a unique ID for every new checkout attempt.
- Each branch ends explicitly: `completed` for acceptance, `failed` for rejection.
  Here failure is grounded in a captured rejection message, unlike a timeout.
- There is no missing-step penalty for the unchosen branch. A route can be
  complete even though its outcome is failed: completeness describes evidence,
  not whether the operation succeeded.

If routes later rejoin, point them at a shared step with `next`. For this first
example, separate terminal steps make both outcomes easy to see. Keep sibling
matchers distinct; overlapping matchers make the route ambiguous.

## 3. Emit logs and inspect the result

These are the original messages in [events.jsonl](events.jsonl):

```jsonl
{"event":"checkout.started","requestId":"order-1"}
{"event":"checkout.started","requestId":"order-2"}
{"event":"checkout.rejected","requestId":"order-2"}
{"event":"checkout.accepted","requestId":"order-1"}
```

The fixture starts two checkouts, rejects the second and accepts the first.
Paste this into the captured WebView context to try both routes with fresh IDs:

```js
{
  const run = crypto.randomUUID();
  const emit = (event, id) => console.log(JSON.stringify({
    event, requestId: `${run}-${id}`
  }));
  emit('checkout.started', 1);
  emit('checkout.started', 2);
  emit('checkout.rejected', 2);
  emit('checkout.accepted', 1);
}
```

If `crypto.randomUUID()` is unavailable in your WebView, replace it with a new
unique string each time.

**Expected:** two “Checkout” cards: one completed with `start → accepted`, one
failed with `start → rejected`. Both have complete evidence. In **Timeline**,
only the chosen route has observations; the other route is an alternative.
If neither decision arrives within 30 seconds, the instance times out instead
of inventing an acceptance or rejection.

## If no card appears

Check that the Blueprint is active without validation errors, the intended
WebView source is selected and the original message appears in **Logs**. The
message must contain the JSON keys and values shown above. Emit after loading
the Blueprint; selecting the project does not inject the sample records.

[← Multipart operation](../multipart/README.md) · [All Blueprint fields →](../../../docs/flow-format.md)
