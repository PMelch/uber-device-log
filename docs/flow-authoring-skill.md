# Portable Flow authoring skill

[`skills/udl-semantic-flows`](../skills/udl-semantic-flows/SKILL.md) is a self-contained Agent Skills folder for deriving Semantic Flows blueprints from application code and actual emitted logs. It includes the current format reference, extraction/validation guidance, fictional YAML/event examples and the GPL-3.0-only license. Copy the whole folder; `SKILL.md` alone does not include its supporting resources.

This is one focused skill with resources, not a vendor plugin or an MCP integration. ZIP packaging is an optional transport for that same folder. After copying it, an agent can read the authoring instructions offline without access to the viewer repository. Actual validation remains optional runtime work: it needs an already-running compatible viewer or an available viewer checkout and dependencies. The bundle does not contain a standalone validator.

## Install in an application repository

Use `.agents/skills/udl-semantic-flows/` as the common project copy for Codex, supported GitHub Copilot surfaces and Gemini CLI. These discovery locations are documented by [Codex](https://learn.chatgpt.com/docs/build-skills), [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills) and [Gemini CLI](https://geminicli.com/docs/cli/skills/). Discovery and invocation remain subject to the agent's version, configuration and repository trust settings.

From the target application's repository root, copy the folder from a viewer checkout:

```sh
mkdir -p .agents/skills
cp -R /path/to/phone-log-viewer/skills/udl-semantic-flows .agents/skills/
```

On Windows, copying the folder with the file manager is sufficient. For PowerShell:

```powershell
New-Item -ItemType Directory -Force .agents/skills | Out-Null
Copy-Item -Recurse C:/path/to/phone-log-viewer/skills/udl-semantic-flows .agents/skills/
```

Read an existing installation before replacing it; preserve local changes. Commit the resulting folder when the team should share it. Installing the skill does not create `.udl/config.yaml`, activate blueprints, emit sample events or change application instrumentation.

For local Claude Code sessions, its documented project location is `.claude/skills/`; do not assume it automatically discovers `.agents/skills/`. Copy the same complete folder there as well, following the [Claude Code skill documentation](https://code.claude.com/docs/en/skills):

```sh
mkdir -p .claude/skills
cp -R .agents/skills/udl-semantic-flows .claude/skills/
```

A copy works across platforms without symlink privileges. Teams that maintain one source of truth may optionally use a relative directory symlink at `.claude/skills/udl-semantic-flows` targeting `../../.agents/skills/udl-semantic-flows`; verify that their agent and checkout tools follow it. When using two copies, update both together.

After installation, reopen the agent session or use that agent's supported skill reload/discovery controls. Ask it to use `udl-semantic-flows`; Codex supports an explicit `$udl-semantic-flows` mention, and local Claude Code exposes the installed skill as `/udl-semantic-flows`.

## Optional ZIP distribution

From the viewer checkout root, regenerate canonical resources and check the bundle before packaging:

```sh
npm run skill:sync
npm run skill:check
cd skills
zip -r /path/to/udl-semantic-flows.zip udl-semantic-flows
```

Choose an output path outside the skill folder. The archive contains the complete `udl-semantic-flows/` directory, including references, assets and `LICENSE`. Extract it and copy that folder into the appropriate skill directory above. Inspect the extracted folder before replacing an existing installation. An archive does not install the skill automatically and is not a plugin manifest.

## Other agents and manual fallback

An agent that can read Markdown can use the skill without native discovery. Ask it to read `.agents/skills/udl-semantic-flows/SKILL.md` and follow its local references. Where the project already uses `AGENTS.md`, a short task-specific pointer can help:

```markdown
When authoring Über Device Log flow blueprints, read
.agents/skills/udl-semantic-flows/SKILL.md and its relevant local references.
```

This is an explicit instruction fallback, not a guarantee that every agent reads `AGENTS.md` or automatically discovers skills. Add it only when the project owner wants that contributor workflow; it is not required to consume the folder manually.

## Use and validate

A useful request names the action, completion boundary, platform/build and available providers:

> Use udl-semantic-flows to derive a blueprint for checkout through backend confirmation. Trace the actual logging code, identify payload IDs reused by later steps, and provide a draft, evidence report and sanitized fixtures. Include branches, errors, dynamic labels and result fields where supported. Do not change logging or enable unverified definitions. Report which viewer checks were actually available.

The agent should inspect real code and logged serializers, preserve observed field names/types and distinguish business outcome from incomplete evidence. The bundled examples are fictional and inactive; choosing an example does not establish that its events occur in the application. Flow labels/results are author data, while progress state is independent of label text.

The bundle's `references/contract.json` records the source contract fingerprint used when generating its resources. Compare that contract with the actual viewer used for validation. The source checkout's package version is not a minimum supported released version: features may be unreleased. Refresh the bundle when the canonical format or examples change; report mismatches rather than silently inventing support.

Use the bundled validation reference for the local API or actual checkout validator. An HTTP 200 validation response may still contain diagnostics. A generic YAML parser cannot check graph dependencies, correlation behavior or application evidence. When no actual viewer validator is available, keep the result a clearly labelled draft and state the unperformed checks. Synthetic replay, schema validation and physical-device capture are separate claims.
