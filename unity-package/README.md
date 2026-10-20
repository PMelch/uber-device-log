# Über Device Log — Unity Editor package (preview)

Targets Unity 2021.3+; Editor only, never included in player builds. No remote control, player logging, console commands or remote hosts.

## Install from this checkout

In Unity, open **Window → Package Manager → + → Add package from disk…**, then select this directory's **package.json**. Keep the local package directory available. This is a local package, not a published registry/Git installation URL.

Open **Tools → Über Device Log**. Start the local viewer with its project selected, enable `unity.enabled: true` in `.udl/config.yaml` and restart UDL, request a Unity pairing code, and enter the viewer URL (exactly http://127.0.0.1:PORT, no trailing slash), its separate project ID, the code and a descriptive Editor name. Codes are single-use and expire after 120 seconds. Select **Pair**, then **Connect**. The sample port is only a default: use the actual viewer port.

- **Connect** forwards new Editor logs using the last paired settings, including Editor play mode logs. Existing console history is not replayed.
- **Disconnect** stops capture, aborts a request and discards buffered logs; pairing remains available across Editor and server restarts.
- **Forget pairing** also deletes the local token. It does not revoke the server credential; revoke it in the viewer if needed.
- Closing the window does not stop capture. Change settings by disconnecting and pairing again.
- Tokens, identity and the explicit connection choice persist in the OS user LocalApplicationData/UberDeviceLog directory, keyed by absolute project path. Unix storage is 0700/0600; Windows relies on user-profile ACLs. No secrets are stored in Assets, EditorPrefs or shareable YAML. Domain reload also uses SessionState. Neither store protects against code running as your account. Moving the project requires fresh pairing.

## Transport and limitations

The connector only accepts numeric IPv4 loopback HTTP with an explicit port. localhost is deliberately rejected to avoid DNS ambiguity; redirects are disabled. HTTP is unencrypted on the local machine. Logs can contain sensitive application data: connect only to your trusted local viewer.

POST /api/unity/pair sends code, projectId, instanceId and name. Its token/projectId reply is validated before storing the token. POST /api/unity/batch uses Bearer authorization and version 1, projectId, instanceId, name, dropped and logs. Each record has UTC ISO-8601 timestamp, message, stackTrace and Unity LogType name (Log, Warning, Error, Assert, Exception).

Capture uses a locked 1000-record queue. Messages are capped at 8192 UTF-16 units and stacks at 16384. Batches contain at most 50 records and remain below 255 KiB UTF-8 JSON (including escaping). Overflow, discarded queued records and failed in-flight batches contribute to the next reported dropped count. Truncation is not a dropped record. Failed batches are not replayed: delivery is best-effort, not exactly-once; a lost response may count a delivered batch as dropped and repeat a drop report.

An asynchronous main-thread UnityWebRequest pump sends an empty heartbeat when idle on a two-second schedule. Requests time out after two seconds (with a 2.5-second editor-pump fallback), and failures retry with 1/2/4/8-second backoff. A healthy responsive Editor meets the three-second heartbeat target; blocked Editor updates, modal dialogs, compilation/reloads and network failures cannot guarantee that interval. The backend expires silent sessions after 15 seconds. Authentication rejection requires pairing again. A reload discards queued logs with accounting, aborts requests and restores opt-in capture once.

No connector diagnostics are written to the Unity console (avoids feedback loops). Status appears in the window only.

## Verification status

Source-contract tests: node --import tsx --test server/unity-package.test.ts from the repository root. These check packaging and safety/lifecycle contracts, not C# execution. Unity was not available on the implementation host; this package has **not been compiled or exercised in Unity**. Unity 2021.3+ API compatibility is an assumption pending Editor verification.

Before release, install in Unity 2021.3 and a current LTS, pair against the real backend, test all five severities and threaded bursts, Unicode/control-character size limits, disconnect/reconnect, backend restart/revocation, compilation/domain reload (including disabled play-mode domain reload), multiple Editor processes and offline expiry. Verify no runtime assembly in a player build and inspect heartbeat timing.

## Implementation discovery (L2)

Reviewed repository AGENTS.md, /tmp/udl-unity-L2-brief.md, package.json, server/device-picker.test.ts and server/dependency-security.test.ts. Existing node:test/read-file source contracts support package checks without a Unity toolchain. No existing C# connector or reusable Unity transport exists: UnityLogTransport/UnityLogWindow and the Editor assembly are intentional new-domain names. Main risks are callback concurrency, bounded JSON size, reload cleanup, credential handling and unavailable Editor integration tests. No changes outside this package and server/unity-package.test.ts belong to this lane; release notes are owned by the integrating parent.
