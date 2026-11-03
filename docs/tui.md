# OpenTUI proof of concept

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
`fr`, `it`, `ja`, and `zh-CN`; the language button cycles through them.

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
Cross-platform release packaging is not implemented here. The backend is not
bundled, so live device capture still needs the separately running UDL server.
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

The existing web UI and device adapters are unchanged. The PoC omits simultaneous
sources, severity/tag/PID controls, multi-record range selection, Semantic Flows,
JavaScript execution, clipboard commands, settings persistence, and update UI.
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
