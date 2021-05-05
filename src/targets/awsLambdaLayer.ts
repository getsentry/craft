import * as fs from 'fs';
import * as path from 'path';

import * as Github from '@octokit/rest';
import simpleGit from 'simple-git';
import {
  getAuthUsername,
  getGithubApiToken,
  getGithubClient,
  GithubRemote,
} from '../utils/githubApi';

import { logger as loggerRaw } from '../logger';
import { GithubGlobalConfig, TargetConfig } from '../schemas/project_config';
import { BaseTarget } from './base';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { ConfigurationError, reportError } from '../utils/errors';
import {
  AwsLambdaLayerManager,
  CompatibleRuntime,
  extractRegionNames,
  getAccountFromArn,
  getRegionsFromAws,
} from '../utils/awsLambdaLayerManager';
import { createSymlinks } from '../utils/symlink';
import { withTempDir } from '../utils/files';
import { isDryRun } from '../utils/helpers';
import { isPreviewRelease } from '../utils/version';
import { getRegistryGithubRemote } from '../utils/registry';

const logger = loggerRaw.withScope(`[aws-lambda-layer]`);

const DEFAULT_REGISTRY_REMOTE: GithubRemote = getRegistryGithubRemote();

/** Config options for the "aws-lambda-layer" target. */
interface AwsLambdaTargetConfig {
  /** AWS access key ID, set as AWS_ACCESS_KEY_ID. */
  awsAccessKeyId: string;
  /** AWS secret access key, set as `AWS_SECRET_ACCESS_KEY`. */
  awsSecretAccessKey: string;
  /** Git remote of the release registry. */
  registryRemote: GithubRemote;
  /** Should layer versions of prereleases be pushed to the registry? */
  linkPrereleases: boolean;
}

/**
 * Target responsible for uploading files to AWS Lambda.
 */
export class AwsLambdaLayerTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'aws-lambda-layer';
  /** Target options */
  public readonly awsLambdaConfig: AwsLambdaTargetConfig;
  /** GitHub client. */
  public readonly github: Github;
  /** The directory where the runtime-specific directories are. */
  private readonly AWS_REGISTRY_DIR = 'aws-lambda-layers';
  /** File containing data fields every new version file overrides  */
  private readonly BASE_FILENAME = 'base.json';

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
    githubRepo: GithubGlobalConfig
  ) {
    super(config, artifactProvider, githubRepo);
    this.github = getGithubClient();
    this.awsLambdaConfig = this.getAwsLambdaConfig();
  }

  /**
   * Extracts AWS Lambda target options from the environment.
   */
  protected getAwsLambdaConfig(): AwsLambdaTargetConfig {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new ConfigurationError(
        `Cannot publish AWS Lambda Layer: missing credentials.
        Please use AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.`
      );
    }
    return {
      awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      registryRemote: DEFAULT_REGISTRY_REMOTE,
      linkPrereleases: this.config.linkPrereleases || false,
    };
  }

  /**
   * Checks if the required project configuration parameters are available.
   * The required parameters are `layerName` and `compatibleRuntimes`.
   * There is also an optional parameter `includeNames`.
   */
  private checkProjectConfig(): void {
    const missingConfigOptions = [];
    if (!('layerName' in this.config)) {
      missingConfigOptions.push('layerName');
    }
    if (!('compatibleRuntimes' in this.config)) {
      missingConfigOptions.push('compatibleRuntimes');
    }
    if (!('license' in this.config)) {
      missingConfigOptions.push('license');
    }
    if (missingConfigOptions.length > 0) {
      throw new ConfigurationError(
        'Missing project configuration parameter(s): ' + missingConfigOptions
      );
    }
  }

  /**
   * Publishes current lambda layer zip bundle to AWS Lambda.
   * @param version New version to be released.
   * @param revision Git commit SHA to be published.
   */
  public async publish(version: string, revision: string): Promise<any> {
    this.checkProjectConfig();

    logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames:
        this.config.includeNames === undefined
          ? undefined
          : new RegExp(this.config.includeNames),
    });

    if (packageFiles.length == 0) {
      reportError('Cannot publish AWS Lambda Layer: no packages found');
      return undefined;
    } else if (packageFiles.length > 1) {
      reportError(
        'Cannot publish AWS Lambda Layer: ' +
          'multiple packages with matching patterns were found. You may want ' +
          'to include or modify the includeNames parameter in the project config'
      );
      return undefined;
    }

    const artifactBuffer = fs.readFileSync(
      await this.artifactProvider.downloadArtifact(packageFiles[0])
    );

    const awsRegions = extractRegionNames(await getRegionsFromAws());
    logger.debug('AWS regions: ' + awsRegions);

    const remote = this.awsLambdaConfig.registryRemote;
    const username = await getAuthUsername(this.github);
    remote.setAuth(username, getGithubApiToken());

    await withTempDir(
      async directory => {
        const git = simpleGit(directory);
        logger.info(`Cloning ${remote.getRemoteString()} to ${directory}...`);
        await git.clone(remote.getRemoteStringWithAuth(), directory);

        if (!isDryRun()) {
          await this.publishRuntimes(
            version,
            directory,
            awsRegions,
            artifactBuffer
          );
          logger.debug('Finished publishing runtimes.');
        } else {
          logger.info('[dry-run] Not publishing new layers.');
        }

        await git.add(['.']);
        await git.checkout('master');
        const runtimeNames = this.config.compatibleRuntimes.map(
          (runtime: CompatibleRuntime) => runtime.name
        );
        await git.commit(
          'craft(aws-lambda): AWS Lambda layers published\n\n' +
            `v${version} for ${runtimeNames}`
        );

        if (
          isPushableToRegistry(version, this.awsLambdaConfig.linkPrereleases)
        ) {
          logger.info('Pushing changes...');
          await git.push();
        }
      },
      true,
      'craft-release-awslambdalayer-'
    );
  }

  /**
   * Publishes new AWS Lambda layers for every runtime.
   * @param version The version to be published.
   * @param directory Directory to write the version files to.
   * @param awsRegions List of AWS regions to create new layers in.
   * @param artifactBuffer Buffer of the artifact to use in the AWS Lambda layers.
   */
  private async publishRuntimes(
    version: string,
    directory: string,
    awsRegions: string[],
    artifactBuffer: Buffer
  ): Promise<void> {
    await Promise.all(
      this.config.compatibleRuntimes.map(async (runtime: CompatibleRuntime) => {
        logger.debug(`Publishing runtime ${runtime.name}...`);
        const layerManager = new AwsLambdaLayerManager(
          runtime,
          this.config.layerName,
          this.config.license,
          artifactBuffer,
          awsRegions
        );

        let publishedLayers = [];
        try {
          publishedLayers = await layerManager.publishToAllRegions();
          logger.debug('Finished publishing to all regions.');
        } catch (error) {
          logger.error(
            `Did not publish layers for ${runtime.name}. ` +
              `Something went wrong with AWS: ${error.message}`
          );
          return;
        }

        // If no layers have been created, don't do extra work updating files.
        if (publishedLayers.length == 0) {
          logger.info(`${runtime.name}: no layers published.`);
          return;
        } else {
          logger.info(
            `${runtime.name}: ${publishedLayers.length} layers published.`
          );
        }

        // Base directory for the layer files of the current runtime.
        const runtimeBaseDir = path.posix.join(
          directory,
          this.AWS_REGISTRY_DIR,
          runtime.name
        );
        if (!fs.existsSync(runtimeBaseDir)) {
          logger.warn(
            `Directory structure for ${runtime.name} is missing, skipping file creation.`
          );
          return;
        }

        const regionsVersions = publishedLayers.map(layer => {
          return {
            region: layer.region,
            version: layer.version.toString(),
          };
        });

        // Common data specific to all the layers in the current runtime.
        const runtimeData = {
          canonical: layerManager.getCanonicalName(),
          sdk_version: version,
          account_number: getAccountFromArn(publishedLayers[0].arn),
          layer_name: this.config.layerName,
          regions: regionsVersions,
        };

        const baseFilepath = path.posix.join(
          runtimeBaseDir,
          this.BASE_FILENAME
        );
        const newVersionFilepath = path.posix.join(
          runtimeBaseDir,
          `${version}.json`
        );

        if (!fs.existsSync(baseFilepath)) {
          logger.warn(`The ${runtime.name} base file is missing.`);
          fs.writeFileSync(newVersionFilepath, JSON.stringify(runtimeData));
        } else {
          const baseData = JSON.parse(fs.readFileSync(baseFilepath).toString());
          fs.writeFileSync(
            newVersionFilepath,
            JSON.stringify({ ...baseData, ...runtimeData })
          );
        }

        createVersionSymlinks(runtimeBaseDir, version, newVersionFilepath);
        logger.info(`${runtime.name}: created files and updated symlinks.`);
      })
    );
  }
}

/**
 * Creates symlinks to the new version file, and updates previous ones if needed.
 * @param directory The directory where symlinks will be created.
 * @param version The new version to be released.
 * @param versionFilepath Path to the new version file.
 */
function createVersionSymlinks(
  directory: string,
  version: string,
  versionFilepath: string
): void {
  logger.debug(`Creating symlinks...`);
  const latestVersionPath = path.posix.join(directory, 'latest.json');
  if (fs.existsSync(latestVersionPath)) {
    const previousVersion = fs
      .readlinkSync(latestVersionPath)
      .split('.json')[0];
    createSymlinks(versionFilepath, version, previousVersion);
  } else {
    // When no previous versions are found, just create symlinks.
    createSymlinks(versionFilepath, version);
  }
}

/**
 * Returns whether the current version release should be pushed to the registy.
 *
 * If the dry-run mode is enabled, the release is not pusheable.
 * If the release is a preview release, unless otherwise stated in the
 * configuration, the release is not pusheable.
 * In any other case, the release is pusheable.
 *
 * @param version The new version to be released.
 * @param linkPrereleases Whether the current release is a prerelease.
 */
function isPushableToRegistry(
  version: string,
  linkPrereleases: boolean
): boolean {
  if (isDryRun()) {
    logger.info('[dry-run] Not pushing the branch.');
    return false;
  }
  if (isPreviewRelease(version) && !linkPrereleases) {
    // preview release
    logger.info("Preview release detected, not updating the layer's data.");
    return false;
  }
  return true;
}
