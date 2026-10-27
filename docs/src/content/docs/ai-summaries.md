---
title: AI Changelog Summaries
description: Add generated release, category, and scope summaries to automatic changelogs
---

With the [`auto` changelog policy](../changelogs/#auto-mode), Craft can add
short AI-written summaries above the generated entries. Original entries are
never removed or rewritten.

## Enable summaries

Add an `aiSummary` object to enable summaries for automatic changelogs. Omit it
or use `aiSummary: false` to disable generation.

```yaml
changelog:
  policy: auto
  aiSummary:
    levels: [release] # default; choose any combination of release, category, scope
    minItems: 5 # summarize groups with more than 5 original entries
    style: Concise and friendly for developers. # optional tone guidance
```

| Setting | Default | Behavior |
| --- | --- | --- |
| `levels` | `[release]` | Select visible summaries; omitted or empty arrays use `[release]`. |
| `minItems` | `5` | Strict entry-count threshold. `0` includes every nonempty selected group. Category counts include descendants; release counts include the whole changelog. |
| `style` | Neutral | Optional writing guidance (1–500 characters), applied at every level. Facts, coverage, length and plain-text safeguards still apply. |
| `llm.endpoint` | `https://api.githubcopilot.com/responses` | Full POST URL; HTTPS required except loopback HTTP. |
| `llm.model` | `gpt-5.4-nano` | Model ID supported by the endpoint and credential. |
| `llm.apiKeyEnv` | `GITHUB_TOKEN` | Name of the environment variable containing the token. Never put the token in configuration or CLI arguments. |

For short changelogs, keep the default `levels: [release]` and `minItems: 5`
to add an overview while leaving the original entries expanded. Selecting all
levels with `minItems: 0` explicitly summarizes even one-entry groups.

## Output examples

These examples use two original entries and `minItems: 0`.

**`levels: [release]`** adds an overview and leaves originals expanded:

```markdown
CLI authentication now supports signing in and out.

### New Features
#### CLI
- Add login command
- Add logout command
```

**`levels: [category]`** adds category prose above the expanded original entries:

```markdown
### New Features

Expanded CLI authentication workflows.

#### CLI

- Add login command
- Add logout command
```

**`levels: [scope]`** summarizes each eligible scope:

```markdown
### New Features
#### CLI
Added login and logout commands.

- Add login command
- Add logout command
```

**`levels: [release, scope]`** combines an overview with scope summaries:

```markdown
CLI authentication now supports signing in and out.

### New Features
#### CLI
Added login and logout commands.

- Add login command
- Add logout command
```

**`levels: [category, scope]`** keeps both summaries visible:

```markdown
### New Features

Expanded CLI authentication workflows.

#### CLI

Added login and logout commands.

- Add login command
- Add logout command
```

Selecting all three levels also adds the release overview. Excluding `release`
omits it. Category/release summaries retain scope context; scope summaries can
omit the scope name because their heading supplies it.

## Connection settings

The CLI and Actions share the HTTP client. With an authorized Copilot token in
`GITHUB_TOKEN`, `aiSummary: {}` uses the default Luna Responses endpoint. For a
custom provider, specify its connection and token variable:

```yaml
changelog:
  policy: auto
  aiSummary:
    llm:
      endpoint: https://gateway.example.com/v1/chat/completions
      model: your-model
      apiKeyEnv: TEAM_MODEL_TOKEN
```

Per-field precedence is CLI flags (`--ai-endpoint`, `--ai-model`,
`--ai-api-key-env`), `CRAFT_AI_LLM` JSON, scalar environment overrides
(`CRAFT_AI_ENDPOINT`, `CRAFT_AI_MODEL`, `CRAFT_AI_API_KEY_ENV`), then effective
project/workspace configuration. Workspace changelog objects replace the
inherited object. Endpoints ending in `/responses` use Responses; others use
Chat Completions. Both require structured JSON output. Invalid settings are
rejected; missing tokens and provider errors retain the original output. Failure
warnings identify the generation stage and a fixed reason code, plus HTTP status
for rejected requests. Credentials, source content and provider bodies are omitted.

## How summaries are generated

Lower-level digests are reused for parent summaries even when hidden. Each
parent makes an AI synthesis call over its child digests. The release overview
is one or two short sentences covering the themes across every category, rather
than joined category summaries. Scopes explain concrete changes and options;
categories synthesize their useful outcomes in a brief sentence, even when a
category has only one scope. Category and release prose use fixed word/character
limits so already brief child digests do not force incomplete sentences. Copying
eight consecutive child words triggers a bounded repair.
Categories with explicit breaking/security source entries or migration settings
are generated in separate guidance batches. Model-inferred fact metadata alone
does not select this display role or disable compression. These guidance categories
are exempt from these compression and phrase-copy limits so migration actions,
risks and applicability conditions can stay precise. These category calls also
receive bounded original PR context for critical entries, since a child digest
can omit migration details. Context excerpts do not increase entry counts.
Recognized explicit migration settings (such as an empty-string opt-out) and
required CLI flags must survive in detailed guidance, including intermediate
reduction rounds; missing operational terms trigger the same bounded
repair/fallback. Ordinary test-setup instructions do not impose these constraints.
Release overviews still condense those categories; critical facts remain in the
internal ledger. Besides each changelog entry, the model receives the Markdown
text of its PR description (without code blocks, HTML, images or prose emoji,
capped at 1200 characters with breaking-change and migration paragraphs
prioritized) as context only; it is never rendered. Visible prose is capped at
400 characters and 35 words for the release, 600 characters and 22 words for ordinary
categories, 900 for breaking/security guidance and 1200 for each scope. Critical
guidance has extra room to preserve complete migration conditions.
The model also receives each node's character budget as planning context.
At every level, summaries without a complete sentence ending or with malformed
control text are rejected and get the same bounded repair attempt.
Invalid structured model output gets one repair attempt within the same
64-request and 120-second budgets. Transport and authentication failures do not
trigger retries or provider switching. Source-linked critical facts are carried
and validated internally without appending their text to every displayed summary.
All original entries remain expanded beneath their summaries, including links
and nested content. Craft does not add accordion wrappers; any expandable
content supplied by the original entry author is preserved. Scope summaries
need an existing scope heading; `scopeGrouping: false` still allows
category/release summaries. Unscoped entries contribute to both parent levels.

## Privacy and limits

Generation sends changelog content and critical PR titles to the chosen
provider. Breaking/security facts retain source IDs. Generated prose is escaped;
review it for accuracy. Requests are bounded to 64 calls, 3 concurrent calls,
30 seconds per request, 120 seconds total, 24,000 input bytes and 8,192 output
tokens. Any failure preserves the entire original changelog without retries or
provider switching. Existing leftover-entry limits still apply.

Dry runs, highlighted PR previews, `prepare --no-changelog` and version analysis
make zero model calls. See [AI summary authentication](../github-actions/#ai-summary-authentication)
for Action inputs, secret mapping, Copilot permissions and billing.
