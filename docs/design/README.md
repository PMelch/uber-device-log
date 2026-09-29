# Precision — approved design reference

**Status:** Selected design direction for Über Device Log, 29 September 2026.

Open [precision.html](precision.html) in a browser to explore the approved design. [precision.fragment.html](precision.fragment.html) is the editable source. The preview follows the system's light/dark appearance and loads its icons from public CDNs, so internet access is needed for those assets.

## Visual direction

- Neutral silver and graphite surfaces, restrained blue accents, fine dividers and precise alignment.
- Quiet typography, generous spacing around controls, and a compact monospace log list.
- Distinct colored severity badges: purple verbose, blue debug, green info, amber warning, red error and pink fatal.
- Custom device, message-order and buffer menus; platform icons distinguish Android and iOS.
- A single workspace without a sidebar. Search and log actions sit directly above the stream.

## Behavior to preserve during implementation

- Newest messages default to the top, with a bottom option and follow-latest behavior.
- Buffer choices: 1,000, 2,000 (default), 10,000, 50,000 and 100,000.
- Full-text fuzzy search combines with selectable Android severity filters. Android selections are retained when switching devices; severity filters are disabled for the current iOS text-only collector.
- Pause freezes the visible snapshot while capture continues. Resume shows the retained messages.
- Copy and Save operate on the filtered view in its displayed order, including timestamps and available metadata. Save produces a plain-text `.log` file.
- Keep keyboard access, clear focus states, responsive controls and readable light/dark contrast.

## Reference scope

This is an interactive visual reference with sample data, not a live device connection. The production Vue interface has not yet been restyled to match it. The preview's lightweight search demonstrates the interaction; retain the application's Fuse.js implementation. Clipboard and downloads may be restricted by the exported preview's sandbox; Copy provides a manual-text fallback.

Use **Precision** as the design name in project documentation and implementation notes. This reference supersedes the earlier design explorations.
