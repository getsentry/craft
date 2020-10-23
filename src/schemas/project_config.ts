/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

/**
 * Craft project-specific configuration
 */
export interface CraftProjectConfig {
  github: GithubGlobalConfig;
  targets?: TargetConfig[];
  preReleaseCommand?: string;
  releaseBranchPrefix?: string;
  changelog?: string;
  changelogPolicy?: ChangelogPolicy;
  minVersion?: string;
  requireNames?: string[];
  statusProvider?: BaseStatusProvider;
  artifactProvider?: BaseArtifactProvider;
}
/**
 * Global (non-target!) GitHub configuration for the project
 */
export interface GithubGlobalConfig {
  owner: string;
  repo: string;
}
/**
 * Generic target configuration
 */
export interface TargetConfig {
  name?: string;
  id?: string;
  includeNames?: string;
  excludeNames?: string;
  [k: string]: any;
}
/**
 * Which service should be used for status checks
 */
export interface BaseStatusProvider {
  name: StatusProviderName;
  config?: {
    [k: string]: any;
  };
}
/**
 * Which service should be used for artifact storage
 */
export interface BaseArtifactProvider {
  name: ArtifactProviderName;
  config?: {
    [k: string]: any;
  };
}

/**
 * Different policies for changelog management
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
  Zeus = 'zeus',
  Github = 'github',
}
/**
 * Name of the artifact provider
 */
export const enum ArtifactProviderName {
  Zeus = 'zeus',
  GCS = 'gcs',
  Github = 'github',
  None = 'none',
}
