# Global Blueprints and bundles

Semantic Flows can load definitions from the user home and, when explicitly selected, an application project. No project argument is needed to use global definitions or install a global bundle. These sources describe how to recognize captured logs; they never execute application code or initiate device capture.

## Storage and selection

| Source | Configuration | Standalone YAML directory by default | Installed bundle directory |
| --- | --- | --- | --- |
| Global | `~/.udl/config.yaml` | `~/.udl/flows/` | `~/.udl/bundles/` |
| Project | `<project>/.udl/config.yaml` | `<project>/.udl/flows/` | `<project>/.udl/bundles/` |

The existing `blueprints: <relative-directory>` setting can select a standalone directory inside its scope's root. Global paths are relative to the user's home; project paths are relative to the selected project. Existing project configuration and legacy migration remain supported. Managed directories and files must not be symlinks. A missing global directory does not prevent startup and is not created just by discovery.

With `--project <dir>` or `--flows <dir>`, both global and project definitions are available, but bundle activation is read and written **only in that project's configuration**. Without a project parameter, activation is read and written in global configuration. A project's selection does not inherit or overwrite the global selection or another project's selection.

```yaml
# Activation configuration for the current launch context.
# Existing unrelated settings/comments are preserved when a selection is saved.
bundles:
  global:
    example: true
  project:
    project-specific: false
```

A missing selection means disabled. The application also maintains `bundleRevisions` (installed-file identity/content fingerprints) and `bundleEpochs` (activation generations) in the same configuration. An enabled boolean is effective only when its saved fingerprint matches the current installed archive; manage selections through the UI/API so these fields are written together. Replacing, copying or reinstalling an archive requires enabling that installation again in each context. Activation generations ensure a browser that misses a disable/re-enable cycle still interrupts its older instances. Loose YAML definitions are enabled independently of bundle selection. A disabled bundle is installed data only: it does not create instances, advance existing ones, or contribute to active-source ID conflicts.

## Bundle format

A `.blueprint` file is a ZIP archive with this flat layout:

```text
example.blueprint
  config.yaml
  request.yaml
  completion.yml
```

Root `config.yaml` contains exactly these fields:

```yaml
id: example
name: Example operations
description: Recognizes the fictional request and completion events used by this example.
specVersion: 1
```

- `id` is the stable storage/activation identifier: 1–80 lowercase ASCII letters, digits or hyphens, starting with a letter or digit. Installation uses `<id>.blueprint`.
- `name` is a nonempty display name of at most 200 JavaScript string code units.
- `description` is required, nonempty, and at most 2,000 JavaScript string code units. Name and description are authored data shown verbatim in every UI language.
- `specVersion` is the integer Blueprint DSL specification version, currently `1`. It is neither the viewer's package version nor a bundle release number. Every contained Blueprint must validate against the implemented specification.

Every other root `.yaml`/`.yml` file is discovered automatically and must be a valid standalone [Flow Blueprint](flow-format.md). Do not list files in the manifest. At least one and at most 100 Blueprint files are required. File names follow the existing ASCII Blueprint filename rules. Extensions are lowercase. Draft files, subdirectories, extra non-YAML files, duplicate archive paths, duplicate Blueprint IDs, symlinks, encrypted entries and unsupported compression methods are rejected. ZIP stored and deflated entries are accepted; size and CRC are verified before activation. The archive is validated in memory and its paths are never extracted to disk.

Limits are 4 MiB per compressed bundle, 8 MiB expanded content per bundle, 256 KiB per YAML/manifest file, 32 installed bundle files per scope and 16 MiB of expanded bundle source content per scope. Effective recognition is bounded to 100 active Blueprints and 8 MiB of serialized active definitions. Exceeding the analysis limit disables the effective set with a diagnostic instead of passing an oversized snapshot to the worker.

A reproducible fictional [example bundle](../test_flow_project/bundles/example.blueprint) accompanies the source checkout. To package your own definition, place `config.yaml` and verified Blueprint YAML files together and ZIP those files directly (without their containing directory) into `<id>.blueprint`.

## Install from the interface

Open **Flows → Blueprint sources**. The panel lists source scope, kind, bundle description, specification version and tracked-definition count. Enter an HTTP(S) `.blueprint` URL, choose Global or Project, and select **Validate and install**. Project installation requires a launch with an explicit project directory. Installation and activation use the same application service as the CLI.

The entire download, archive, manifest and Blueprint set must validate before the final file is created. A bundle is installed disabled; enable it explicitly in the panel to start tracking. An existing installation is never overwritten. Cancellation, invalid content and failed downloads leave existing installations and selections intact. The panel's selection explanation tells you whether changes apply to this project or globally. The original bundle name and description are not translated; controls, statuses and accessible labels are localized in seven languages.

## Install from the CLI

```sh
udl install-blueprint https://example.com/example.blueprint --global
udl install-blueprint https://example.com/example.blueprint --project /path/to/application
npx uber-device-log install-blueprint https://example.com/example.blueprint --flows /path/to/application
```

Choose exactly one destination. The command exits after installation; it does not start the web server or capture devices. Success reports bundle identity, storage scope and activation guidance. Invalid requests or failed installation exit nonzero. CLI help and output remain English.

Downloads accept HTTP and HTTPS without embedded URL credentials, up to five redirects and a 30-second overall deadline. An HTTPS redirect cannot downgrade to HTTP. The response is bounded even without Content-Length; incomplete declared responses are rejected. No archive scripts or other code are run. Requests use no ambient browser credentials, and mutation APIs retain the local capability-token and origin protections.

## Conflicts, revisions and disabling

A Blueprint ID must be unique across all enabled loose definitions and bundles. There is no project override: if two enabled sources claim an ID, all definitions with that ID are excluded and diagnostics name their source/file origins. Unrelated definitions remain active. Disabled bundles do not participate in this check.

Disabling a bundle interrupts its running instances and removes both new and continuing recognition, including matching through pinned revisions or pending evidence. Existing logs and historical observations remain intact; completed outcomes are not rewritten. Re-enabling starts with future evidence and does not replay records captured while disabled. Ordinary Blueprint edits retain the existing pinned-instance behavior until a source is disabled, removed, invalidated or involved in a conflict. Invalid loose-directory reloads retain their last valid set as before; bundles are validated as a whole and invalid bundle sources are inactive.

## Validation and regression checks

- `npm test` covers archive limits, path/CRC/manifest failures, config preservation, separate home/project selections, ID conflicts, API capability protection, concurrent installs, download failure and pinned-instance interruption.
- `npm run build` checks the frontend and compiled CLI/server.
- `node --import tsx scripts/test-flow-bundles.mjs` checks the real interface, activation lifecycle, scoped installation and locale/mobile behavior using fictional local download and device sources. Use the Playwright/browser overrides documented in the browser regression guide.
- `npm run test:package` checks the distributable launchers and production dependencies.
