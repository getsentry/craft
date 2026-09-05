import { z } from 'zod';
import { hasMagic } from 'glob';

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
export const GitHubGlobalConfigSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  projectPath: z.string().optional(),
});

export type GitHubGlobalConfig = z.infer<typeof GitHubGlobalConfigSchema>;

/**
 * Generic target configuration
 */
export const TargetConfigSchema = z
  .object({
    name: z.string(),
    id: z.string().optional(),
    includeNames: z.string().optional(),
    excludeNames: z.string().optional(),
  })
  .passthrough(); // Allow additional properties for target-specific config

export type TargetConfig = z.infer<typeof TargetConfigSchema>;

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
export const BaseStatusProviderSchema = z.object({
  name: z.enum(['github']),
  config: z.record(z.any()).optional(),
});

export type BaseStatusProvider = z.infer<typeof BaseStatusProviderSchema>;

/**
 * Which service should be used for artifact storage
 */
export const BaseArtifactProviderSchema = z.object({
  name: z.enum(['gcs', 'github', 'none']),
  config: z.record(z.any()).optional(),
});

export type BaseArtifactProvider = z.infer<typeof BaseArtifactProviderSchema>;

/**
 * Artifact pattern(s) for a single workflow - can be a single string or array of strings
 */
export const ArtifactPatternsSchema = z.union([
  z.string(),
  z.array(z.string()),
]);

/**
 * Artifacts config for GitHub artifact provider.
 * Accepts string, array of strings, or object mapping workflow names to artifact patterns.
 */
export const GitHubArtifactsConfigSchema = z
  .union([ArtifactPatternsSchema, z.record(z.string(), ArtifactPatternsSchema)])
  .optional();

export type GitHubArtifactsConfig = z.infer<typeof GitHubArtifactsConfigSchema>;

/**
 * GitHub-specific artifact provider configuration
 */
export const GitHubArtifactProviderConfigSchema = z.object({
  artifacts: GitHubArtifactsConfigSchema,
});

export type GitHubArtifactProviderConfig = z.infer<
  typeof GitHubArtifactProviderConfigSchema
>;

/**
 * Calendar versioning configuration
 */
export const CalVerConfigSchema = z.object({
  /**
   * Days to go back for date calculation (default: 14)
   */
  offset: z.number().optional(),
  /**
   * strftime-like format for date part (default: %y.%-m).
   * Supports: %y (2-digit year), %m (zero-padded month), %-m (month without padding)
   */
  format: z.string().optional(),
});

export type CalVerConfig = z.infer<typeof CalVerConfigSchema>;

/**
 * Version resolution configuration
 */
export const VersioningConfigSchema = z.object({
  policy: z.enum(['auto', 'manual', 'calver']).optional(),
  calver: CalVerConfigSchema.optional(),
});

export type VersioningConfig = z.infer<typeof VersioningConfigSchema>;

/**
 * Changelog configuration
 */
export const ChangelogConfigSchema = z.union([
  z.string(),
  z.object({
    filePath: z.string().optional(),
    policy: z.enum(['auto', 'simple', 'none']).optional(),
    scopeGrouping: z.boolean().optional(),
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
  github: GitHubGlobalConfigSchema.optional(),
  targets: z.array(TargetConfigSchema).optional(),
  preReleaseCommand: z.string().optional(),
  postReleaseCommand: z.string().optional(),
  releaseBranchPrefix: z.string().optional(),
  changelog: ChangelogConfigSchema.optional(),
  changelogPolicy: z.enum(['auto', 'simple', 'none']).optional(),
  requireNames: z.array(z.string()).optional(),
  statusProvider: BaseStatusProviderSchema.optional(),
  artifactProvider: BaseArtifactProviderSchema.optional(),
  versioning: VersioningConfigSchema.optional(),
  /**
   * Do not merge the release branch after publishing.
   * Defaults to true for compiled GitHub Actions (Node.js actions with dist/ folder).
   */
  noMerge: z.boolean().optional(),
} as const;

/**
 * Configuration for a single named workspace (release unit).
 *
 * A workspace mirrors the release-relevant subset of the top-level config;
 * every field is optional and inherits the top-level value when omitted. The
 * `github` block is *partial* (all fields optional) so a workspace can override
 * `owner` and/or `repo` while inheriting the rest from the top-level `github`.
 */
export const WorkspaceSchema = z.object({
  ...releaseUnitFields,
  github: GitHubGlobalConfigSchema.partial()
    .refine(github => github.projectPath === undefined, {
      message: 'Workspace github.projectPath is not supported.',
    })
    .optional(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

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

const WorkspaceNameSchema = z
  .string()
  // Assigning this key to a regular object mutates its prototype instead of
  // preserving an own workspace entry.
  .refine(name => name !== '__proto__', {
    message: 'Workspace name "__proto__" is not supported.',
  })
  .refine(name => name !== '.' && name !== '..', {
    message: 'Workspace names cannot be "." or "..".',
  })
  .refine(isSafeWorkspaceGlob, {
    message: 'Workspace paths must use safe ASCII segments.',
  });

/**
 * Craft project-specific configuration
 */
export const CraftProjectConfigSchema = z
  .object({
    ...releaseUnitFields,
    minVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+.*$/)
      .optional(),
    /**
     * Named, independently-versioned release units within a single repository.
     *
     * When present, a release run must select one via `--workspace <name>` (or
     * `CRAFT_WORKSPACE`). The selected workspace's fields override the top-level
     * ones. When absent, craft behaves exactly as before (the top-level config is
     * the single implicit release unit) — fully backward compatible.
     */
    workspaces: z.record(WorkspaceNameSchema, WorkspaceSchema).optional(),
  })
  .superRefine((config, context) => {
    if (
      Object.keys(config.workspaces || {}).length > 0 &&
      config.github?.projectPath !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Workspace configurations cannot use github.projectPath.',
        path: ['github', 'projectPath'],
      });
    }
  });

export type CraftProjectConfig = z.infer<typeof CraftProjectConfigSchema>;
