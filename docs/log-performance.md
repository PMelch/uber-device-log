# Live log performance

## Problem and acceptance criteria

Fast sources previously re-sorted every retained record, parsed timestamps in each
comparison, rebuilt a fuzzy search index for every delivery, and rendered every
matching record. Buffers above 2,000 records could block the page.

The optimization targets a 10,000-record buffer without changing raw captured
messages, source filters, chronological display, pause, selection or export.
The viewport should render only nearby rows; retained data and measurements must
remain bounded. Pausing and selecting freeze the displayed snapshot while capture
continues. Export and range selection must include offscreen records.

## Implementation decisions

- `src/log-streams.ts`: coalesce deliveries into a 50 ms update. Flush before stop
  and source toggles. Freeze the currently displayed immutable array before
  flushing queued arrivals into the live buffer, so clicked rows cannot be evicted
  from the snapshot. Discard queued records on clear/unmount.
  Compact a throttled/background-tab queue above twice the configured capacity.
- `shared/log-sources.ts`: sort only the incoming batch, append when it follows
  the retained tail, otherwise merge backwards until capacity is reached. Cache
  parsed timestamps by immutable record identity. Invalid timestamps precede dated
  records; unique arrival keys break ties. No device clock normalization is added.
- `shared/search.ts`: construct Fuse lazily, never for a literal-only search.
  Reuse immutable record fields through weak caches.
- `createSourceFilterer`: cache per-record matches for the active source filter.
  Only new records are searched while its settings stay unchanged. Changing a
  filter invalidates its matches. Fuse uses no field normalization or result
  sorting, so matching a new batch retains the full-search semantics.
- `src/App.vue`: shallow reactive live/frozen arrays, full-data selection/export,
  and TanStack Vue Virtual with dynamic height measurements and stable row keys.
  Preserve the visible row and its pixel offset during live merges. If capacity
  removes that row, move to the nearest surviving edge. Release obsolete height
  measurements periodically and reset them on empty views.
- Keep focused rows mounted. Native text selection additionally retains every
  row intersecting its selection; release them when the selection collapses.
  Selecting a large native text range can therefore deliberately mount more rows
  in the frozen view. Ordinary checkbox/select-all selection stays virtualized.

Names follow existing `createLogStreams`, `filterSourceMessages`, `mergeSourceMessages`
and `useLogDetails` patterns. No new product prose or log-data transformations are
introduced. Existing source-selection work in the working directory is preserved.

An immutable flat array remains the initial storage choice. Its append path still
copies retained references; it is not O(batch size) overall. A ring buffer or worker
can be considered if measured computation remains a bottleneck. WebAssembly does
not address the browser's DOM/rendering work.

## Verification

Run the standard suite and build:

```sh
npm test
npm run build
```

The Node tests cover cached timestamps, delayed/tied/invalid timestamps, oversized
batches, incremental fuzzy/literal filtering, invalidation, batching, clear/flush,
and timer throttling. Existing tests cover filtering, frozen selection and export.

For a repeatable real-browser check, make Playwright available in your environment
and run:

```sh
node scripts/test-log-performance.mjs
```

Optional environment variables: `PLAYWRIGHT_MODULE` (absolute Playwright module
path), `CHROME_EXECUTABLE` (installed Chrome executable), and
`PERFORMANCE_SCREENSHOTS` (existing output directory). The script runs an ephemeral
localhost fixture serving the production build, starts with 10,000 mixed-height
records and sends up to 5,000 records/second. It checks bounded DOM rows, scroll
anchors, following, frozen capture, complete 10K JSON export, native selection
survival, stationary selection collapse, all seven languages and desktop/mobile
widths. It reports browser errors and long tasks, when supported. These durations
are elapsed time, not exact CPU consumption. Real-device throughput and browser
behavior still need a device test, especially Safari/iOS native selection.

### Validation on 2026-10-13

- `npm test`: 89 passed; local socket tests require permission to bind localhost.
- `npm run build`: passed.
- Chrome production-build fixture: 10K retained, approximately 5K incoming records/s;
  19–28 mounted rows in ordinary viewport states, no browser errors and no reported
  long tasks over 50 ms during the check. Both display orders retained anchors.
- Frozen selection exported all 10K records. Native selection survived offscreen
  scrolling and released extra mounted rows when collapsed. Seven languages passed
  at 1440px and 390px without page overflow; screenshots were inspected.
- Independent code review approved after fixes for measurement retention and
  reactive native-selection pinning. Real-device and Safari validation remain manual.

## Optional diagnostics

Enable **Show performance diagnostics** in Settings. The preference is stored
locally and defaults to off. The panel updates about once a second with the actual
sampling interval, accumulated synchronous log merge/filter/queue-compaction
execution time, requestAnimationFrame callback frequency, and the count/duration
of observed main-thread tasks longer than 50 ms. Unsupported Long Tasks API
observation is shown as unavailable, not zero.

Processing durations are elapsed time, not CPU utilization, and exclude rendering,
transport JSON decoding and other page work. Animation callbacks are not painted
frame counts. Long-task durations overlap processing and must not be added to it.
No timers, animation sampling or performance observers run while diagnostics are
disabled or the document is hidden. Visibility restores a fresh sampling window.
Numeric samples remain language-independent; all UI text is localized in seven
languages and existing samples update when the language changes.

Diagnostics validation: 94 Node tests and build passed; independent review approved.
The browser fixture verified enable/disable by keyboard, preference persistence,
unsupported observation, language switching and mobile layout. One 10K/5K-per-second
sample reported 44.0 ms processing over 1.0 seconds, 60 animation callbacks/s,
and zero observed long tasks. These fixture values are not a real-device guarantee.
