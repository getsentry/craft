import { BaseTarget } from './base';
import { BrewTarget } from './brew';
import { CocoapodsTarget } from './cocoapods';
import { CratesTarget } from './crates';
import { DockerTarget } from './docker';
import { GcsTarget } from './gcs';
import { GemTarget } from './gem';
import { GhPagesTarget } from './ghPages';
import { GitHubTarget } from './github';
import { NpmTarget } from './npm';
import { NugetTarget } from './nuget';
import { SentryPypiTarget } from './sentryPypi';
import { PypiTarget } from './pypi';
import { RegistryTarget } from './registry';
import { AwsLambdaLayerTarget } from './awsLambdaLayer';
import { UpmTarget } from './upm';
import { MavenTarget } from './maven';
import { SymbolCollector } from './symbolCollector';
import { PubDevTarget } from './pubDev';

export const TARGET_MAP: { [key: string]: typeof BaseTarget } = {
  brew: BrewTarget,
  cocoapods: CocoapodsTarget,
  crates: CratesTarget,
  docker: DockerTarget,
  gcs: GcsTarget,
  gem: GemTarget,
  'gh-pages': GhPagesTarget,
  github: GitHubTarget,
  npm: NpmTarget,
  nuget: NugetTarget,
  pypi: PypiTarget,
  'sentry-pypi': SentryPypiTarget,
  registry: RegistryTarget,
  'aws-lambda-layer': AwsLambdaLayerTarget,
  upm: UpmTarget,
  maven: MavenTarget,
  'symbol-collector': SymbolCollector,
  'pub-dev': PubDevTarget,
};

/** Targets that are treated specially */
export enum SpecialTarget {
  /** This targets does not do any publishing, only related workflow actions (e.g. merging the release branch) */
  None = 'none',
  /** This target is an alias for running all configured targets */
  All = 'all',
}

/**
 * Get a list of all available targets
 *
 * @returns List of targets
 */
export function getAllTargetNames(): string[] {
  return Object.keys(TARGET_MAP);
}

/**
 * Convert target name to class object
 *
 * @param targetName Name of the target
 * @returns Corresponding target class or undefined
 */
export function getTargetByName(
  targetName: string
): typeof BaseTarget | undefined {
  return TARGET_MAP[targetName];
}
