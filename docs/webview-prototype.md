# Android WebView console prototype

## Context and scope

The existing device flow lives in `server/devices.ts`, `server/index.ts`,
`server/stream.ts`, `shared/types.ts`, `src/remembered-device.ts` and `src/App.vue`.
Reuse SSE buffering, source-switch cleanup, typed notifications, translated
catalogs, the desktop sidebar and the mobile disclosure menu. New WebView
identifiers refer to both a debug socket and a page target; a PID alone is not
unique because one process can contain multiple WebViews.

Discover inspectable Android WebViews every existing device refresh. Show their
unchanged titles/URLs as child buttons. Selecting a child starts its console
stream and clears the previous view, matching device switching. Selecting the
parent returns to Logcat. A missing target stops capture without switching to
a different source. Remember only the parent device; page IDs are transient.

The collector enables CDP Runtime events for console calls and uncaught JS
exceptions. Object arguments use CDP descriptions; this prototype does not
expand objects, execute JavaScript, inspect DOM or provide a network panel.
Device-side WebView debugging must already be enabled.

## Architecture and risks

Read `/proc/net/unix` via ADB, enumerate `webview_devtools_remote` sockets, query
`/json/list` via temporary loopback tunnels and connect to the selected page.
Never use a target-advertised host to access the network. Rediscover and validate
socket/page IDs on capture requests. Close tunnels, WebSockets and pending
connections when capture ends. Bound discovery time and response sizes. Device
connection failures must not hide the parent device.

All added copy includes translation context and seven translations. Export JSON
identifies Android WebView capture and retains target metadata. Console timestamps
use CDP epoch milliseconds when available, otherwise host receipt time.

## Validation plan

Use node:test for socket discovery, fake ADB streams, local HTTP/CDP fixtures,
console arguments/severity/exceptions, command failure and cleanup, selection
identity, target disappearance, and export source. Render the device list with
Vue SSR and inspect desktop/mobile UI with long translated titles. Run `npm test`
and `npm run build`. Report physical-device validation separately from simulated
protocol validation. An independent CoRe reviewer checks the final implementation;
this run leaves changes uncommitted because the checkout contains preexisting work.

## Validation results (2026-10-13)

- `npm test`: 73 tests passed, including real loopback HTTP/WebSocket fixtures
  through simulated ADB transport and an ADB acquisition timeout regression.
- `npm run build`: passed; `git diff --check`: passed.
- Independent CoRe review approved after fixing the shell-acquisition deadline.
- Browser QA with `server/fixtures/webview-ui.mts`: device-to-WebView switch,
  different WebView selection, desktop sidebar, 390 px mobile menu, keyboard
  selection, long German title, live status retranslation, and target removal.
  Removal stopped capture and retained messages without switching source.
- `adb devices -l` found no connected device, so physical-device verification
  remains outstanding. Only inspectable WebViews appear.

Run normally with `npm run dev`. For repeatable UI-only QA after building, run
`node --import tsx server/fixtures/webview-ui.mts` and open port 4312. The fixture
uses fictional logs and is excluded from production compilation/package output.

## Physical Android validation (2026-10-13)

Connected a Pixel 9 Pro XL via ADB. Discovery returned the inspectable page
`Slot` as a child target. A 12-second SSE capture returned HTTP 200,
`webviewLive`, and 1,180 console records (`console.log` and `console.warning`).
The browser displayed real console messages. Switching to the parent produced
native Logcat entries; switching back restarted the WebView console successfully.
No JavaScript was injected and no app/device settings were changed. The earlier
physical-device validation gap is closed for this device and WebView setup;
other Android/WebView versions and uncaught-error delivery were not exercised
on hardware in this test.
