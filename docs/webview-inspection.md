# External WebView inspection

## Context and scope

The existing JavaScript console deliberately provides bounded expression results.
External inspectors add DOM, network and debugger tools for the selected WebView.
Keep both actions together in source rows and in the JavaScript console, without
changing source selection, source-row height, captured logs or console history.

Discovery follows `server/webviews.ts`, `server/console-routes.ts`,
`src/components/JavaScriptConsole.vue` and `docs/design/README.md`. This is a
cross-module change: the main risks are target identity, local debug access,
connection lifetime, asynchronous target changes and browser restrictions.

## Interaction and architecture

- Android: explicitly prepare an inspector for the selected, currently discovered
  target. Open the matching hosted Chrome DevTools frontend in a separate tab.
  Keep a copyable address available when a browser blocks the tab.
- iOS: show a compact Safari setup guide with the actual device and WebView
  identifiers. Safari's supported route is Develop → device → app/page on a Mac;
  do not invent a Safari inspection deep link.
- Keep target values as data, translated messages as catalog keys, and translate
  controls and explanations in all seven supported locales with context metadata.
- Use existing overlay/focus patterns and neutral Precision styling. Controls
  must work with keyboard, touch, long translations and both color schemes.
- The Android relay must be loopback-only, target-specific and bounded. Never
  accept an arbitrary frontend host, target path or device socket from a request.
  Close connections on failure and shutdown, and expire unused access.

## Acceptance and validation

Use injected device/tunnel fixtures to test valid targets, stale/disconnected
targets, request validation, frontend selection, relay isolation and cleanup.
Exercise browser interactions with synthetic Android/iOS targets: opening,
clipboard failure, stale requests, Escape/focus restoration, nested console use,
language changes, desktop/mobile geometry and dark mode. Run `npm test` and
`npm run build`, then obtain an independent review.

Synthetic tests cannot establish compatibility with every physical WebView or
Safari version. Record hardware and browser limitations with the final checks.
