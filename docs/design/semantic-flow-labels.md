# Semantic Flow labels and overview density

## Context and contracts

This is a cross-module change (L2): the version 1 validator, accepted evidence,
worker snapshots and list/timeline rendering share the blueprint contract.
Relevant conventions come from `shared/flow-{types,blueprints,engine}.ts`,
`src/components/FlowWorkspace.vue`, `src/i18n/` and the existing flow browser fixture.
`label` follows `name`/`shortLabel` as blueprint-authored data. `result` follows
extractor flags `required`/`sensitive`. `flow-presentation` follows the existing
pure `flow-path` helper and keeps presentation independent of capture matching.

## Behavior and acceptance

- A blueprint can supply an initial label. Accepted steps and applicable errors
  can replace it. Omission preserves the previous rendered label.
- Plain text or typed semantic text segments interpolate explicit extracted
  values; markup and scripts never execute. Missing values cannot fabricate data.
- Label/result presentation derives from accepted evidence and the instance's
  pinned blueprint revision. Rejected and ambiguous evidence cannot update it.
- Sensitive substitutions and Result fields stay concealed in the overview;
  explicit reveal remains limited to the timeline inspector.
- Detailed keeps the existing node sequence. Condensed does not render overview
  nodes or edges; label, Result fields, identity, outcome and inspection actions
  remain. Capture gaps remain visible in either mode.
- Only the density preference is saved locally, never extracted payloads or labels.
  Existing definitions without labels still show their blueprint name.
- All built-in controls use the seven catalogs; authored text remains verbatim.

## Verification and boundaries

Node tests exercise schema validation, graph dependencies, typed interpolation,
privacy, out-of-order and rejected evidence, error outcomes, and example routes.
Vue SSR verifies escaped authored data and concealed labels/results. Browser
checks cover keyboard density changes, absent condensed nodes, live label changes,
Result fields, source correlation, timeline reveal, seven locales and small screens.
Existing full tests/build remain required. No external bank service or real money
is involved in the fictional sample. Hardware capture is outside these fixtures.
