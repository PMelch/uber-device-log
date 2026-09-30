# Localization workflow

All user-facing website text ships in all six supported languages in the same
change. This is a completion requirement for features and fixes, not follow-up
work. The repository-wide agent instructions are in [AGENTS.md](../AGENTS.md).

## Source and context

- `src/i18n/en.ts` defines the UI keys and English source text.
- `shared/notifications.ts` defines server notification keys, parameters and English fallbacks; these are also part of the catalogs.
- `src/i18n/context.ts` is the translator brief for **every** key. It is development metadata, not displayed to users or imported into the browser bundle.
- `src/i18n/{es,de,fr,it,zh-CN}.ts` contains the other five complete translations.

Each context entry supplies `location` (where and when the text appears),
`meaning` (what the text means, the action or state it describes, and any relevant
constraints), and descriptions for every named placeholder. Describe units,
counted objects, and verbatim diagnostic data explicitly. Include grammatical
or domain ambiguity and terminology guidance when relevant.

For example, `clear` means removing retained records from the viewer, not
clearing device logs. `pause` freezes the displayed snapshot while collection
continues. `selectEntry` uses `{count}` as the row's one-based identifier, not
as the number of selected entries. These differences belong in the context,
so a translator does not have to infer them from a short button label.

## For each text change

1. Define the intended meaning and where the text appears. Add or update the key and its context together. Avoid sharing a key between unrelated uses merely because their English text happens to match.
2. Translate the complete message in all six catalogs using the context. Preserve placeholder names, but allow translators to move them. Update every locale when the meaning changes.
3. Render with the localization helpers. Use descriptors for dynamic statuses so an already-received notification changes language immediately. Keep raw data verbatim; translate explanations around that data.
4. Check counts at zero, one and many. The current noun-plus-count labels avoid plural inflection. Add locale-aware plural rules if future prose needs them; do not append an English `s` or concatenate translated fragments. Use locale-specific number formatting for UI counts.
5. Run `npm test` and `npm run build`. Review changed UI code for hard-coded product prose as well as missing accessibility translations. Catalog tests cannot detect arbitrary strings bypassing the catalogs or judge linguistic quality.
6. Check affected UI states, keyboard access and long translations at desktop and mobile sizes. Verify switching languages preserves logs, selection and capture, and updates existing notifications. Include empty/error states if changed.

Original logs, device names, technical diagnostics, timestamps, machine-readable
export fields and product/platform identifiers stay unchanged. Human-readable
interpretations, help text, future hover cards and explanatory export labels are
translated. Language-picker autonyms stay in their own language. Developer docs
and the CLI are outside the website-localization scope.

## Review completion

A text change is ready only when its six translations, context, placeholder
descriptions, tests and relevant UI verification are complete. An English fallback
is resilience for an unknown message, not a substitute for a missing translation.
