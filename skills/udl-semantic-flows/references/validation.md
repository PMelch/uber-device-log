# Validate against the actual viewer

Use [the format contract](flow-format.md) and [the bundle fingerprint](contract.json) to identify the author's reference snapshot. A copied bundle is documentation, not a runtime validator. Its source package version does not prove that every described feature exists in that published version. When a running viewer or checkout disagrees, inspect its actual contract and report the mismatch; do not silently invent compatibility or claim a minimum release.

## Running local viewer

With an available viewer and permission to use its local API, validate a draft through `POST /api/flows/validate`. This endpoint does not save or activate the draft. Read [local access and Flow API](api.md) for exact request/response and token rules. Do not use a save endpoint merely to validate.

The following Node.js command reads one local draft and calls an already-running viewer. Run it from any directory; replace the draft path and, if needed, the loopback URL. It does not install a dependency or start the viewer.

```sh
node --input-type=module - /path/to/flow.draft.yaml http://127.0.0.1:4310 <<'JS'
import { readFile } from 'node:fs/promises';
const [filename, base] = process.argv.slice(2);
const snapshotResponse = await fetch(new URL('/api/flows/snapshot', base));
if (!snapshotResponse.ok) throw new Error(`Snapshot HTTP ${snapshotResponse.status}`);
const snapshot = await snapshotResponse.json();
if (typeof snapshot.token !== 'string' || !snapshot.token) throw new Error('Viewer does not expose the expected validation capability.');
const response = await fetch(new URL('/api/flows/validate', base), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Flow-Token': snapshot.token },
  body: JSON.stringify({ filename, source: await readFile(filename, 'utf8') }),
});
const result = await response.json();
if (!response.ok) throw new Error(`Validation HTTP ${response.status}: ${JSON.stringify(result.diagnostics ?? result)}`);
if (!Array.isArray(result.diagnostics)) throw new Error('Unexpected validation response.');
console.log(JSON.stringify(result.diagnostics, null, 2));
process.exitCode = result.diagnostics.length ? 1 : 0;
JS
```

An HTTP 200 response can contain diagnostics; success requires an empty diagnostics array. The endpoint checks one blueprint's format, graph and dependencies, not cross-file ID uniqueness or actual log recognition. The same check is available as **Flows → Blueprints → Validate draft** in the editor. Saving writes project files and requires separate authorization within the task.

## Available viewer checkout

If the actual viewer checkout already has its dependencies installed, run this from that checkout root. The imported validator belongs to the viewer; it is intentionally not copied into this skill.

```sh
node --import tsx --input-type=module - /path/to/flow.draft.yaml <<'JS'
import { readFile } from 'node:fs/promises';
import { parseFlowBlueprint } from './shared/flow-blueprints.ts';
const filename = process.argv[2];
const result = parseFlowBlueprint(await readFile(filename, 'utf8'), filename);
console.log(JSON.stringify(result.diagnostics, null, 2));
process.exitCode = result.diagnostics.length ? 1 : 0;
JS
```

Do not run dependency installation just because this command is unavailable. Continue code tracing and report the missing check. Do not create a substitute validator from memory, mistake `version: 1` for full validity, or label a generic YAML parse as semantic validation.

## Recognition and evidence checks

For `.blueprint` archives, follow [bundle authoring](bundle-authoring.md) and use the included [helper](../scripts/blueprint_bundle.py). `validate <archive> --viewer-root <compatible-checkout-or-package>` invokes the actual whole-bundle validator without installation. `pack` requires either that viewer or explicit `--structural-only`; the latter reports unperformed manifest/DSL checks and produces an unvalidated draft. ZIP structure and a successful per-file validation API call do not establish whole-bundle validity or duplicate-ID freedom. When extending, validate the complete rebuilt archive, including earlier definitions, and preserve the original while doing so.

A schema-valid draft can still match the wrong operation. Replay representative captured shapes through the actual viewer engine or an isolated, explicitly synthetic test. Supply full log envelopes with verified provider/device metadata when source predicates require them; the bundled JSONL files contain message bodies, not transport envelopes. A replay does not prove physical capture or the application's real logging configuration.

Cover applicable routes with concurrent operations, nonmatching noise, missing/wrongly typed IDs, alias conflicts, errors before later IDs exist, cancellation, timeout/late evidence, missing starts and capture gaps. Verify label evolution, retained labels when values are absent, independent running/progress status, result types and sensitive masking. For repeatable phases, verify multiple updates (including decreasing values), latest accepted `equalsFrom` references, optional zero-update bypass, mandatory first occurrence, explicit concurrent identities, phase exit, timeout and terminal protection. A repeat must not extend the original deadline or start an orphan. Derive fixture formats and relationships from inspected code or captures; consistently replace secrets rather than recording real receipts or account data.

For explicit top-level `priority`, verify an integer `1` through `5` (`1` most important, default `3` when omitted). Reject strings, fractions and out-of-range values. Priority is display-only background emphasis in all three display modes, not a sort key, matcher or outcome. When testing edits, distinguish new instances using the activated revision from existing instances that retain their pinned priority.

Report each check with its command/environment, actual outcome and fixture provenance. Distinguish “format/graph valid,” “recognition replay verified,” and “captured on the target device.” If only inspection or YAML parsing was possible, say “viewer validation unavailable” and keep the unresolved draft inactive.

Also vary ingest batch boundaries without changing receipt order. Exercise stale
ordinary/repeated events after terminal outcomes and ID reuse, alias consumers before
their producers, rejected branch evidence followed by scoped errors, expired reorder
rows and deadlines without ticks. Verify sensitive error codes cannot be searched or
seen in automatic decorations, long node names remain accessible, and unsupported
post-terminal edges are not invented. Deep/large JSON may be excluded with a capture
gap under the documented analysis limits.
