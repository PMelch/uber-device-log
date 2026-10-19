# Precision — approved design reference

**Status:** Selected design direction for Über Device Log, 29 September 2026.

Open [precision.html](precision.html) in a browser to explore the approved design. [precision.fragment.html](precision.fragment.html) is the editable source. The preview follows the system's light/dark appearance and loads its icons from public CDNs, so internet access is needed for those assets.

## Visual direction

- Neutral silver and graphite surfaces, restrained blue accents, fine dividers and precise alignment.
- Quiet typography, generous spacing around controls, and a compact monospace log list.
- Distinct colored severity badges: purple verbose, blue debug, green info, amber warning, red error and pink fatal.
- Custom device, message-order and buffer menus; platform icons distinguish Android and iOS.
- The original reference uses a single workspace without a sidebar. The current app adds a device/WebView sidebar on wide screens and a compact device menu on narrow screens, with per-source filters above the combined stream.

## Behavior to preserve during implementation

- Newest messages default to the top, with a bottom option and follow-latest behavior.
- Buffer choices: 1,000, 2,000 (default), 10,000, 50,000 and 100,000.
- Full-text fuzzy search combines with selectable Android severity filters. Filters are independent per source; severity filters are disabled for native iOS syslog and available for WebView consoles on either platform.
- Pause freezes the visible snapshot while capture continues. Resume shows the retained messages.
- **Copy / Save** export whole selected log entries (including metadata and multiline stack traces) in display order. Desktop: click a row, drag for a range, Shift-click to extend, Ctrl/Cmd-click to toggle. Mobile: tap **Select**, then checkboxes; swiping always scrolls. Select a start entry, tap **Range to…**, then the end checkbox for an inclusive range. **Select all filtered** selects the current view. Selected entries are highlighted and counted. Without a selection, Copy is disabled and **Save all displayed logs** exports the filtered view. Choose **Plain text** or **Structured JSON** in the shared Copy/Save format selector. Copy has a manual-copy fallback in either format; Save downloads `.log` or `.json`.
- Message details: hover or focus an info button for a preview; click/tap toggles that entry’s card. Page/list scrolling and row selection dismiss the card, including pinned cards. Show parsed fields with cautious interpretation, Original and JSON views. Escape closes without clearing selection; use a bottom card on mobile. Never infer missing iOS metadata from adjacent records.
- Header Settings language selector: English, Spanish, German, French, Italian, Japanese and Simplified Chinese, shown with native language names. Browser-language default and locally persisted manual choice. UI text and accessibility labels switch immediately; original logs and exports retain their source content.
- Keep keyboard access, clear focus states, responsive controls and readable light/dark contrast. Localized controls must wrap on narrow screens.

## Reference scope

This is an interactive visual reference with sample data, not a live device connection. The production Vue interface now implements this design; it uses locally bundled platform icons, compatible light/dark color rules, and a viewport-sized scrolling log area instead of the preview’s fixed minimum heights. The preview's lightweight search demonstrates the interaction; retain the application's Fuse.js implementation. Clipboard and downloads may be restricted by the exported preview's sandbox; Copy provides a manual-text fallback.

Use **Precision** as the design name in project documentation and implementation notes. This reference supersedes the earlier design explorations.

## Stable reading controls

Source rows now expose their filters in a top-layer popover, with a count of active
filter groups on the trigger. On narrow screens the popover sits near the bottom
of the viewport. Opening controls never pushes the log list down. Search, severity,
Android tag/PID and iOS limitations retain their existing semantics.

The stream title, count, capture status and actions share one fixed-height command row. On narrow screens the status uses a compact dot with the full state in its accessible label and tooltip. Selection replaces the primary
action with Copy; additional actions and the shared export-format selector live in
More actions. Finishing selection clears the marks but leaves the snapshot paused.
Returning to live clears selection and displays the current retained buffer.
The paused counter counts all received records since freezing, before filtering
or retention; it is not a promise that every incoming record is still available.
Clipboard denial opens a modal manual-copy dialog instead of inserting a panel
into the list layout. Transitions use opacity, translation in overlays and color;
there is no continuous pause pulse, and reduced-motion preferences are honored.

## Feature maturity badges

Use the shared `FeatureStatusBadge.vue` component for all maturity labels. Set
feature stages once in `src/feature-status.ts`, then use that value at the feature's
entry point and panel heading. `undefined` means stable and removes both badges;
never scatter literal status labels or feature-specific badge styles in templates.

- **Alpha:** early development; behavior and compatibility may change. Amber.
- **Beta:** undergoing testing before stability. Blue.
- **Preview:** an upcoming capability available to try; design and behavior may
  change. Blue. This is not a stricter/later maturity level than Beta.
- Use a compact text badge: 10 px semibold type, 1.4 line height, 2 × 6 px
  padding, 1 px tinted border, 5 px corner radius, no icon and no animation.
  Light/dark colors live in the shared component. Never rely on color alone.
- Place it beside the feature name or entry icon, with a 6–10 px gap. Keep source
  rows at their existing height. Do not add persistent warning banners.
- Explain the status through a localized tooltip on hover and keyboard focus,
  linked with `aria-describedby`. Tooltips use the top layer to avoid clipping,
  stay inside the viewport, and dismiss on blur/pointer leave or Escape.
- A standalone badge is keyboard focusable. Inside an action, use `passive` so
  there is no nested focus target; the action forwards focus/hover to the badge's
  `show`/`hide` methods and references its `descriptionId`. Its accessible label
  uses `featureStatusLabel` with the full feature and status labels.
- Store status identifiers, never rendered translations. All labels, descriptions
  and accessibility copy belong in the seven typed catalogs with translator context.
