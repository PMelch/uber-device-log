# Publishing uber-device-log

The package is prepared for npm; preparing or packing it does not publish it.
The package name is `uber-device-log`, CLI commands `udl` and `uber-device-log`, and the
existing repository license is Apache-2.0. The name was not found in the registry
on 29 September 2026; that is not a reservation or a guarantee of publish rights.

## Verify the release

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

The `files` allowlist includes only the CLI, compiled server/shared JavaScript,
built frontend/assets and README; npm additionally includes package.json and
LICENSE. Source tests, design previews, local configs and credentials are excluded.
The icon license is bundled with the built frontend. No source maps are shipped.
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

For the initial release (currently 0.1.0):

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
# Commit the version and both lockfiles, then:
npm publish --access public
```

npm may require browser authentication/2FA depending on the account settings.
For automated releases, configure npm trusted publishing separately; this
repository intentionally contains no token-based publish workflow.

After publishing, verify the registry version and both remote launchers:

```sh
npm view uber-device-log version
npx --yes uber-device-log@0.1.0 --help
bunx uber-device-log@0.1.0 --help
```

Substitute the released version on subsequent releases. The local tarball smoke
test proves package execution, not registry publication or account permissions.

### Minimum Node version regression check

Before publishing, also run the installed-archive smoke test on the minimum supported Node version:

```sh
npm exec --yes --package=node@22.12.0 -- npm run test:package
```

This is important for CommonJS/ESM interoperability: Node 24 can infer some named exports that Node 22.12 cannot. In particular, load `@devicefarmer/adbkit` through `createRequire`; its native ESM named `Adb` import fails on Node 22.12, and its default-export typings do not match the CommonJS exports object. A successful tsx development startup alone does not verify the published JavaScript.
