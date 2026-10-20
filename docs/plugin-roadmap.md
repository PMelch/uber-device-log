# Plugin architecture — design decisions and roadmap

Status: design proposal following the implemented internal capture milestone described in [providers.md](providers.md). The features below are NOT implemented yet.

## Architecture

Built-in integrations and future external adapters use the same provider/target/session contracts. Built-ins remain bundled modules, not separately installed packages. Core owns buffering, filtering, selection, pause, export, rendering and reusable panels. Providers own discovery, transports and source-specific operations. Shared ADB/iOS/WebView services avoid competing connections. Targets may represent devices, apps, pages or editor instances with explicit parent relationships; current parent mapping is described in providers.md.

Do not build an arbitrary UI plugin platform. Declare capabilities and actions; core renders consistent buttons, menus and panels. An action descriptor has a stable plugin-scoped ID, localized label/tooltip references, an approved icon, supported placement, typed intent and current availability with a localized disabled reason. No injected Vue components, HTML or executable callbacks in serialized descriptors.

Example (illustrative, not a final schema):

```json
{"id":"inspect","label":{"key":"inspection.open"},"icon":"inspect","placement":"target-actions","intent":{"kind":"inspection"},"enabled":true}
```

Server execution must revalidate target identity, availability and permissions; client capability advertisement is not authorization. Prefer discriminated action results over an unrestricted executeAnything API.

## Optional feature contracts

- Console: a separately managed session supplies execution contexts, explicit evaluation and bounded results. Opening the shared panel does not evaluate code. Preserve consent, stale-context/revision checks, cancellation, limits and origin protections. Capture works without console support.
- Android inspection: provider prepares the connection as needed and returns a typed launch result or validated inspection link. Core owns user-facing launch behavior; never execute arbitrary shell commands or unvalidated URL schemes. Define scheme/host rules for inspector links explicitly.
- iOS inspection: provider supplies structured localized steps rendered by the common guidance panel. Do not imply automatic inspector launch.
- Guidance may be reused by future engine/browser providers without platform checks in core.

## Plugin-owned localization

A plugin manifest declares its own catalogs and a mandatory defaultLocale. Catalog keys are namespaced by plugin ID, so plugins cannot overwrite core or each other. Buttons, hints, errors, accessibility labels and guidance use message references plus named parameters.

```json
{"id":"unity","i18n":{"defaultLocale":"en","messages":{"en":{"connect":"Connect to Editor"},"de":{"connect":"Mit Editor verbinden"}}}}
```

Resolve EACH key independently: selected UI locale, compatible base locale, then plugin default locale. For example de-AT -> de -> declared default. No arbitrary language fallback. Normalize locale identifiers; specify script-aware matching before supporting complex locale combinations. Partial optional catalogs are allowed; the default catalog must contain every referenced message. Validate references, locale/default availability, placeholders and message structure. Fail invalid plugin registration clearly rather than displaying undefined strings.

Core renders plain safe text, with explicitly structured links/steps rather than raw HTML. Language changes rerender references immediately; do not persist rendered translations. Plurals use the locale of the chosen message, not an unavailable requested locale. Plural message syntax/library and validation remain a design decision, not an implemented feature. Each message should include translator context and documented parameters.

Built-ins must retain all seven project locales and context metadata; external plugins may start with only a complete default catalog. Log text, identifiers and technical payloads remain verbatim. Shared core controls keep core translations.

## Future integrations: feasibility, not validation

- Unity: tail Editor.log for a low-friction baseline; an editor package using Application.logMessageReceivedThreaded can forward structured messages. Thread-safe buffering, domain reload/reconnect handling and file fallback for uncovered output require tests.
- Unreal: tail Saved/Logs; a C++ FOutputDevice adapter can preserve category/verbosity. Engine-version build compatibility is a maintenance cost.
- Godot: current stable Logger and OS.add_logger APIs support custom logging. Editor and game processes need separate capture. Establish supported minimum versions; older versions can use file/stdout capture.
- Chrome: CDP adapter can reuse WebView protocol work. Remote debugging since Chrome 136 needs a non-default user-data directory. An extension using chrome.debugger is a separate permission-heavy option.
- Firefox: WebDriver BiDi is the candidate, not a CDP clone. Deliberately started debug sessions are the baseline; arbitrary running tabs are not guaranteed.
- Safari desktop: no verified general-purpose public attach path for complete console capture. Existing iOS transport does not establish desktop support. An opt-in page SDK can forward console/error/unhandledrejection but is incomplete for browser diagnostics, workers and historical events.

Engine senders may use a versioned local protocol rather than loading arbitrary npm code into the server. External loading, authentication, loopback/origin protections, payload limits, redaction, isolation and compatibility need explicit design. In-process plugins are trusted code, not sandboxed.

## Delivery sequence

1. Complete provider discovery/warnings and HTTP target selection with saved-device migration.
2. Define and test plugin catalogs/fallback and declarative action descriptors.
3. Move existing console, Android inspection and iOS guidance behind optional feature contracts, preserving current UI/security behavior.
4. Decide richer record/export schema and byte budgets before external exposure.
5. Prove an engine/file adapter and Chrome adapter end-to-end; then evaluate other engines and Firefox. Keep Safari attach experimental until demonstrated.

Acceptance tests include missing/default translations, region fallback, parameter validation, live language switching, capability changes, stale targets, unauthorized actions, cancellation, reconnect ownership and bounded output. Physical-device and browser/engine integration checks remain necessary.

## Research references

- Unity: https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Application-logMessageReceivedThreaded.html
- Unreal: https://dev.epicgames.com/documentation/en-us/unreal-engine/logging-in-unreal-engine
- Godot: https://docs.godotengine.org/en/stable/classes/class_logger.html
- Chrome profile restrictions: https://developer.chrome.com/blog/remote-debugging-port
- Firefox protocols: https://firefox-source-docs.mozilla.org/remote/

These are research leads; no physical engine/browser integration was proven by this milestone.
