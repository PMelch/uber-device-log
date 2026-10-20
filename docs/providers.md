# Provider interface — internal milestone 1

The internal API version is **1**, defined in shared/providers.ts. This is not a
published plugin SDK or an external module loader. No npm plugin discovery,
sandbox or remote browser adapter is implemented. A separate bundled [Unity Editor
connector](unity.md) now integrates through the existing bounded SSE/viewer boundary;
it does not migrate or change these four built-in providers.

## Production integration

/api/logs still validates the connected device/page using listDevices, then uses
streamLogs → openLogs → openProviderLogs → a built-in LogProvider session → the
existing transport. All four sources implement the same discovery/open contract:

- builtin.android.logcat: existing binary ADB logcat reader.
- builtin.ios.syslog: existing Appium syslog relay.
- builtin.android.webview: existing CDP transport via the shared WebView hub.
- builtin.ios.webview: existing WebInspector transport via the same hub.

There are no parallel connections introduced for capture. Console consumers
continue to share hub leases. Discovery adapters use the existing coalesced device
discovery; the HTTP device list itself is still the legacy DeviceList, including
localized warnings. Provider discover currently returns targets only, not warnings.

## Target identity and capabilities

IDs are JSON-encoded tuples of provider ID, device ID, and (for pages) socket/app
identifier and page ID. Delimiters cannot collide. Names, titles and URLs are not
identity. WebViews point to their native log target as parentId. IDs remain stable
while the underlying transport IDs remain stable; page recreation/device reset
can change them. This does not promise identity across app reinstalls or page
recreation. BuiltinTarget carries a private Device locator; generic targets do not.
A provider rejects foreign or inconsistent target identities. This is not an
authorization boundary: callers must revalidate availability, as /api/logs does.

Every target advertises logs. Only WebViews advertise javascript with
sideEffects=true and requiresExplicitRequest=true. This is an advertisement,
**not an execution method or permission grant**. Native targets do not acquire a
console. The existing explicit console action, request validation, loopback/origin
restrictions, session limits, stale-context rejection and bounded previews remain
unchanged. Console and inspector routes have not migrated to generic capabilities.

## Session lifecycle and failures

open returns a session immediately. ready resolves after transport initialization;
a startup exception rejects it and does not also call end. Invalid target identity
throws synchronously. The owner must observe ready. Transport termination calls
end at most once, with code transport-ended and the original localized notification
or diagnostic string. The underlying collectors currently do not distinguish clean
EOF from transport errors structurally; the original reason is retained.

Messages may arrive during initialization. End may also precede ready. dispose
and AbortSignal cancellation suppress future callbacks immediately, remove the
abort listener and release an initialized transport once. If initialization finishes
late, its resource is released then. Abort before opening avoids transport creation.
Cancellation does not emit end. ready still waits for the underlying open operation
and can reject if that operation fails after cancellation: cancellation is not a
promise that the underlying non-cancellable ADB/usbmux API has stopped. There is
no automatic retry. Consumer callbacks and transport cleanup must not throw.

## Records, raw data and bounded delivery

CaptureRecord has schemaVersion=1, targetId/providerId and the existing normalized
message fields. raw retains the original normalized transport LogMessage before
viewer truncation, without rewriting the text, timestamp, severity, tag or PID.
This is **not binary logcat or full CDP/WebInspector wire data**; existing decoders
already normalize protocol records. Consumers treat records/raw as immutable.

Delivery is synchronous callback-based, with no provider-side accumulation. A
consumer that retains records must bound its storage. The current compatibility
bridge passes only raw to the existing HTTP stream, avoiding duplicate payloads
and preserving current export/UI behavior. SSE still holds at most 1,000 records,
truncates message text to 16,384 characters, sends batches of at most 100 every
100 ms, drops oldest on overflow and reports skipped counts. Slow responses wait
for drain. Terminal events close immediately without a guaranteed final flush.
This is bounded, lossy viewing, not a lossless recorder or a general byte-budget
framework for arbitrary third-party payloads. Unified metadata is internal for now.

## Next bounded milestones

1. Migrate discovery results (including warnings), selection and the HTTP boundary
   to provider target IDs while keeping a compatibility mapping for saved devices.
   Remove hard-coded platform dispatch from that boundary; test stale targets.
2. Add an explicit optional console-session interface backed by the current hub and
   RuntimeConsole, then migrate console routes without weakening consent, context
   revision checks, limits or origin validation. Keep capture independently usable.
3. Decide protocol-raw retention, byte budgets/redaction and versioned export schema
   before exposing richer records to the browser; do not silently enlarge SSE.
4. Only then consider external loading and Unity/Unreal/Godot/browser adapters,
   with separate trust, installation, compatibility and failure-isolation decisions.

Tests use injected transports for all four adapters and exercise the actual
provider-to-SSE bridge under backpressure. Existing console/inspector/transport
regressions remain required. Physical-device smoke validation is still required;
unit tests do not establish hardware compatibility.
