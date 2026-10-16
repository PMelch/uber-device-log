# HTTP, streaming and export contracts

These interfaces describe the current local app, not a separately versioned public
service. The source of truth is `server/index.ts`, `server/stream.ts`,
`shared/types.ts`, `shared/notifications.ts`, and `shared/log-export.ts`.

## Local access

The server listens on `127.0.0.1`, port `4310` by default. Every request must have a
Host matching `localhost:<port>` or `127.0.0.1:<port>`. If Origin is present, it must
be `http://localhost:<port>` or `http://127.0.0.1:<port>`. Rejected requests receive
HTTP 403. There is no remote-access mode or authentication token.

Examples below use a source checkout already running with `npm run dev`:

```sh
curl http://127.0.0.1:4310/api/devices
curl -N --get http://127.0.0.1:4310/api/logs \
  --data-urlencode platform=android --data-urlencode id=DEVICE_ID
```

## Device discovery

`GET /api/devices` returns HTTP 200 with `Cache-Control: no-store`:

```json
{
  "devices": [{
    "id": "device-id",
    "platform": "android",
    "name": "Example phone",
    "state": "connected",
    "webviews": [{
      "id": "page-id",
      "socket": "webview_devtools_remote_42",
      "title": "Example page",
      "url": "https://example.test/",
      "pid": 42
    }]
  }],
  "warnings": []
}
```

`platform` is `android` or `ios`. Android states come from ADB, with `device` and
`emulator` mapped to `connected`; unavailable devices can still appear. iOS discovery
marks enumerated devices connected, but opening a service can still fail on trust
or pairing. `webviews` and a page's `pid` are optional. On iOS, `socket` identifies
the WebInspector application (for example `PID:42`) and `id` is the numeric page
identifier represented as a string. Treat both as opaque discovery values.

Warnings are notification descriptors (or legacy strings). Partial platform or
WebView discovery failure is reported here; an empty device list alone does not
explain the cause. Concurrent discovery requests share one in-flight operation.

## Capture stream

`GET /api/logs` requires `platform=android|ios` and a nonempty `id`. For a WebView,
add **both** `webviewSocket` and `webviewId` from discovery. Omit both for native
logs. Values must be URL encoded. Each request opens one source; combined capture
uses several requests from the browser.

Before opening SSE, the server performs discovery and validates the connected device
and selected page. HTTP 400 returns `{ "error": "..." }` for invalid parameters;
HTTP 409 returns that shape for an unavailable device or target. Unknown `/api`
paths return 404. These pre-stream errors are English diagnostics; the browser's
EventSource error handler displays a localized connection-loss message.

A successful response has `Content-Type: text/event-stream`,
`Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, and
`X-Accel-Buffering: no`. Named events contain JSON:

| Event | Payload | Meaning |
| --- | --- | --- |
| `logs` | Array of `LogMessage` | Up to 100 queued records per flush |
| `status` | Notification descriptor | Collector ready or overload warning; the connection remains open |
| `stopped` | Notification descriptor or `{ message }` | Terminal error/end; the server closes the stream |

```text
event: logs
data: [{"timestamp":"2026-10-15T10:00:00.000Z","message":"Hello","level":"I","tag":"App","pid":42}]

```

A wire log has required string `timestamp` and `message`, with optional `level`,
`tag`, and numeric `pid`. Native iOS leaves structured severity/tag/PID absent.
WebView adapters map console levels and tags; Android timestamps use CDP
milliseconds, iOS WebViews use WebKit seconds. Invalid or missing console timestamps
fall back to host receipt time. Native Android uses logcat time; native iOS always
uses host receipt time. These clocks are not normalized.

The current adapters do not attach `source` on the wire. The browser adds
`LogSourceMetadata` from the selected source and its private numeric selection key.
A `: heartbeat` SSE comment is sent every 15 seconds when output is not blocked.
There are no event IDs, replay cursor or resume guarantees. The browser closes
failed EventSources and requires an explicit retry.

Notifications have `{ code, params, message }`: `code` is stable, `params` maps
placeholder names to strings/numbers, and `message` is the interpolated English
fallback. `shared/notifications.ts` defines the supported server codes. Keep the
descriptor in UI state and translate when rendering so existing statuses follow
language changes; unknown codes and legacy strings retain their fallback verbatim.

## Limits and timeouts

| Boundary | Current value and behavior |
| --- | --- |
| SSE connection initialization | 15 seconds; sends terminal timeout and closes; late collector results are stopped |
| SSE flush | Every 100 ms, at most 100 records per flush |
| Queue per stream | 1,000 records; oldest queued records drop on overflow; `streamSkipped` reports the count |
| Message text | Truncated to 16,384 JavaScript string code units before queuing |
| Slow HTTP client | Pause flushes/heartbeats after `write()` returns false; resume on `drain`; bounded queue still applies |
| Browser delivery batching | 50 ms; pending queue compacted to capacity after exceeding twice capacity |
| Browser retention | Shared across sources: 1,000 / 2,000 default / 10,000 / 50,000 / 100,000 records |
| Android WebView discovery | 2.5-second acquisition/read/request deadlines; response capped at 1 MiB (stream text guard uses string length) |
| Android WebView sockets | At most 32 sockets, probed four at a time |
| Android console initialization | 5 seconds for WebSocket/`Runtime.enable` readiness |
| iOS WebInspector | 5-second acquisition, 2.5-second discovery deadline after acquisition, 5-second console initialization |
| Unused healthy iOS inspector | Retained for 10 seconds, then destroyed; invalidated sessions close when unused |

The iOS syslog dependency also has its own fixed line buffer; this app cannot
promise intact long lines. Timeout stages are not a single global discovery deadline.
Capture is bounded and lossy under load; a final queued batch is not guaranteed to
be delivered when a stream stops. Retention and timestamp merging are described
in [architecture.md](architecture.md#browser-state-and-invariants).

## Copy/Save formats

`serializeLogExport(messages, device, format)` returns text plus its MIME type and
extension. The caller supplies entries in display order. Copy requires whole-entry
selection; Save uses that selection or the entire filtered view, including a frozen
snapshot. Neither is limited to mounted virtual rows. Optional fields are omitted
by JSON serialization; UI selection keys are excluded. Message strings are retained
as captured, subject to the capture limits above.

Plain text (`.log`, `text/plain;charset=utf-8`) writes one entry as:

```text
[Example phone] 2026-10-15T10:00:00.000Z I App[42]: Hello
```

The source-name prefix is present only when the entry has source metadata.
Multiline messages remain multiline. Native browser text selection uses the browser's
normal copy behavior; the app's Copy button exports whole selected entries.

### Current source-aware JSON (version 2)

The UI attaches source metadata to every incoming entry, so its nonempty JSON
exports use schema version 2, even with only one enabled source:

```json
{
  "schemaVersion": 2,
  "device": { "id": "device-id", "name": "Example phone", "platform": "android" },
  "sources": [{
    "key": "android:device-id",
    "name": "Example phone",
    "platform": "android",
    "deviceId": "device-id"
  }],
  "entries": [{
    "timestamp": "2026-10-15T10:00:00.000Z",
    "message": "Hello",
    "level": "I",
    "tag": "App",
    "pid": 42,
    "source": {
      "key": "android:device-id",
      "name": "Example phone",
      "platform": "android",
      "deviceId": "device-id"
    }
  }]
}
```

`sources` contains unique sources represented in the exported entries, in first
occurrence order, rather than every configured source. WebView source metadata adds
`webview: { id, socket, title, url, pid? }`. Version 2 has no top-level
`timestampSource`; consumers must account for source-specific clocks and console
fallbacks. Each UI export belongs to one parent device.

### Compatibility JSON (version 1)

The serializer retains version 1 when **none** of the supplied entries has source
metadata. This includes older callers and an empty array:

```json
{
  "schemaVersion": 1,
  "device": { "id": "device-id", "name": "Example phone", "platform": "android" },
  "source": "android-logcat",
  "timestampSource": "device",
  "entries": [{ "timestamp": "2026-10-15T10:00:00.000Z", "message": "Hello" }]
}
```

`source` can be `android-logcat`, `ios-syslog`, `android-webview`, or `ios-webview`.
WebView exports also include top-level `webview`. `timestampSource` is `host-receipt`
for native iOS and `device` otherwise; console receipt-time fallbacks are not
individually flagged. The message-details JSON (`original` plus `parsed`) is a
separate single-record diagnostic representation, not either versioned export.
