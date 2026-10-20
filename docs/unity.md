# Unity Editor logs (bundled preview)

UDL includes an opt-in local Unity Editor connector. It does not load arbitrary npm plugins, control the Editor, run JavaScript, capture remote machines or attach to players. Existing Android/iOS/WebView providers are unchanged.

## Install and pair

1. Run `npm run dev -- --project /absolute/path/to/UnityProject` from this checkout, or `udl --project /absolute/path/to/UnityProject` with an installed UDL build. Open the loopback URL printed by UDL. Without `--project`, Unity setup is disabled and no project files are created.
   Enable Unity explicitly in `.udl/config.yaml` and restart UDL (merge into existing YAML; keep other keys):

   ```yaml
   unity:
     enabled: true
   ```

2. In Unity Package Manager choose **Add package from disk** and select `unity-package/package.json` inside your UDL checkout/installation. The project setup panel reports the bundled package path. Copy the entire package to a stable local folder if your launcher cache may be removed. There is no separately published UPM registry package or fabricated Git/package URL.
3. Open **Tools → Über Device Log** in Unity. In the UDL project setup panel create a pairing code; enter the displayed local server URL, project ID and short-lived code into the Editor window. Keep the code private.
4. Pair, then select the connected Unity Editor source in UDL. Each Unity project path has its own durable Editor identity; separate project copies pair separately. Simultaneously opening the same Unity project is not supported by Unity or this credential store. Existing search, severity, selection, pause, copy and text/JSON export apply, including multiline exception text.

The package targets Unity **2021.3 LTS or newer** using Editor-only assemblies, `Application.logMessageReceivedThreaded` and `UnityWebRequest`. This is an API compatibility assumption, not a verified version matrix. No Unity Editor was available on the implementation host: the C# has not been compiled or physically exercised in Unity. Automated protocol simulators and package source-contract checks are not a substitute for that validation.

## Lifecycle and loss

The Editor callback only queues bounded records under a lock. Main-thread updates send authenticated JSON batches and empty heartbeat batches over loopback HTTP. Failed delivery retries connection with bounded backoff; this viewer is intentionally lossy, not a recorder. Queue overflow, failed batches and oversized log text may lose data. Counters make loss visible; no historical Editor.log import is provided. Domain reload releases callbacks and requests and restores session credentials; Editor and UDL restarts retain pairing. The Editor restores the last explicit Connect/Disconnect choice and retries the same loopback URL; a changed server port requires pairing again. Revocation invalidates durable grants, including after restart.

Viewer **Disconnect** closes this browser capture, not the Editor sender. Stop/disconnect in the Editor to stop forwarding. **Revoke** in project setup invalidates all paired Editor credentials for this project and closes their streams. A heartbeat timeout makes sources unavailable; select/reconnect again after a sender returns. Logs already in the browser remain until cleared. No history is retained on the server when no viewer subscribes.

## Project configuration and secrets

`.udl/config.yaml` is the shareable project configuration anchor. Existing bytes, comments and unknown settings are preserved; only the boolean `unity.enabled: true` opts in; absent, false or string values disable Unity. YAML is read at server startup and never rewritten; malformed YAML fails startup. Server authorization digests and identity are kept separately in owner-only `.udl/local/` files, ignored through `.udl/.gitignore`. Do not commit local state or copy it between projects. Symlink/non-regular-file checks and exclusive creation protect accidental redirection; permissions are enforced where supported. The Editor stores its bearer credential under the OS user LocalApplicationData/UberDeviceLog directory, keyed by the absolute Unity project path, never in Assets or EditorPrefs. Unix directories/files are restricted to 0700/0600; Windows uses the user-profile ACL (host-specific validation required). Moving the Unity project requires pairing again. Do not copy these credentials between accounts or machines. Run one UDL server per project: authorization mutations are atomic files but are not a multi-process transaction protocol. Active servers reload grants on authenticated batches, so a completed revocation invalidates their stale cached grants.

## Threat model and limits

The server binds to loopback. Host and Origin checks protect against normal cross-site/DNS-rebinding browser requests; browser pairing/revocation additionally requires a custom header and matching Origin. Native Editor requests use a bearer credential and no browser Origin. Pair codes are random, short-lived, single-use and rate-limited. Body size, log length, batch length, Editor identities, subscriber count and request rate are bounded. Authentication comparisons are timing-safe. Secrets are never put in shareable YAML or browser persistent storage.

This trusts your local OS account, Unity packages and UDL frontend. It does **not** defend against another process running as you, an administrator, local malware, hostile filesystem races by the same user, or an untrusted package inside Unity. Loopback HTTP is not TLS. Other local users may reach the port, so bearer secrets and pairing codes must remain private. Logs can contain sensitive data and are not automatically redacted. Review before export. No promise of lossless delivery, ordering across processes, exactly-once delivery or physical engine compatibility is made.

## Protocol bounds

Protocol version 1 uses `POST /api/unity/pair` and bearer-authenticated `POST /api/unity/batch`; empty batches are heartbeats. Pairing lasts 120 seconds with at most 10 guesses. A server allows 8 paired Editors, 8 viewers per source, 100 Unity requests/second, 256 KiB JSON bodies and 200 records/batch. Sources expire after 15 seconds without a valid batch. The bundled sender queues at most 1,000 records, sends up to 50 per batch every two seconds and uses a two-second request timeout with capped backoff.

Messages are clipped in the sender (8,192 message / 16,384 stack characters) and again at the 16,384-character viewer boundary. The displayed dropped total accumulates sender-reported loss deltas and server-truncated records; it is not an exact count of missing original events (sender clipping and ambiguous failed HTTP acknowledgements can distort it). SSE additionally reports its own skipped records. Counters reset when a source expires or is re-paired.

## Verification checklist on a Unity host

Compile the package in supported LTS versions; pair two instances; emit Log/Warning/Error/Assert/Exception with multiline stacks from worker threads; overload the queue; pause/play and reload scripts; restart UDL and reconnect; revoke credentials; close/reopen the Editor; confirm no player assembly dependency. Check filters/export and that Unity has no JavaScript or inspection actions.
