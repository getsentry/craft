import {
  any,
  array,
  boolean,
  check,
  custom,
  forward,
  integer,
  literal,
  looseObject,
  maxLength,
  minLength,
  minValue,
  number,
  object,
  optional,
  partial,
  picklist,
  pipe,
  record,
  regex,
  strictObject,
  string,
  transform,
  trim,
  union,
  unknown,
  url,
  type GenericSchema,
  type InferInput,
  type InferOutput,
} from 'valibot';
import { hasMagic } from 'glob';

/**
 * Valibot object and record schemas accept arrays and parse them as `{}`, so a
 * misconfigured block such as `versioning: []` would be silently ignored.
 * Wrap every object or record schema without required keys in this.
 */
export function nonArray<const TSchema extends GenericSchema>(schema: TSchema) {
  return pipe(
    custom<InferInput<TSchema>>(
      input => !Array.isArray(input),
      'Invalid type: Expected Object but received Array',
    ),
    schema,
  );
}

/**
 * DEPRECATED: Use changelog.policy instead. Different policies for changelog management
 */
export const enum ChangelogPolicy {
  Auto = 'auto',
  Simple = 'simple',
  None = 'none',
}

/**
 * Name of the status provider
 */
export const enum StatusProviderName {
  GitHub = 'github',
}

/**
 * Name of the artifact provider
 */
export const enum ArtifactProviderName {
  GCS = 'gcs',
  GitHub = 'github',
  None = 'none',
}

/**
 * Default versioning policy when no version argument is provided.
 * auto: analyze commits to determine bump type
 * manual: require explicit version
 * calver: use calendar versioning
 */
export const enum VersioningPolicy {
  Auto = 'auto',
  Manual = 'manual',
  CalVer = 'calver',
}

/**
 * Global (non-target!) GitHub configuration for the project
 */
export const GitHubGlobalConfigSchema = object({
  owner: string(),
  repo: string(),
  projectPath: optional(string()),
});

export type GitHubGlobalConfig = InferOutput<typeof GitHubGlobalConfigSchema>;

/**
 * Generic target configuration
 */
// Loose: allow additional properties for target-specific config
export const TargetConfigSchema = looseObject({
  name: string(),
  id: optional(string()),
  includeNames: optional(string()),
  excludeNames: optional(string()),
});

export type TargetConfig = InferOutput<typeof TargetConfigSchema>;

/**
 * Utility type for strongly-typed target configurations.
 * Combines base TargetConfig fields with target-specific fields.
 *
 * @example
 * interface BrewConfigFields {
 *   tap?: string;
 *   template: string;
 * }
 * const config = this.config as TypedTargetConfig<BrewConfigFields>;
 */
export type TypedTargetConfig<T extends Record<string, unknown>> =
  TargetConfig & T;

/**
 * Which service should be used for status checks
 */
export const BaseStatusProviderSchema = object({
  name: picklist(['github']),
  config: optional(nonArray(record(string(), any()))),
});

export type BaseStatusProvider = InferOutput<typeof BaseStatusProviderSchema>;

/**
 * Which service should be used for artifact storage
 */
export const BaseArtifactProviderSchema = object({
  name: picklist(['gcs', 'github', 'none']),
  config: optional(nonArray(record(string(), any()))),
});

export type BaseArtifactProvider = InferOutput<
  typeof BaseArtifactProviderSchema
>;

/**
 * Artifact pattern(s) for a single workflow - can be a single string or array of strings
 */
export const ArtifactPatternsSchema = union([string(), array(string())]);

/**
 * Artifacts config for GitHub artifact provider.
 * Accepts string, array of strings, or object mapping workflow names to artifact patterns.
 */
export const GitHubArtifactsConfigSchema = optional(
  union([ArtifactPatternsSchema, record(string(), ArtifactPatternsSchema)]),
);

export type GitHubArtifactsConfig = InferOutput<
  typeof GitHubArtifactsConfigSchema
>;

/**
 * GitHub-specific artifact provider configuration
 */
export const GitHubArtifactProviderConfigSchema = object({
  artifacts: GitHubArtifactsConfigSchema,
});

export type GitHubArtifactProviderConfig = InferOutput<
  typeof GitHubArtifactProviderConfigSchema
>;

/**
 * Calendar versioning configuration
 */
export const CalVerConfigSchema = object({
  /**
   * Days to go back for date calculation (default: 14)
   */
  offset: optional(number()),
  /**
   * strftime-like format for date part (default: %y.%-m).
   * Supports: %y (2-digit year), %m (zero-padded month), %-m (month without padding)
   */
  format: optional(string()),
});

export type CalVerConfig = InferOutput<typeof CalVerConfigSchema>;

/**
 * Version resolution configuration
 */
export const VersioningConfigSchema = object({
  policy: optional(picklist(['auto', 'manual', 'calver'])),
  calver: optional(nonArray(CalVerConfigSchema)),
});

export type VersioningConfig = InferOutput<typeof VersioningConfigSchema>;

export const AiSummaryEndpointSchema = pipe(
  string(),
  trim(),
  minLength(1),
  maxLength(2048),
  url(),
  check(value => {
    try {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        !url.hash &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      );
    } catch {
      return false;
    }
  }, 'AI endpoint must use HTTPS (HTTP only for loopback) without URL credentials or fragments'),
);

export const AiSummaryApiKeyEnvSchema = pipe(
  string(),
  regex(
    /^[A-Za-z_][A-Za-z0-9_]{0,127}$/,
    'Invalid AI token environment variable name',
  ),
);

/** Connection settings contain an environment variable name, never a secret. */
export const AiSummaryLlmSchema = strictObject({
  endpoint: optional(
    AiSummaryEndpointSchema,
    'https://api.githubcopilot.com/responses',
  ),
  model: optional(
    pipe(string(), trim(), minLength(1), maxLength(200)),
    'gpt-5.4-nano',
  ),
  apiKeyEnv: optional(AiSummaryApiKeyEnvSchema, 'GITHUB_TOKEN'),
});

type SummaryLevel = 'release' | 'category' | 'scope';

/** Opt-in summaries through a configured HTTP endpoint. */
export const AiSummaryConfigSchema = strictObject({
  llm: optional(nonArray(AiSummaryLlmSchema), {}),
  minItems: optional(pipe(number(), integer(), minValue(0)), 5),
  style: optional(pipe(string(), trim(), minLength(1), maxLength(500))),
  levels: optional(
    pipe(
      array(picklist(['release', 'category', 'scope'])),
      check(
        levels => new Set(levels).size === levels.length,
        'Duplicate summary levels',
      ),
      transform(levels =>
        levels.length ? levels : (['release'] as SummaryLevel[]),
      ),
    ),
    ['release'],
  ),
});

export type AiSummaryConfig = InferOutput<typeof AiSummaryConfigSchema>;

const UnownedPathsPolicySchema = picklist(['include', 'exclude', 'own']);

export type UnownedPathsPolicy = InferOutput<typeof UnownedPathsPolicySchema>;

/**
 * Changelog configuration
 */
export const ChangelogConfigSchema = union([
  string(),
  object({
    filePath: optional(string()),
    policy: optional(picklist(['auto', 'simple', 'none'])),
    scopeGrouping: optional(boolean()),
    aiSummary: optional(
      nonArray(union([AiSummaryConfigSchema, literal(false)])),
    ),
    includePaths: optional(
      array(
        pipe(
          string(),
          check(
            name =>
              name
                .split('/')
                .every(
                  segment =>
                    /^[A-Za-z0-9_.-]+$/.test(segment) &&
                    segment !== '.' &&
                    segment !== '..' &&
                    segment !== '__proto__' &&
                    !segment.startsWith('-'),
                ),
            'Changelog paths must use safe relative ASCII segments.',
          ),
        ),
      ),
    ),
    /**
     * How a workspace changelog treats files outside every workspace:
     * `include` keeps them as shared (default), `exclude` ignores them, and
     * `own` claims them for this workspace so every other workspace ignores
     * them. At most one workspace can use `own`.
     */
    unownedPaths: optional(UnownedPathsPolicySchema),
  }),
]);

/**
 * Fields that describe how a single release unit is built and published.
 *
 * These are shared between the top-level config (the implicit/default release
 * unit) and each entry under the top-level `workspaces` map (an explicit,
 * independently-versioned release unit). A workspace inherits the top-level
 * values as defaults and overrides the fields it declares.
 *
 * NOTE: this "workspace" (a named, independently-versioned release unit) is a
 * different concept from the `npm` target's `workspaces: true` field, which
 * discovers npm packages *within* a single target and publishes them all at the
 * same version. See docs for the disambiguation.
 */
const releaseUnitFields = {
  github: optional(GitHubGlobalConfigSchema),
  targets: optional(array(TargetConfigSchema)),
  preReleaseCommand: optional(string()),
  postReleaseCommand: optional(string()),
  releaseBranchPrefix: optional(string()),
  changelog: optional(nonArray(ChangelogConfigSchema)),
  changelogPolicy: optional(picklist(['auto', 'simple', 'none'])),
  requireNames: optional(array(string())),
  statusProvider: optional(BaseStatusProviderSchema),
  artifactProvider: optional(BaseArtifactProviderSchema),
  versioning: optional(nonArray(VersioningConfigSchema)),
  /**
   * Do not merge the release branch after publishing.
   * Defaults to true for compiled GitHub Actions (Node.js actions with dist/ folder).
   */
  noMerge: optional(boolean()),
} as const;

/**
 * Configuration for a single named workspace (release unit).
 *
 * A workspace mirrors the release-relevant subset of the top-level config;
 * every field is optional and inherits the top-level value when omitted. The
 * `github` block is *partial* (all fields optional) so a workspace can override
 * `owner` and/or `repo` while inheriting the rest from the top-level `github`.
 */
export const WorkspaceSchema = object({
  ...releaseUnitFields,
  github: optional(
    nonArray(
      pipe(
        partial(GitHubGlobalConfigSchema),
        check(
          github => github.projectPath === undefined,
          'Workspace github.projectPath is not supported.',
        ),
      ),
    ),
  ),
});

export type Workspace = InferOutput<typeof WorkspaceSchema>;

function isSafeWorkspaceGlobSegment(segment: string): boolean {
  if (
    segment === '' ||
    segment === '.' ||
    segment === '..' ||
    segment === '__proto__' ||
    segment.startsWith('-')
  ) {
    return false;
  }

  return isSafeWorkspaceGlobPattern(segment);
}

function isSafeWorkspaceGlobPattern(segment: string): boolean {
  if (
    segment === '' ||
    segment === '.' ||
    segment === '..' ||
    segment === '__proto__' ||
    segment.startsWith('-')
  ) {
    return false;
  }

  return hasMagic(segment, { magicalBraces: true })
    ? /^[A-Za-z0-9_.?*[\]!^-]+$/.test(segment)
    : /^[A-Za-z0-9_.-]+$/.test(segment);
}

function expandBraceAlternatives(pattern: string): string[] | undefined {
  const opening = pattern.indexOf('{');
  if (opening === -1) {
    return [pattern];
  }

  let depth = 0;
  let closing = -1;
  for (let index = opening; index < pattern.length; index++) {
    if (pattern[index] === '{') {
      depth++;
    } else if (pattern[index] === '}' && --depth === 0) {
      closing = index;
      break;
    }
  }
  if (closing === -1) {
    return undefined;
  }

  const choices = splitBraceAlternatives(pattern.slice(opening + 1, closing));
  if (!choices) {
    return undefined;
  }

  const prefix = pattern.slice(0, opening);
  const suffix = pattern.slice(closing + 1);
  const alternatives: string[] = [];
  for (const choice of choices) {
    const expanded = expandBraceAlternatives(`${prefix}${choice}${suffix}`);
    if (!expanded) {
      return undefined;
    }
    alternatives.push(...expanded);
  }
  return alternatives;
}

function isSafeWorkspaceGlob(name: string): boolean {
  const alternatives = expandBraceAlternatives(name);
  return (
    alternatives !== undefined &&
    alternatives.length > 0 &&
    alternatives.every(expanded =>
      expanded.split('/').every(isSafeWorkspaceGlobSegment),
    )
  );
}

function splitBraceAlternatives(content: string): string[] | undefined {
  const choices: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < content.length; index++) {
    if (content[index] === '{') {
      depth++;
    } else if (content[index] === '}') {
      if (depth === 0) {
        return undefined;
      }
      depth--;
    } else if (content[index] === ',' && depth === 0) {
      choices.push(content.slice(start, index));
      start = index + 1;
    }
  }
  if (depth !== 0) {
    return undefined;
  }
  choices.push(content.slice(start));
  return choices.length > 1 ? choices : undefined;
}

const WorkspaceNameSchema = pipe(
  string(),
  check(
    name => name !== '.' && name !== '..',
    'Workspace names cannot be "." or "..".',
  ),
  check(isSafeWorkspaceGlob, 'Workspace paths must use safe ASCII segments.'),
);

// Valibot records skip these keys before validating them, so they would be
// silently dropped instead of reaching WorkspaceNameSchema.
const PROTOTYPE_KEYS = ['__proto__', 'constructor', 'prototype'];

function findPrototypeKey(input: unknown): string | undefined {
  return input !== null && typeof input === 'object'
    ? PROTOTYPE_KEYS.find(key =>
        Object.prototype.hasOwnProperty.call(input, key),
      )
    : undefined;
}

const WorkspacesSchema = pipe(
  unknown(),
  check(
    input => findPrototypeKey(input) === undefined,
    issue =>
      `Workspace name "${findPrototypeKey(issue.input)}" is not supported.`,
  ),
  nonArray(record(WorkspaceNameSchema, nonArray(WorkspaceSchema))),
);

const CraftProjectConfigObjectSchema = object({
  ...releaseUnitFields,
  minVersion: optional(pipe(string(), regex(/^\d+\.\d+\.\d+.*$/))),
  /**
   * Named, independently-versioned release units within a single repository.
   *
   * When present, a release run must select one via `--workspace <name>` (or
   * `CRAFT_WORKSPACE`). The selected workspace's fields override the top-level
   * ones. When absent, craft behaves exactly as before (the top-level config is
   * the single implicit release unit) — fully backward compatible.
   */
  workspaces: optional(WorkspacesSchema),
});

type CraftProjectConfigObject = InferOutput<
  typeof CraftProjectConfigObjectSchema
>;

const hasWorkspaces = (config: CraftProjectConfigObject) =>
  Object.keys(config.workspaces || {}).length > 0;

// Path ownership only exists between release workspaces, so these settings
// would otherwise be silently ignored.
const workspaceOnlyChangelogField = (field: 'includePaths' | 'unownedPaths') =>
  forward(
    check<CraftProjectConfigObject, string>(
      config =>
        hasWorkspaces(config) ||
        typeof config.changelog !== 'object' ||
        config.changelog[field] === undefined,
      'Only release workspaces support this setting. Define "workspaces" to use it.',
    ),
    ['changelog', field],
  );

/**
 * Craft project-specific configuration
 */
export const CraftProjectConfigSchema = pipe(
  nonArray(CraftProjectConfigObjectSchema),
  forward(
    check(
      config =>
        !hasWorkspaces(config) || config.github?.projectPath === undefined,
      'Workspace configurations cannot use github.projectPath.',
    ),
    ['github', 'projectPath'],
  ),
  workspaceOnlyChangelogField('includePaths'),
  workspaceOnlyChangelogField('unownedPaths'),
);

export type CraftProjectConfig = InferOutput<typeof CraftProjectConfigSchema>;
