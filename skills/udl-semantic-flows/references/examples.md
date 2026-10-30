# Choosing and adapting examples

These bundled files describe fictional application protocols. They are examples, not proof of the target application's log formats. Do not copy them into an active directory or alter project configuration merely because the skill is installed. First trace the actual code using [the extraction guide](authoring-guide.md), then apply the [format reference](flow-format.md) and [validation workflow](validation.md).

| Example | Useful pattern | Message fixture |
| --- | --- | --- |
| [Purchase](../assets/flows/purchase.yaml) | Primary/alias bridge, alternative store routes, receipt payload ID used later under another JSON field name, WebView completion and known errors | [General events](../assets/events/sample-events.jsonl) |
| [Login](../assets/flows/login.yaml) | Small start/terminal flow, known rejection/cancellation and missing-start evidence | [General events](../assets/events/sample-events.jsonl) |
| [Asset download](../assets/flows/asset-download.yaml) | Optional observation, expected failure code and stack evidence | [General events](../assets/events/sample-events.jsonl) |
| [Bank transaction](../assets/flows/bank-transaction.yaml) | Dynamic labels, success/error/warning/info parts, preserved running state, automatic/manual-review branches, typed results and a sensitive account value | [Bank events](../assets/events/bank-transaction-events.jsonl) |

The [configuration example](../assets/config.yaml) selects `.udl/flows` relative to the application project root. If configuration/activation is authorized, its destination is `.udl/config.yaml`; blueprint destinations are `.udl/flows/<name>.yaml`. Preserve existing project configuration and definitions. The files inside this skill's `assets/` are resources, not an automatically enabled project.

The purchase example's final balance message requires an included WebView provider. Emitting the same JSON from a native device source does not satisfy that predicate. Its submit event omits the original purchase UID and instead matches `transaction_id` against a value learned from the receipt payload. In a real application, prove that this identifier is unique enough for concurrent operations; an account ID or uncorrelated balance change is insufficient.

The bank example keeps presentation separate from recognition: `label` templates read declared accepted extractions; `result: true` exposes named output fields without changing matching or outcomes. A label saying manual review is pending does not create a terminal status. Missing label values leave the previous valid label intact. Sensitive values are concealed in both overview modes and require explicit reveal in Timeline; masking does not remove the original data from memory or raw captures.

Each JSONL line is a fictional application message body. To test capture, a test application must emit the corresponding serialized message into a selected native/WebView provider. To test the engine directly, wrap bodies in the actual viewer's `LogMessage` shape with source metadata and an explicit clock. Installing the skill or selecting a project never injects these events. Do not run real purchases, transfers or other business operations to manufacture fixture evidence without task authorization.
