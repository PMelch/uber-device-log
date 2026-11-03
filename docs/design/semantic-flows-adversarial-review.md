# Semantic Flows adversarial audit

Scope: version 1 blueprint format, validator, recognition engine and all overview/Timeline displays. Existing uncommitted priority changes are included and preserved. CoRe-cycle uses the project configuration: independent review, fixes and re-review; no automatic commits.

## Test matrix

Concurrent instances and devices; overlapping blueprints, starts, branches, errors and repeatable phases; event-batch boundaries; pre-start reordering, expired evidence, reused IDs and revision pinning; deadlines with and without ticks; hostile/deep JSON; arbitrary step IDs; sensitive error codes; dense DAGs and long node labels; capture budgets and presentation privacy. Deterministic reproductions precede fixes; full tests/build and targeted real-browser checks complete the audit.

## Confirmed first-round findings

- `DISPLAY-1` (P1): Sensitive error-code extraction bypasses masking through errorCode rendering.
- `DISPLAY-2` (P2): Legal dense DAG blocks a single-card render for several seconds.
- `DISPLAY-3` (P2): Long legal step names overlap later graph nodes and their hit areas.
- `overlap-1` (P1): Enforce deadline before accepting ordinary late terminal evidence.
- `overlap-2` (P1): Do not migrate buffered ordinary evidence into a later reused-identity instance.
- `overlap-3` (P2): Expire pending rows before retrying them against later progress.
- `overlap-4` (P1): Replay older repeat evidence before later live updates overwrite its current value.
- `SPEC-1` (high): A small deeply nested JSON extraction crashes flow ingestion.
- `SPEC-2` (medium): Sensitive extracted error codes are exposed by automatic status presentation.
- `SPEC-3` (medium): A syntactically valid timeout overflows to an infinite deadline.
- `SPEC-4` (low): Valid ordinary step IDs beginning error: cannot use equalsFrom.

## Second-round findings

- Unbound aliases on unrelated active instances must not steal pre-start evidence
  for another operation. Future claims stay possible until positive identity exists.
- A known alias owner must exclude speculative unbound owners from pending
  ownership; cancellation must not release old evidence to a new operation.
- Rejected observations from skipped branches must not activate scoped errors.

All three have dedicated failing-first engine regressions and targeted passing
checks. Incoming batches now drain eligible earlier evidence between records;
existing terminal and pending barriers remain separate from presentation state.

## Third-round finding

Closed-identity pending barriers also have to survive blueprint reloads. The old
retired-identity test accidentally filtered by revision; an additional failing-first
regression now checks identical IDs across a closed v1 instance and a new v2 instance.
The guard now spans revisions within the same blueprint, device and capture epoch.

## Verification and retained boundaries

The final overlap round was independently approved after all seven overlap findings
were reproduced again. The spec/privacy/display reviewer approved the fixes in a
separate second round. An independent deterministic probe compared 1,000 randomized
branch/repeat/error/missing-ID sequences as batches and single records; states agreed.
The repository regression suite adds 60 seeded multi-device/multi-blueprint traces
with four batch sizes, ordinary/repeatable phases, known errors and decreasing progress.

Explicit contract limits remain: errors precede existing progression, which precedes
a new start; the same record is analyzed independently by different blueprints.
Unique operation IDs are necessary to distinguish an old callback arriving after a
new operation has already started with otherwise identical IDs. Retired evidence
barriers are bounded by retained capture history, not permanent tombstones. V1 has
no post-terminal edges, parallel joins or general retry loops. Regexes have no
per-pattern complexity proof; worker watchdog and capture budgets remain protective
limits rather than lossless recording guarantees. These are documented constraints,
not claims of exhaustive correctness for every possible application's instrumentation.

## Final verification

- 311 project tests pass, including all newly added adversarial regressions.
- Production build passes.
- Real browser: labels/repeat history, sensitive error-code concealment/search and
  explicit reveal, seven locales and three widths pass.
- Real browser: concurrent purchases, recognition outcomes, editor validation/save/
  conflicts, source controls, clear and privacy pass.
- Real browser: long node names, 4096-character short labels, Timeline/Info geometry
  and keyboard selection at desktop/mobile widths pass.
- Copied portable skill validation and source/reference fingerprint checks pass.
- Integration reviewer independently checked exact JSON depth/value boundaries and
  found no remaining specification/implementation contradictions.

- Priority theme/contrast/editor/revision browser checks pass.
- Installed-package smoke tests pass for node, npx, bunx and global udl, with
  project blueprints and log-only startup modes.
- Existing two- and four-way branch overview/detail browser checks pass, including
  seven locales, desktop/mobile layout and keyboard focus.
