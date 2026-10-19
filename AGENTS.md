# Project workflow

## Changelog and releases

- Maintain `CHANGELOG.txt` in English. For every completed ticket or change with
  user-visible impact, add or update a concise entry under `Unreleased` in the
  same change. Group entries under Added, Changed, Fixed, Removed or Security;
  omit empty groups. Describe resulting behavior, not implementation steps.
- Consolidate related work rather than adding an entry for every commit. Pure
  internal refactors, tests and minor documentation edits need no separate entry
  unless they affect compatibility, installation or the contributor workflow.
- Before each release, reconcile `Unreleased` with the commits and actual diffs
  since the previous confirmed release tag. Commit history is a completeness
  check, not a substitute for reviewed release notes. If there is no previous
  release tag, review the history intended for the initial release.
- Finalize the release notes with the exact version and release date in
  `YYYY-MM-DD` format, newest version first, and leave a fresh `Unreleased`
  section above them. Include the changelog in the release commit alongside the
  version and lockfile updates. Never invent historical releases or dates.
- Follow `docs/publishing.md`; do not claim publication from a local build,
  version bump or Git tag alone.

## Localization is required for every product text change

- Every new or changed user-facing website text must be localized in the same change in English, Spanish, German, French, Italian, Japanese and Simplified Chinese. This includes headings, buttons, menus, tooltips, empty states, validation, notifications, errors and accessibility labels. Do not hard-code product prose in components or concatenate translated sentence fragments.
- Use the typed catalogs in `src/i18n/` and `t()` / `uiMessage()`. Use stable notification codes and parameters for server messages displayed in the UI; keep the English fallback for unknown/older clients. Do not store a rendered translation as application state.
- Before translating, add or update the matching entry in `src/i18n/context.ts`. Each key needs its UI location, meaning/intended user action, and relevant constraints or ambiguity. Describe every placeholder, including what its number counts, its unit if any, and whether its content must remain verbatim. Read this context when translating; do not translate isolated English strings without it.
- Use distinct keys for different meanings even when English wording is identical. Reuse a key only when meaning and context match. Translate whole messages, preserve named placeholders, and account for zero, one and many without assuming English word order. Current count labels deliberately avoid singular/plural grammar; introduce locale-aware pluralization when a new sentence needs it.
- Keep original log text, device names, technical diagnostic details, identifiers, severity tokens in log records, timestamps, JSON field names, and the product name verbatim. These are data, not UI copy. Native language names in the language picker are intentional. CLI output and developer documentation remain English unless explicitly requested otherwise. New human-readable explanations of technical data are UI copy and must be translated.
- When changing the meaning of an existing key, update its context and all seven translations together. Check terminology and actual behavior, especially pause (capture continues), selection (freezes the view), clear (only empties the viewer), and save (selection or displayed filtered entries).
- Run `npm test` and `npm run build`. The catalog checks reject missing/extra keys, missing context, empty descriptions and mismatched or undocumented placeholders. They do not detect every hard-coded string: review changed templates and UI-producing code for those explicitly.
- For changes to visible text/layout, check affected states and long translations at desktop and mobile widths. Include accessibility labels, keyboard access and language switching with existing status messages. Never modify the captured logs to localize the interface.

See `docs/localization.md` for the contributor and translation checklist.


<!-- SKILLS_ACTIVATION_START -->
# Project Instructions
- Active skills: `context-hunter`, `core-cycle`, `product-development`, `tdd-protocol`.
<!-- SKILLS_ACTIVATION_END -->
