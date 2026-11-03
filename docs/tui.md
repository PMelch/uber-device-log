# Terminal log viewer

During development, start the TUI directly from source (Bun required):

```sh
npm run dev -- --tui
npm run dev -- --tui --project .
```

No compiled executable is required. Restart the TUI to apply source changes.
Without `--tui`, `npm run dev` keeps the web server's tsx watcher.

For the package-style entry point, build the web/server and host-specific terminal executable:

```sh
npm run build
npm run build:tui
node bin/uber-device-log.mjs --tui --project .
```

`udl --tui` starts direct native/WebView collectors without starting the HTTP
server. `--project` and `--flows` initialize the same project context; `--port`
is accepted and validated but unused. Blueprint editing is not implemented yet.

Settings shows one compact field with the current value for language, terminal
colors, message order and retained record capacity. Enter/Space or a click opens
a popover; arrows or Tab move through its choices, and Enter or a click applies
the selected value. Escape or a click outside dismisses the popover unchanged.
Escape in Settings, Close settings or the frame’s [X] returns to the viewer. Changes apply immediately
for the current session, while capture continues. Smaller buffers discard the
oldest live and frozen-view entries; changing order preserves pause and inspection.
JSON exports remain oldest first regardless of display order. Preferences are not
saved across restarts.

Sources refresh automatically two seconds after each completed discovery; the
Refresh sources button at the end of the Sources panel also refreshes immediately. Closed WebViews disappear and stop
capturing, while existing log history and other active sources remain. New
WebViews require explicit selection. An open console target picker updates too. Use F6 or the Hide/Show sources button
to collapse the source panel. F11 or Fullscreen expands the log stream; F11,
Escape or Exit fullscreen restores the previous layout. The single shared search
field stays visible in fullscreen and filters logs from all active sources. Capture, search and
selection survive these layout changes. The Sources border also offers `[-]`
and a collapsed `[+]` control; the Log stream border offers a fullscreen icon
and a restore arrow. These have the same behavior as the toolbar and shortcuts. Source checkboxes combine native logs
and WebViews belonging to one parent device. Selecting another parent clears the
view and stops the old collectors. Disabling/re-enabling a source replaces its
buffer. Explicitly enabling a source resumes the live view and clears the current
selection while keeping the search query. Narrow terminals stack the source list above logs. Tab scrolls source
controls into view; Enter or Space toggles the focused source. Search is currently
a global literal search; per-source severity/tag/PID filters are not yet available.

Open **JavaScript console · Alpha** to inspect a WebView without changing the
selected log sources. Select a discovered WebView and explicitly choose its
execution context. Enter or Run executes the current expression once; Up/Down
in the expression field navigates the last 50 commands. Result objects expand
on demand, with bounded property pages and no automatic getter invocation.
Reconnect and target changes invalidate old handles; navigation requires choosing
a context again. Clear output releases retained results. Escape or Close returns
to the logs, whose capture continues in the background. Console access is
available in direct local mode, not the synthetic demo or legacy HTTP client.

The Appearance field in Settings offers Auto, Light, Dark and Off (monochrome).
Auto reads the terminal foreground, background and ANSI palette and responds to
reported palette changes. Unsupported queries fall back to a fixed dark palette.
Text roles are adjusted to at least 4.5:1 contrast against normal, panel and
selected backgrounds. Timestamp and debug levels are subdued, warning/error
levels are colored and bold, source names use an accent, and message text stays
neutral. Level labels and selection markers remain available in monochrome.
Appearance changes apply to the current session without changing captured data.

The executable is a local build, not part of the published npm distribution.
Use Bun 1.3.14 or newer as below. If an older macOS Bun creates an executable
with an invalid signature, rebuild using a supported Bun, or ad-hoc sign the
local binary with `codesign --force --sign - build/udl-tui`.

## Development demo and HTTP client

The TUI uses **OpenTUI Core 0.8.2** with its direct TypeScript API. This is an
optional development prototype on `feature/tui`, not a replacement for the web
viewer or a published package command. No React or Solid renderer is needed.

## Run the demo

From this checkout, install dependencies with `npm ci`. Install Bun 1.3.14 or
newer (1.4+ on Windows arm64), then run:

```sh
npm run tui
npm run tui -- --records 100000 --locale de
```

The default source is explicitly synthetic. It preloads the requested record
count, retains at most that many records, and adds 100 fictional records per
second. It does not contact a phone. Supported locales are `en`, `es`, `de`,
`fr`, `it`, `ja`, and `zh-CN`; the Language field in Settings lets you choose between them.

The web application retains its existing Node requirement. OpenTUI's development
dependency declares Node >=26.4, so installing this development checkout under
older Node may emit an engine warning. The documented TUI runner is Bun.

## Connect to UDL

Start the existing server in a separate terminal:

```sh
npm run dev
```

Then start the client:

```sh
npm run tui -- --server http://127.0.0.1:4310
```

Choose **Sources** to discover connected devices and their WebViews. Choose one
source to start capture. Opening the picker again refreshes discovery; selecting
the same source reconnects it. This prototype captures **one source at a time**.
A source change clears the previous view. Exiting the client closes its stream
but leaves the separately running server active. Original device setup and
inspection prerequisites still apply.

## Interaction

- Tab / Shift+Tab moves focus. Enter or Space activates a focused button.
- Clicking a control focuses and activates it. Clicking a log freezes the view
  and displays its complete record in the detail panel.
- Up/Down, PageUp/PageDown, Home/End navigate the focused log list. Enter inspects
  the current record. Scrolling with the wheel or dragging its scrollbar also
  freezes the view, so incoming records cannot shift the entries being read.
- **Back to live** clears the inspected record and follows the newest entries.
  Capture continues while the view is frozen.
- The detail panel scrolls independently and supports mouse text selection.
  Terminal clipboard integration is not implemented by this prototype.
- Search is literal and uses the shared search implementation. It includes
  message text, timestamps, level, tag, and PID. Clear empties the view and live
  buffer without stopping capture; the current search is retained.
- **Save JSON** saves the inspected whole record, or all filtered records when
  none is inspected, using the existing versioned export format. Files use a
  unique `udl-tui-*.json` filename in the launch directory or `--export-dir`.
  Existing files are never overwritten. Export failures appear in the status line.
- Escape closes the source dialog and restores focus. Ctrl+C or **Quit** exits.

Wide terminals show logs and details side by side; narrower terminals stack
them. Use at least 60 columns and 24 rows for a useful view. All seven catalogs
are reused, including status descriptors that are translated on each render.
Device identifiers and original logs remain unchanged. Terminal control bytes
are escaped only in the rendered presentation.

## Build a standalone executable

```sh
npm run typecheck:tui
npm run build:tui
./build/udl-tui --help
./build/udl-tui --records 100000
```

Bun embeds its runtime and OpenTUI's native assets. This builds for the current
host; the resulting TUI executable does not invoke an installed Node or Bun.
Cross-platform release packaging is not implemented here. Direct capture uses bundled device adapters; the optional `--server` client
still connects to a separately running UDL server.
Physical Android/iOS capture and other OS/architecture combinations need device
and platform validation. This PoC does not establish release readiness.

## Architecture and discovery notes

This is a cross-module (L2) change with an isolated terminal entry point. Discovery
reviewed `docs/architecture.md`, `src/App.vue`'s documented invariants,
`src/log-streams.ts`, `shared/search.ts`, `shared/log-sources.ts`,
`shared/log-export.ts`, `shared/types.ts`, and the typed localization catalogs.

- `tui/model.ts` follows the existing bounded merge, immutable keys, separate
  live/frozen buffers, and whole-entry selection. Filtering caches by input array
  and query; UI rendering creates only enough line elements for the viewport.
- `tui/client.ts` adapts the existing `createLogStreams` lifecycle to Node/Bun's
  EventSource package. Explicit retry and stale-callback protection are reused.
- `tui/app.ts` supplies focus order, source dialog, input, virtual log rows,
  scrollbar, and selectable details. `createTui` is a new terminal entry-point
  naming exception; `createLogModel`/`createTuiClient` follow the existing
  `createLogStreams`/`createSourceFilterer` factory style.
- `tui/index.ts` owns CLI parsing, export writes, timers and shutdown.
  `tui/demo.ts` produces fictional log records.
- New UI keys have matching translator context and all seven translations.
  No captured log text is translated.

The terminal viewer still omits severity/tag/PID controls, multi-record range
selection, Blueprint editing, clipboard commands, settings persistence, and update UI.
These remain follow-up features, not implied parity with the web application.

## Verify

```sh
npm run test:tui
npm run typecheck:tui
npm test
npm run build
npm run build:tui
```

The TUI tests cover frozen snapshots with eviction, literal filtering, terminal
control escaping, mouse/Tab focus, source-dialog focus containment and selection,
mouse text selection during arrivals, draggable scrolling with 100,000 records,
resize, and a real loopback HTTP/SSE fixture. Tests require permission to bind
local ephemeral ports. Headless frames can check layout but do not replace real
terminal and physical-device checks.


## Semantic Flows

The Flows toolbar button in direct/local mode opens a dedicated screen. Its list
shows live labels, source/device identity, priority, outcome and completeness.
Search matches visible labels, blueprint names, devices and localized outcomes.
Use arrows or PageUp/PageDown to navigate; Enter or a click opens the timeline.
New arrivals preserve a deliberately navigated row and the selected flow.

The detail screen shows expected steps and results, chronological observed events,
and a separate payload inspector. Sensitive extractions and label substitutions
remain masked. Raw log inspection requires choosing Raw log and explicitly
revealing values. Escape returns to the list, then to logs. Info shows loaded
blueprints and diagnostics; Reload files refreshes definitions without a server.
Clear resets only flow analysis history; clearing or pausing the log view does
not stop recognition or erase flows.

Definitions come from the same global/project registry and activation policy as
the web interface. Files refresh every three seconds after the prior request
settles; timeouts advance even without new logs. The worker shares the web
engine, bounded analysis queue and watchdog. Source changes, disconnects,
truncation and queue loss mark incomplete capture or interrupt sessions. Restart
analysis recovers from a failed worker and starts a fresh recognition history.

The terminal build includes `tui/flow-worker.ts` as a second executable entrypoint;
keep it in custom build commands. Demo and legacy `--server` modes do not expose
the Flows screen. Blueprint editing and bundle management remain follow-up work.
