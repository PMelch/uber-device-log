# Local Flow validation API

## Local access

The server listens on `127.0.0.1`, port `4310` by default. Every request must have a
Host matching `localhost:<port>` or `127.0.0.1:<port>`. If Origin is present, it must
be `http://localhost:<port>` or `http://127.0.0.1:<port>`. Rejected requests receive
HTTP 403. There is no remote-access mode or remote authentication layer. Flow editor
mutations additionally require the local capability token described below.

## Semantic Flows

For writing YAML definitions, see the [Flow format reference](flow-format.md).

Launch with `--project=<directory>` or its alias `--flows=<directory>` to enable
a local project. `.udl/config.yaml` supports `blueprints: <relative directory>`;
an empty configuration defaults to `.udl/flows`. Files are non-recursive `.yaml` or
`.yml` definitions inside the project. Invalid startup configuration fails launch;
invalid blueprint reloads report diagnostics while keeping the last valid active
set. Without a project, Semantic Flows remains enabled and loads global loose
files and enabled bundles from the user's home. With a project, recognition combines
global and project sources. The snapshot's `context` identifies `global` or `project`;
`files` and `directory` refer to the editable loose-file scope. Create/update operations
write to the project when selected, otherwise to the global directory. Installed
bundle contents are not editable through those operations. See
[Blueprint bundles](blueprint-bundles.md) for storage and activation rules.

| Method and path | Request | Result |
| --- | --- | --- |
| `GET /api/flows/snapshot` | None | Complete `FlowSnapshot`: `enabled`, project basename, relative `directory`, active `revision`, local `token`, `blueprints`, current file sources/revisions and `diagnostics` |
| `POST /api/flows/validate` | `{ filename?, source }` | `{ diagnostics }` for the draft; does not write files |
| `POST /api/flows/reload` | JSON body, such as `{}` | Reloaded complete snapshot |
| `POST /api/flows/blueprints` | `{ filename, source }` | Exclusively create a validated blueprint and return the refreshed snapshot |
| `PUT /api/flows/blueprints/:filename` | `{ source, revision }` | Update an existing blueprint using its expected file content revision; return refreshed snapshot |

All routes send `Cache-Control: no-store`. Snapshot responses include an ETag;
the current client fetches the full snapshot on initialization and every three
seconds, and explicitly after editor changes. It displays new active definitions
only after the analysis worker acknowledges activation. An invalid reload may
therefore expose current file diagnostics while the active definitions and their
revision remain the previous valid set.

The editor POST/PUT requests listed above require `Content-Type: application/json` and
`X-Flow-Token: <snapshot.token>`. Missing capability or content type returns 403.
The token authorizes local editor operations; it is not a remote login credential.
Save returns 422 for definition validation failures and 409 for a revision conflict
or existing creation target. Other malformed inputs return 400. A draft validation
response can be HTTP 200 with nonempty diagnostics; inspect that array, rather
than treating status alone as blueprint validity. Save validates the complete
candidate file set before writing, including duplicate blueprint IDs.

Diagnostics contain stable `code: "flowsDiagnostic"`, `params: { detail }`, an
English `message` fallback, and optional relative `file`, `line`, `column` and
schema `path`. Render through the localization message API while preserving
original technical `detail` verbatim. These endpoints exchange definitions, not
captured log payloads; flow recognition and evidence retention run in the browser.

Blueprint files are limited to 256 KiB and the directory to 100 files. YAML aliases,
duplicate keys, executable/custom tags, cyclic step graphs and unsafe property
paths are rejected. Filename/path checks and bounded file reads reject symlinks;
creation is exclusive and updates use expected revisions plus atomic replacement.
See `shared/flow-blueprints.ts` for graph, matcher and extraction limits.

Files ending in `.draft.yaml` or `.draft.yml` are inactive and ignored during discovery. An invalid active YAML file still rejects activation of the new set; the last valid set remains active when available. The editor requires an active filename when saving.

For working YAML and application event examples, use
[`test_flow_project`](examples.md). See the
[agent extraction guide](authoring-guide.md) and
[validation guide](validation.md) for producing and
validating definitions against actual code and captured evidence.
