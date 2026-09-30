# Über Device Log

The approved **Über Device Log** visual direction is [Precision](docs/design/README.md). The interactive design reference is stored there separately from the current prototype UI.

The Vue interface implements **Precision**, including responsive light/dark styling, keyboard-accessible custom selectors, locally bundled platform icons, Android severity filters and Copy/Save actions.

Minimal Vue 3 + TypeScript frontend with a Node.js/TypeScript backend. One selector lists Android and iOS devices; selecting a device opens a scrollable live message list. No Appium server, Python runtime, or `idevicesyslog` installation is needed for this implementation.

## Run the npm package

After publication to npm:

```sh
npx uber-device-log
# or
bunx uber-device-log
```

Open the printed URL (default: http://127.0.0.1:4310). Stop with Ctrl+C.
Node.js 22.12+ is required for both launchers; `bunx` respects the Node shebang.
Do not use `bunx --bun`: direct Bun execution of the device adapters is not validated.

```sh
npx uber-device-log --port 4311
bunx uber-device-log --help
npx uber-device-log --version
```

`PORT` sets the default port; `--port` overrides it. The CLI only binds to
127.0.0.1. Android still needs `adb` and USB debugging; iOS needs host pairing
and the platform services described below. The npm package includes the compiled
server and frontend; no TypeScript compiler, Vite, repository checkout, account,
or application credentials are needed to run it.

See [Publishing](docs/publishing.md) for package verification and release steps.

## Run

Use Node.js 22.12+ (prefer an active LTS release) and npm 10+:

```sh
cd uber-device-log
npm ci
npm run dev
```

Open <http://127.0.0.1:4310>. Both frontend and API use this port. Set `PORT` to change it.

You can also install and run with Bun: `bun install --frozen-lockfile` and `bun run dev`. The scripts still use Node.js through `tsx`, so Node.js 22.12+ must be available on `PATH`.

If startup reports that port 4310 is already in use, stop the existing server with Ctrl+C in its terminal, or use `PORT=4311 bun run dev`. On macOS, `lsof -nP -iTCP:4310 -sTCP:LISTEN` identifies the process using the port; after moving the project, check for a server still running from the old folder.

```sh
npm run build
npm start
npm test
```

`build` checks frontend/backend types, builds the frontend and compiles the server to JavaScript. `start` runs the production CLI and serves the built frontend. Only development uses `tsx`; published installations need runtime dependencies only. TypeScript is pinned to 5.9 because the currently resolved Vue type checker does not support TypeScript 7.

Both `package-lock.json` and `bun.lock` are maintained. Keep them consistent when changing dependencies. Running scripts through Bun has been verified; running the backend directly on the Bun runtime has not.

## Device setup

- **Android:** install Android SDK Platform Tools and put `adb` on `PATH` (or set `ADB_PATH` to its executable). Enable USB debugging and accept the authorization prompt. The npm library talks to the local ADB server and can start it if necessary. Unauthorized/offline devices remain visible but cannot be selected.
- **iOS:** connect and unlock the device, establish host pairing, and accept “Trust This Computer.” On macOS, the existing Apple usbmuxd service is used. Linux needs usbmuxd; Windows needs compatible Apple mobile-device support. The npm package is primarily tested on macOS; other hosts need separate validation. A device may be discoverable before it is trusted; opening logs will then show an error.

Discovery refreshes every three seconds and has a manual refresh button. A failure on one platform does not hide devices from the other. Existing Android emulators and network devices visible to the host services may also appear. This prototype does not establish wireless pairing or list iOS simulators.

## Behavior and limits

- The selector contains both platforms and includes IDs to distinguish similarly named phones.
- One stream is opened per browser selection. Changing selection or closing the page disposes it, including connections that finish opening late.
- Newest messages appear on top by default; choose **On bottom** in the **Newest messages** selector to reverse the display. Changing order resumes following at the newest end.
- Scroll away from the newest end to stop following new messages; use **Follow latest** to resume. Incoming messages preserve your reading position while following is paused, as long as those messages remain in the configured buffer.
- **Clear view** clears browser messages only; it never clears device logs.
- **Filter logs** searches message text, timestamps, tags, levels and PIDs with case-insensitive fuzzy matching (Fuse.js). All whitespace-separated terms must match; results retain the selected chronological order. Filtering only affects the view, including while paused. **Clear filter** or Escape restores all retained messages.
- **Android levels** toggle Verbose, Debug, Info, Warn, Error and Fatal independently and combine with fuzzy search. All restores all levels. Selections survive device changes; iOS disables these filters.
- **Copy / Save** use text marked inside the log list. Copy is disabled without a selection; Save then exports all displayed messages in the current filtered order (the frozen snapshot while paused), preserving metadata and multiline messages. Save downloads a plain-text `.log`; Copy offers selectable text if clipboard access fails.
- **Pause** freezes the displayed messages while capture continues in the bounded buffer. **Resume** shows the latest retained messages and follows the newest end. Reconnecting or selecting another device resumes the view; clearing while paused keeps it paused.
- **Buffer size** selects 1,000, 2,000 (default), 10,000, 50,000 or 100,000 messages for the browser. Reducing it immediately removes the oldest entries from both the live buffer and any paused snapshot. Increasing it allows more future messages; discarded entries cannot be recovered. The setting lasts for the current page session.
- The server batches up to 100 messages every 100 ms and caps its queue at 1,000, dropping the oldest queued records and reporting when overloaded. Individual message text is capped at 16,384 JavaScript characters. This is a viewer, not a lossless recorder.
- Android includes whatever history remains in logcat plus live output; reconnects may repeat that history. iOS uses the legacy syslog relay, which may expose fewer records than Apple's unified-log Console view or Xcode debugger output. Its upstream decoder also uses a fixed 5 KiB line buffer; long iOS lines are not guaranteed intact. Test real Unity logs/exceptions before relying on completeness.
- Android timestamps come from logcat; iOS timestamps in the UI are host receipt times, with the device's original text retained. No cross-device clock normalization.
- Disconnections stop capture. Select the device again or use **Reconnect**; there is no silent automatic retry or promise of gap-free capture.
- Localhost only, with Host/Origin checks. No persistent storage or remote access. Android supports structured severity filters; iOS retains its original text-only logs. Copy exports selected log text. Save exports the selection, or all currently displayed, filtered messages when nothing is selected, including the frozen snapshot while paused. Logs render as text, never HTML.

## Architecture

Vue 3 and Vite provide the frontend; Express runs the TypeScript backend on Node.js. Frontend and API share one loopback HTTP server. Logs use Server-Sent Events (`EventSource`), with one collector per browser selection; collectors are not shared across tabs.

| File | Purpose |
| --- | --- |
| `src/App.vue` | Device selection, polling, streaming, filtering, pause, ordering and buffer controls |
| `src/style.css` | Responsive Precision light/dark styling |
| `src/components/PrecisionMenu.vue` | Custom keyboard-accessible selector |
| `shared/log-view.ts` | Severity normalization/filtering and plain-text export |
| `src/main.ts` | Vue entry point |
| `shared/types.ts` | Device, discovery and log-message types |
| `shared/search.ts` | Fuse.js full-text search, preserving arrival order |
| `server/index.ts` | API routes, local access checks, Vite/static serving and shutdown |
| `server/devices.ts` | Android/iOS discovery and log adapters |
| `server/stream.ts` | SSE batching, backpressure, timeouts and collector cleanup |
| `server/ios-types.d.ts` | Bridge to the iOS package's shipped module declarations |
| `server/stream.test.ts` | Stream lifecycle, framing and backpressure tests |
| `server/search.test.ts` | Fuzzy-search regression tests |
| `docs/design/README.md` | Approved Precision design and implementation expectations |

`GET /api/devices` returns `{ devices, warnings }`. `GET /api/logs?platform=android|ios&id=...` emits `logs`, `status` and `stopped` events. Concurrent discovery requests are coalesced; a discovery failure on one platform does not discard the other platform's results.

Messages stay in arrival order internally so trimming always removes the oldest records. Search indexes are cached until the visible buffer changes; while paused, filtering uses the frozen snapshot.

## npm research (2026-09-29)

| Package | Discovery / logs | Decision |
| --- | --- | --- |
| [`@devicefarmer/adbkit`](https://github.com/DeviceFarmer/adbkit) 3.3.9 | Device enumeration/tracking; ADB shell and logcat | Selected for discovery and the Android connection. Requires a local ADB server/binary. |
| [`@devicefarmer/adbkit-logcat`](https://github.com/DeviceFarmer/adbkit-logcat) 2.1.3 | Parses binary logcat into timestamp, priority, PID, tag and message | Selected explicitly. Own the raw socket via adbkit rather than `openLogcat()` to control cleanup and avoid its hard-coded info filter. |
| [`appium-ios-device`](https://github.com/appium/appium-ios-device) 3.1.24 | `getConnectedDevices`, `getDeviceName`, `startSyslogService` | Selected: direct Node communication over usbmuxd, no Appium server or native npm addon. Primarily tested by Appium on macOS. |
| [`appium-ios-remotexpc`](https://github.com/appium/appium-ios-remotexpc) | Device multiplexing, modern remote services and system logs | Defer: tunnel setup and elevated privileges add complexity beyond this prototype. |
| [`appium-ios-log`](https://www.npmjs.com/package/appium-ios-log) | Older iOS log wrapper | Reject: deprecated. |
| [`libimobiledevice-node`](https://github.com/norman784/libimobiledevice-node) | Native libimobiledevice addon | Defer: native compilation/distribution is unnecessary for the first version. |

The selected Appium version [implements `com.apple.syslog_relay`](https://github.com/appium/appium-ios-device/blob/master/lib/syslog/index.js), not the newer os_trace relay used by current upstream `idevicesyslog`. If real-device capture is incomplete, the next experiment should compare against current libimobiledevice or pymobiledevice3 before adding UI features.

`server/ios-types.d.ts` bridges the package's missing published entry-point declaration using its shipped module declarations. Socket/decoder lifecycle hooks are isolated in `server/devices.ts` because Appium's service has no public event interface. Review these when upgrading the locked dependency version.

Android capture owns the raw `shell('logcat -B *:V')` socket and passes it to adbkit-logcat with `fixLineFeeds: false`. Preserve explicit socket ownership for cleanup. The iOS adapter accesses Appium's `_socketClient` and `_decoder` for lifecycle handling; these internal fields need review on upgrades.

## Crash and exception formatting

Java/Kotlin causes, native signal/tombstone frames, abort/sanitizer diagnostics,
ANR threads, Unity C# frames and iOS ObjC/Swift/crash/termination text receive
syntax-aware formatting. Recognized complete IPS/jetsam JSON is indented without
changing numeric literals. Raw records, search and full-log export are unchanged.
This does not add crash-file retrieval, file import, binary core-dump decoding or
symbolication. See [research, examples and capture limits](docs/crash-format-research.md).

## Verification

`npm test` (or `bun run test`) checks collector cleanup, device-switch races, connection errors, safe stream framing, bounded slow-client behavior, and fuzzy matching across metadata and long messages. `npm run build` (or `bun run build`) checks frontend/backend types and produces the Vue bundle and compiled server. `npm run test:package` builds and packs the application, checks the archive allowlist, installs it without development dependencies into a temporary directory, and tests npx/bunx startup plus frontend/API serving. Both npm and Bun must be installed to run that packaging check.

The latest checks on 29 September 2026 passed all fifteen tests and the production build. Browser checks using simulated devices verified severity/search composition, newest/oldest order, pause/resume, Copy/Save against the filtered frozen snapshot, iOS filter disabling, retained Android selections, keyboard menu focus/Escape, buffer trimming, and clipboard fallback. Light/dark rendering and a 390-pixel mobile viewport were checked. Startup, frontend serving and the discovery API were verified locally on macOS. Earlier browser checks used simulated devices to exercise combined selection, incoming messages, device switching, scrolling, clearing and safe text rendering. Those temporary fixtures are not a committed browser test suite; the current browser checks are also manual automation, not a committed end-to-end suite.

Physical Android/iOS log capture remains unverified. Windows/Linux compatibility and rendering/search performance at 100,000 records have not been validated.

## Next validation and implementation work

- Keep the implemented [Precision design](docs/design/README.md) aligned with its reference while validating real-device capture.
- Connect authorized Android and iOS devices and verify discovery, trust errors and real message delivery.
- Compare Unity `Debug.Log`, warnings, exceptions, long stack traces and native-plugin messages against logcat and Apple Console in relevant debug/release builds.
- Exercise switching during connection, app restarts, locking, unplug/replug and noisy streams; verify cleanup and usable scrolling at larger buffer sizes.
- If iOS coverage is incomplete, compare alternative collectors before promising parity with unified logging. Prioritize trustworthy capture and actionable errors.
