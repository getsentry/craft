import { z } from 'zod';

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
 * Craft project-specific configuration
 */
export const CraftProjectConfigSchema = z.object({
  github: GitHubGlobalConfigSchema.optional(),
  targets: z.array(TargetConfigSchema).optional(),
  preReleaseCommand: z.string().optional(),
  postReleaseCommand: z.string().optional(),
  releaseBranchPrefix: z.string().optional(),
  changelog: ChangelogConfigSchema.optional(),
  changelogPolicy: z.enum(['auto', 'simple', 'none']).optional(),
  minVersion: z.string().regex(/^\d+\.\d+\.\d+.*$/).optional(),
  requireNames: z.array(z.string()).optional(),
  statusProvider: BaseStatusProviderSchema.optional(),
  artifactProvider: BaseArtifactProviderSchema.optional(),
  versioning: VersioningConfigSchema.optional(),
});

export type CraftProjectConfig = z.infer<typeof CraftProjectConfigSchema>;
