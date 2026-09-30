# Contributing

Start with the [technical documentation](docs/technical.md) for development setup,
architecture and capture limits. Use the [issue tracker](https://github.com/PMelch/uber-device-log/issues)
for reproducible bugs and proposed features.

## Before submitting a change

```sh
npm ci
npm test
npm run build
```

For package or CLI changes, also run `npm run test:package`. This requires npm and
Bun and checks a packed installation, both one-off launchers, and a temporary
global `udl` installation. Keep `package-lock.json` and `bun.lock` synchronized
when changing dependencies.

Every new or changed website string must include all six translations and context
for translators. Follow [the localization workflow](docs/localization.md) and
[AGENTS.md](AGENTS.md). Preserve original log content and technical values.

For UI changes, check desktop and mobile layouts, keyboard access, light/dark
styling and long translations. Use fictional logs for screenshots; README images
live in `docs/images/`. Keep user instructions in the root README and implementation
details in `docs/technical.md`.

Describe what changes for the user and how you verified it. Distinguish simulated
log tests from physical-device validation. Release instructions live in
[Publishing](docs/publishing.md).
