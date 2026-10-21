# Publishing uber-device-log

The package is prepared for npm; preparing or packing it does not publish it.
The package name is `uber-device-log`, CLI commands `udl` and `uber-device-log`, and the
existing repository license is Apache-2.0. The name was not found in the registry
on 29 September 2026; that is not a reservation or a guarantee of publish rights.

## Verify the release

### Prepare the changelog

Maintain [CHANGELOG.txt](../CHANGELOG.txt) throughout development. Each completed
user-visible change belongs under `Unreleased`, grouped by Added, Changed, Fixed,
Removed or Security. Before publishing:

1. Identify the previous confirmed release tag on the release branch. Review all
   commits and relevant diffs since that tag against `Unreleased`, adding missing
   changes and consolidating duplicates. Verify behavior in the code rather than
   copying commit subjects. For an initial release with no previous tag, review
   the history included in that release.
2. Check that every note describes work included in this release. Uncommitted
   work must be included in the release commit or left out of the release notes.
   Keep changes intended for a later release under `Unreleased`.
3. Move the included entries into a section named `VERSION - YYYY-MM-DD` using
   the exact package version and intended release date. Put it immediately below
   a fresh `Unreleased` section, with the newest version first. Do not invent old
   release dates or treat existing Git tags as proof of npm publication.
4. Include `CHANGELOG.txt` in the version/lockfile release commit. If publication
   is postponed, correct the date before publishing. After successful publication,
   verify the published version and ensure its `vVERSION` tag points to that
   release commit; never move an existing published release tag.

For example, after confirming the previous release really is `v0.7.0`:

```sh
PREVIOUS_RELEASE_TAG=v0.7.0
git log --reverse --format='%h %s' "$PREVIOUS_RELEASE_TAG"..HEAD
git diff --stat "$PREVIOUS_RELEASE_TAG"..HEAD
git status --short
```

Review relevant full diffs as well as this summary. The changelog is maintained
in the repository; the current npm package allowlist does not bundle it.

### Run the checks

Use Node.js 22.12+, npm 10+, and Bun for the dual-launcher smoke test:

```sh
npm ci
npm test
npm run test:package
npm pack --dry-run
```

`test:package` installs an actual local tarball in a temporary directory without
devDependencies, tests help/version, starts it through npx and bunx, installs it globally into a temporary prefix,
starts the global `udl` command from outside the project, and verifies
frontend assets, the discovery API and the Origin guard. It does not require
physical devices; device capture still needs a separate hardware check.

The application's `files` allowlist includes only the CLI, compiled server/shared
JavaScript, built frontend/assets and README; npm additionally includes package.json
and LICENSE. Application tests, design previews, local configs and credentials are
excluded. The icon license is bundled with the built frontend. Application source
maps are not shipped.

Dependencies, including `appium-ios-device`, are installed on the target host;
no dependency trees or build-host native binaries are bundled in the archive.
Keep both lockfiles synchronized with the security overrides. These overrides
protect the development checkout, not downstream installs of this package.
Appium currently pins shell-quote 1.10.0 upstream, so fresh npm/Bun installations
can still receive that vulnerable version. The package smoke test reports this
known finding explicitly; it does not claim a clean consumer security audit.
It continues to reject vulnerable source-map-js and follow-redirects copies and
checks independent npm, Bun and global npm installation/startup. See the dated dependency audit
for the bounded reachability assessment and unresolved node-forge finding.
The 2026-10-21 follow-up audit records the Vite and follow-redirects updates;
the checkout still reports node-forge and its adbkit parent as two high entries
for one unpatched advisory. A successful package smoke test does not resolve it.

`prepack` rebuilds automatically; `prepublishOnly` runs the unit/regression tests.
Do not use `--ignore-scripts` for release publishing or packing.

## Authenticate outside this repository

```sh
npm login
npm whoami
```

Let npm store login credentials in its user-level configuration, not this
repository. `.npmrc`, `.env` and `.env.*` are ignored; the package allowlist is an
additional boundary. Do not put tokens in package.json, scripts, command examples,
or committed configuration. No registry credentials are needed at runtime.

## Publish

After choosing and verifying the version in `package.json`:

```sh
npm publish --access public
```

For later releases, choose the appropriate version increment, synchronize both
lockfiles and run the verification steps again:

```sh
npm version patch --no-git-tag-version
bun install --lockfile-only
npm test
npm run test:package
npm pack --dry-run
# Finalize CHANGELOG.txt; commit it, the version and both lockfiles, then:
npm publish --access public
```

npm may require browser authentication/2FA depending on the account settings.
For automated releases, configure npm trusted publishing separately; this
repository intentionally contains no token-based publish workflow.

After publishing, verify the registry version and both remote launchers:

```sh
npm view uber-device-log version
# Set this to the version just published (example matches this checkout).
RELEASE_VERSION=0.7.0
npx --yes "uber-device-log@$RELEASE_VERSION" --help
bunx "uber-device-log@$RELEASE_VERSION" --help
```

Set `RELEASE_VERSION` to the version just published before running these POSIX-shell commands. The local tarball smoke
test proves package execution, not registry publication or account permissions.

### Minimum Node version regression check

Before publishing, also run the installed-archive smoke test on the minimum supported Node version:

```sh
npm exec --yes --package=node@22.12.0 -- npm run test:package
```

This is important for CommonJS/ESM interoperability: Node 24 can infer some named exports that Node 22.12 cannot. In particular, load `@devicefarmer/adbkit` through `createRequire`; its native ESM named `Adb` import fails on Node 22.12, and its default-export typings do not match the CommonJS exports object. A successful tsx development startup alone does not verify the published JavaScript.
