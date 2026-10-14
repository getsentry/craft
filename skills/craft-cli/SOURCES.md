# Sources and authoring decisions

- Craft src/commands, config/schema, dry-run and release tests: authoritative
  commands, workspace selection, hook execution, target and retry boundaries.
- Craft getting-started docs: standalone/npm/Homebrew installation distinctions.
- Sentry Toolkit packages/cli/src/lib/agent-skills.ts: verified upstream pattern
  for embedded files, detected .agents/.claude roots, and atomic installation.
- https://agentskills.io/specification: portable name/description/metadata format.

Added a compact workflow guide because Craft had no distributable agent skill.
Rejected a generated command encyclopedia: the installed CLI's help already
provides flag details. No upstream skill prose is copied. Should-trigger examples:
prepare a Craft release, inspect .craft.yml, publish an authorized release.
Should-not-trigger examples: inspect a Sentry issue, build a React app.
