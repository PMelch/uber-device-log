# Product assessment and precise filtering

Date: 1 October 2026. Scope: repository-based discovery, one implemented feature slice, and a prioritized follow-up backlog. This document uses the product-development workflow. Priorities are hypotheses derived from the existing workflows; no user interviews, usage telemetry, or physical-device experiments were performed for this assessment.

## Product direction

Über Device Log serves mobile developers and QA engineers who need to inspect Android/iOS device output, investigate exceptions, and share relevant evidence. Unity developers are a plausible segment given the existing C# stack formatting. The core journey is connect → find → pause and inspect → select → copy or save.

Strengths are local operation without an account, a shared interface for both platforms, complete-entry exports, cautious technical explanations, seven-language UI, and a focused Precision design. Preserve those strengths instead of expanding into a general monitoring dashboard. Original logs and technical values must remain verbatim.

The clearest gap is precision: fuzzy full-text search alone cannot reliably isolate a specific Android tag or process. Further gaps are repeated filter setup, inability to reopen exported sessions, and transient visibility of capture loss. Real-device capture, Windows/Linux compatibility, and performance at 100,000 records remain validation gaps in the existing technical documentation.

[Android's official Logcat guide](https://developer.android.com/studio/debug/logcat) documents process IDs and tags as record metadata and supports field-specific tag queries. This is precedent for separating metadata from message search; the implemented feature does not claim Android Studio query-language or feature parity.

## Implemented slice: precise filtering

**Problem:** a developer looking for tag `Unity` and PID `12` can receive unrelated full-text matches, such as tag `UnityAds`, PID `123`, or a message merely mentioning `PID12`.

**Outcome:** combine an explicit search mode, exact Android tag/PID fields, and existing severity controls to isolate records without changing capture or original content.

User stories:

- As a developer, I can keep typo-tolerant search or choose a literal phrase when similar text creates noise.
- As an Android developer, I can limit results to a known tag and process without matching those values inside message text.
- As a QA engineer, I can reset filters and inspect or export the resulting whole records using the existing paused-selection workflow.

Acceptance criteria:

1. Approximate search remains the default and requires every whitespace-separated term using the existing fuzzy behavior.
2. Literal search matches the trimmed query as a contiguous, case-insensitive substring within any one original searchable field: timestamp, level, tag, PID, or message. It does not join fields, tolerate typos, or interpret regex syntax. An empty query returns all retained records before other filters.
3. Android tag filtering matches a complete, case-sensitive tag after trimming input whitespace. PID filtering matches a complete numeric PID; leading zeroes are accepted. Blank fields impose no restriction. Invalid PID input produces a localized validation message and no matches.
4. Search, tag, PID, and selected levels combine with AND semantics and preserve arrival order before the existing display-order transformation.
5. Tag/PID fields are disabled for iOS and before a capture device is known; no metadata is inferred from iOS text. Retained Android field values do not filter iOS records. After an Android capture stops, these fields remain usable for its retained logs.
6. Reset clears search text, tag, PID, and level restrictions while retaining the selected search mode and the existing paused state. Selection continues to follow the existing visibility-pruning rules.
7. Filtering a frozen snapshot does not resume capture display. Selection, Copy, Save, multiline records, and original JSON/text content retain their existing semantics.
8. Every new UI string, hint, validation message, and accessibility label has translator context and English, Spanish, German, French, Italian, Japanese, and Simplified Chinese catalogs.
9. Controls remain usable by keyboard and at narrow widths; language changes update existing status and selection text without changing records.

Non-goals: regex/query language, package-name inference, process discovery, saved presets, automatic PID tracking across app restarts, persistent captured logs, collector changes, and publication or deployment.

## Architecture and risks

`shared/search.ts` owns the typed search mode and literal matching. `shared/log-view.ts` owns pure Android metadata predicates and PID validation. `src/App.vue` combines these with existing computed snapshot/search/severity state. Existing selection pruning applies when filters change. UI text uses the typed catalogs and translation context; no rendered translations are stored as filter state.

This adds no dependencies, API endpoints, permissions, or external processing. Inputs are compared as data, not executed as regex or markup. Filtering does not mutate captured records or serialized exports. Tests need to demonstrate near-match exclusions and composition rather than simply repeat the predicates.

PID filters can become stale after an app restarts. Literal search is substring matching, not whole-word matching; tag filtering deliberately differs by being case-sensitive and whole-field. These semantics must stay explicit in UI hints and documentation. Existing bounded buffers and capture limitations still apply. This slice does not validate large-buffer performance or physical-device completeness.

## Validation and review

The implementing agent reports `npm test` passing with 64 tests and `npm run build` passing. An independent reviewer approved the final change. Regression coverage includes literal phrases, regex characters treated as data, multiline content, cross-field exclusions, tag/PID near matches, invalid PID values, platform handling, combined severity filtering, and export preservation.

Browser verification used synthetic fixtures, not physical devices:

- `Unity` / PID `12` plus fuzzy `conection` returned one record; `UnityAds` / PID `123` and message-only PID mentions were excluded. Literal typo search returned zero; the literal phrase returned one.
- PID `12x` displayed validation and no results. Selecting all filtered records froze one record. Reset restored three displayed records while retaining literal mode, pause, and the selected record.
- English → German → French updated the existing live status and selection labels without mutating logs.
- Desktop German and mobile 390px German / 320px French layouts had no horizontal overflow. The 320px check measured document width 305px within a 320px viewport.
- ArrowDown focused a search-mode option; Escape closed the menu and returned focus to its summary.
- Light and dark layouts kept the new fields readable. Switching to iOS with an invalid Android PID disabled both metadata fields, removed the validation state, and displayed the original iOS record.

These browser checks are manual automation. Physical Android/iOS testing, Windows/Linux compatibility, the full seven-language visual matrix, and 100,000-record performance remain unverified.

Success for this slice is correctness of isolation and preservation of existing workflows. Future research should measure time to isolate a known incident and whether developers understand literal versus fuzzy behavior; no product usage metrics were collected here.

## Prioritized follow-up backlog

| Priority | Opportunity | Acceptance direction | Main risk |
| --- | --- | --- | --- |
| P1 validation | Verify real-device capture and noisy-stream behavior | Compare representative Android/iOS and Unity output with source tools; document missing/truncated records and reconnect behavior | Existing iOS relay limitations can dominate UI improvements |
| P2 | Saved filter views | Save/apply/delete named local presets for query, mode, fields and severity; blocked storage remains usable for the session | Stale PIDs and defensive storage migrations |
| P2 | Open exported JSON sessions | Validate schema v1 and limits; show an explicit offline state; preserve identity/text and support search, details, selection and reexport | Untrusted files, memory use, ordering and live/import transitions |
| P2 | Persistent capture-quality indicators | Track known server drops and viewer evictions separately until a new session; avoid implying unknown losses are measurable | Requires explicit server event contracts; no completeness guarantee |
| P3 | Incident bookmarks | Mark and revisit retained records without altering text; explicitly handle eviction and session changes | Interaction complexity around paused selection and bounded retention |

Each follow-up requires its own implementation-ready scope, translation context, independent review, and targeted validation. Prefer the smallest useful extension of the current investigation workflow.
