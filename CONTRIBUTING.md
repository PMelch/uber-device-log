# Contributing to Über Device Log

Contributions are welcome through the [issue tracker](https://github.com/PMelch/uber-device-log/issues)
and pull requests. For a larger feature or a change to capture/export semantics,
describe the proposed behavior in an issue before investing in a large rewrite.
The project is licensed under [Apache-2.0](LICENSE); platform icon attribution is
in [public/icons/LICENSE.md](public/icons/LICENSE.md).

## Get a working checkout

Use Node.js **22.12.0 or later** and npm. Android capture additionally needs ADB;
iOS capture needs host pairing and Apple device services. Hardware is optional for
unit tests and synthetic fixtures. No Appium server is needed.

```sh
git clone https://github.com/PMelch/uber-device-log.git
cd uber-device-log
npm ci
npm run dev
```

Open `http://127.0.0.1:4310`; stop with Ctrl+C. The frontend and API share one port.
For a different development port, use `PORT=4311 npm run dev` in a POSIX shell, or
`$env:PORT = '4311'; npm run dev` in PowerShell. No `.env` loader is configured;
set environment variables in the shell. `ADB_PATH` can select another ADB executable.
To check the production path, run `npm run build`, then `npm start -- --port 4311`.
Bun installation is optional; keep Node available when using Bun launchers.

## Find the relevant code

Read [Architecture](docs/architecture.md) for the data flow and full module map,
[API and exports](docs/api.md) for wire/schema contracts, and
[Testing](docs/testing.md) for coverage and fixture commands. Everyday usage belongs
in [README.md](README.md); implementation and maintenance details belong in `docs/`.
Historical design/research notes describe their recorded scope, not unconditional
support guarantees.

Runtime code lives in `server/`, reusable log logic and types in `shared/`, Vue
components/composables in `src/`, and the independent public site in `website/`.
Tests for all these layers live in `server/*.test.ts`. Follow the existing strict
TypeScript and Vue Composition API conventions. Backend imports use `.js` paths
for the compiled ESM output. Avoid changing the adbkit CommonJS bridge or Appium
transport internals without testing the installed package and resource cleanup.

Preserve immutable captured records, bounded queues/buffers, explicit source
identity and deterministic ordering. Pause/selection freezes the view while capture
continues; Clear affects the viewer; Save uses selected or displayed filtered
entries, including offscreen rows. Do not infer missing log metadata from adjacent
records. Add comments for non-obvious ownership, timing and protocol constraints,
rather than restating code. Update the corresponding guide when a contract changes.

## Verify a change

For each user-visible change, update `Unreleased` in [CHANGELOG.txt](CHANGELOG.txt)
in the same change. Describe the user impact under Added, Changed, Fixed, Removed
or Security; combine related work into one entry. Internal-only cleanup and minor
documentation edits do not need individual entries. Release maintainers reconcile
the notes against commits and diffs before publishing; commit messages alone are
not the changelog. See [AGENTS.md](AGENTS.md) for the project rule.

For every change:

```sh
npm test
npm run build
git diff --check
```

For behavior changes, add a regression test that fails before the fix and passes
afterward. Use focused tests while iterating, then run the full checks. For docs-only
changes, verify commands, examples, file links and behavior descriptions against
the source. Do not report hardware validation based on mocks.

Package, CLI, dependency or output-layout changes also need `npm run test:package`.
That check requires npm and Bun and uses a temporary installation. Keep
`package-lock.json` and `bun.lock` synchronized when changing dependencies. Do not
commit generated `build/`, `dist/`, `dist-debug/`, `site-dist/` or tarballs.

For UI changes, check desktop/mobile widths, keyboard navigation, focus, light/dark
appearance and long translations. Exercise error/empty/stopped states, pause,
selection and export. The [test guide](docs/testing.md) describes synthetic browser
and physical-device checks. Use fictional logs in screenshots; README images live
in `docs/images/`. For public-site changes, also run `node scripts/build-site.mjs`.

Every new or changed product string needs all seven translations and translator
context in the same change, including accessibility labels and explanations.
Follow [localization.md](docs/localization.md) and [AGENTS.md](AGENTS.md). Original
logs and technical values stay verbatim. Developer docs and CLI output stay English.

## Report bugs and submit pull requests

A useful bug report includes the app/Node version, host OS, device OS/platform,
source type (native or WebView), debugging/trust setup, reproduction steps, expected
and actual results, and relevant error text. State whether the result used a real
device or a fixture. Remove private identifiers, URLs, credentials and log content
before sharing evidence. Avoid posting exploitable security details in a public
issue; use a private reporting channel if the repository offers one.

Keep a pull request focused and explain the problem, resulting behavior, checks run,
and remaining validation gaps. Link the issue when available and include fictional
before/after screenshots for visible changes. Changes to SSE, export versions or
capture limits should include updated examples and compatibility notes. Release
maintainers can follow [Publishing](docs/publishing.md); packing does not publish.
