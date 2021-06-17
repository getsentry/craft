import { TargetConfig } from '../schemas/project_config';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { BaseTarget } from './base';
import { homedir } from 'os';
import { basename, join, parse } from 'path';
import { promises as fsPromises } from 'fs';
import {
  checkExecutableIsPresent,
  extractZipArchive,
  spawnProcess,
  retrySpawnProcess,
} from '../utils/system';
import { withTempDir } from '../utils/files';
import { checkEnvForPrerequisite } from '../utils/env';
import { ConfigurationError } from '../utils/errors';
import { stringToRegexp } from '../utils/filters';

const GRADLE_PROPERTIES_FILENAME = 'gradle.properties';

/**
 * Default gradle user home directory. See
 * https://docs.gradle.org/current/userguide/build_environment.html#sec:gradle_environment_variables
 */
const DEFAULT_GRADLE_USER_HOME = join(homedir(), '.gradle');

/**
 * Maximum number of attempts including the initial one when publishing fails.
 * After this number of retries, publishing fails.
 */
const MAX_PUBLISHING_ATTEMPTS = 5;

/**
 * Delay between retries of publish operations, in seconds.
 */
const RETRY_DELAY_SECS = 3;

/**
 * Exponential backoff applied to the retry delay.
 */
const RETRY_EXP_FACTOR = 2;

const targetSecrets = [
  'OSSRH_USERNAME',
  'OSSRH_PASSWORD',
  'MAVEN_CENTRAL_USERNAME',
  'MAVEN_CENTRAL_PASSWORD',
] as const;
type SecretsType = typeof targetSecrets[number];

const targetOptions = [
  'gradleCliPath',
  'mavenCliPath',
  'mavenSettingsPath',
  'mavenRepoId',
  'mavenRepoUrl',
] as const;
type OptionsType = typeof targetOptions[number];

type AndroidFields = {
  android: {
    distDirRegex: string;
    fileReplaceeRegex: string;
    fileReplacerStr: string;
  };
};

type TargetSettingType = SecretsType | OptionsType;

/**
 * Config options for the "maven" target.
 */
type MavenTargetConfig = Record<TargetSettingType, string> & AndroidFields;

/**
 * Target responsible for uploading files to Maven Central.
 */
export class MavenTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'maven';
  /** Target options */
  public readonly mavenConfig: MavenTargetConfig;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    this.mavenConfig = this.getMavenConfig();
    this.checkRequiredSoftware();
    this.makeRegexpFromConfiguration();
  }

  /**
   * Returns the maven config with the required data (e.g. environment
   * variables) for this target. If there's a configuration requirement missing,
   * raises an error.
   *
   * @returns the maven config for this target.
   */
  private getMavenConfig(): MavenTargetConfig {
    return {
      ...this.getTargetSecrets(),
      ...this.getOuterTargetSettings(),
      ...this.getAndroidSettings(),
    };
  }

  private getTargetSecrets(): Record<TargetSettingType, string> {
    const secrets = targetSecrets.map(name => {
      checkEnvForPrerequisite({ name });
      return {
        name,
        value: process.env[name],
      };
    });
    return this.reduceConfig(secrets);
  }

  private reduceConfig(
    config: { name: string; value: string | undefined }[]
  ): Record<string, string> {
    return config.reduce((prev, current) => {
      return {
        ...prev,
        [current.name]: current.value,
      };
    }, {});
  }

  private getOuterTargetSettings(): Record<TargetSettingType, string> {
    const settings = targetOptions.map(setting => {
      if (!this.config[setting]) {
        throw new ConfigurationError(
          `Required configuration ${setting} not found in configuration file. ` +
            `See the documentation for more details.`
        );
      }
      return {
        name: setting,
        value: this.config[setting],
      };
    });
    return this.reduceConfig(settings);
  }

  private getAndroidSettings(): AndroidFields {
    if (
      !this.config.android.distDirRegex ||
      !this.config.android.fileReplaceeRegex ||
      !this.config.android.fileReplacerStr
    ) {
      throw new ConfigurationError(
        'Required Android configuration not found in configuration file. ' +
          'See the documentation for more details.'
      );
    }
    return {
      android: {
        distDirRegex: this.config.android.distDirRegex,
        fileReplaceeRegex: this.config.android.fileReplaceeRegex,
        fileReplacerStr: this.config.android.fileReplacerStr,
      },
    };
  }

  /**
   * Checks whether the required software to run this target is available
   * in the system. It assumes the config for this target to be available.
   * If there's required software missing, raises an error.
   */
  private checkRequiredSoftware(): void {
    this.logger.debug(
      `Checking if Maven CLI is available: ${this.mavenConfig.mavenCliPath}`
    );
    checkExecutableIsPresent(this.mavenConfig.mavenCliPath);
    this.logger.debug(
      `Checking if Gradle CLI is available on ${this.mavenConfig.gradleCliPath}...`
    );
    checkExecutableIsPresent(this.mavenConfig.gradleCliPath);
    this.logger.debug(`Checking if GPG is available in the path...`);
    checkExecutableIsPresent('gpg');
  }

  /**
   * Parses the required target's configuration variables' types from strings to
   * RegExp.
   */
  private makeRegexpFromConfiguration(): void {
    this.config.android.distDirRegex = stringToRegexp(
      this.config.android.distDirRegex
    );
    this.config.android.distDirRegex = stringToRegexp(
      this.config.android.fileReplaceeRegex
    );
  }

  /**
   * Publishes current Java and Android distributions.
   * @param version New version to be released.
   * @param revision Git commit SHA to be published.
   */
  public async publish(_version: string, revison: string): Promise<void> {
    await this.createUserGradlePropsFile();
    await this.upload(revison);
    await this.closeAndRelease();
  }

  /**
   * Creates the required user's `gradle.properties` file.
   *
   * If there's an existing one, it's overwritten.
   * TODO: control when it's overwritten with an option.
   */
  public createUserGradlePropsFile(): Promise<void> {
    return fsPromises.writeFile(
      join(this.getGradleHomeDir(), GRADLE_PROPERTIES_FILENAME),
      [
        'mavenCentralUsername=' + this.mavenConfig.MAVEN_CENTRAL_USERNAME,
        'mavenCentralPassword=' + this.mavenConfig.MAVEN_CENTRAL_PASSWORD,
      ].join('\n')
    );
  }

  /**
   * Retrieves the Gradle Home path.
   *
   * @returns the gradle home path.
   */
  public getGradleHomeDir(): string {
    if (process.env.GRADLE_USER_HOME) {
      return process.env.GRADLE_USER_HOME;
    }

    return DEFAULT_GRADLE_USER_HOME;
  }

  /**
   * Uploads the artifacts with the required files. This is a required step
   * to make a release, but this doesn't perform any releases; after upload,
   * the flow must finish with `closeAndRelease`.
   */
  public async upload(revision: string): Promise<void> {
    this.logger.debug('Fetching artifact list...');
    const artifacts = await this.getArtifactsForRevision(revision);

    await withTempDir(
      dir =>
        Promise.all(
          artifacts.map(artifact => this.uploadArtifact(artifact, dir))
        ),
      true,
      'craft-release-maven-'
    );
  }

  /**
   * Extracts and uploads all required files in the artifact.
   *
   * @param artifact the remote artifact to be uploaded.
   * @param dir directory where the artifact can be extracted.
   */
  private async uploadArtifact(
    artifact: RemoteArtifact,
    dir: string
  ): Promise<void> {
    await this.extractArtifact(artifact, dir);
    // All artifacts downloaded from GitHub are ZIP files.
    const pkgName = basename(artifact.filename, '.zip');
    const distDir = join(dir, pkgName);
    await this.uploadDistribution(distDir);
  }

  /**
   * Downloads and extracts the artifacts in the given directory.
   *
   * @param artifact the artifact to be extracted.
   * @param dir the directory to extract the artifact in.
   */
  private async extractArtifact(
    artifact: RemoteArtifact,
    dir: string
  ): Promise<void> {
    this.logger.debug(`Downloading ${artifact.filename}...`);
    const downloadedPkgPath = await this.artifactProvider.downloadArtifact(
      artifact
    );
    this.logger.debug(
      `Extracting ${artifact.filename} to ${downloadedPkgPath}...`
    );
    extractZipArchive(downloadedPkgPath, dir);
  }

  /**
   * Uploads the given distribution, including all files that are required.
   *
   * @param distDir directory of the distribution.
   */
  private async uploadDistribution(distDir: string): Promise<void> {
    const {
      targetFile,
      javadocFile,
      sourcesFile,
      pomFile,
    } = this.getFilesForMavenCli(distDir);

    // Maven central is very flaky, so retrying with an exponential delay in
    // in case it fails.
    retrySpawnProcess(
      () =>
        spawnProcess(this.mavenConfig.mavenCliPath, [
          'gpg:sign-and-deploy-file',
          `-Dfile=${targetFile}`,
          `-Dfiles=${javadocFile},${sourcesFile}`,
          `-Dclassifiers=javadoc,sources`,
          `-Dtypes=jar,jar`,
          `-DpomFile=${pomFile}`,
          `-DrepositoryId=${this.mavenConfig.mavenRepoId}`,
          `-Durl=${this.mavenConfig.mavenRepoUrl}`,
          `--settings ${this.mavenConfig.mavenSettingsPath}`,
        ]),
      'Uploading',
      MAX_PUBLISHING_ATTEMPTS,
      RETRY_DELAY_SECS,
      RETRY_EXP_FACTOR
    );
  }

  /**
   * Retrieves a record of all the required files by Maven CLI to upload
   * anything.
   *
   * @param distDir directory of the distribution.
   * @returns record of required files.
   */
  private getFilesForMavenCli(distDir: string): Record<string, string> {
    const moduleName = parse(distDir).base;
    const targetFile = join(distDir, this.getTargetFilename(distDir));
    const javadocFile = join(distDir, `${moduleName}-javadoc.jar`);
    const sourcesFile = join(distDir, `${moduleName}-sources.jar`);
    const pomFile = join(distDir, 'pom-default.xml');
    return {
      targetFile,
      javadocFile,
      sourcesFile,
      pomFile,
    };
  }

  /**
   * Retrieves the target file name for the current distribution.
   *
   * If the distibution is an Android distribution, the target file is the
   * file containing "release" in the name and the ".aar" extension.
   * Typically, the module (directory) name without the version and appending
   * "-release.aar" at the end.
   *
   * If the distribution isn't an Android distribution, the target filename is
   * the module name appending ".jar" to the end.
   *
   * @param distDir directory where distributions are.
   * @returns the target file name.
   */
  private getTargetFilename(distDir: string): string {
    const moduleName = parse(distDir).base;
    const isAndroidDistDir = this.config.android.distDirRegex.test(moduleName);
    if (isAndroidDistDir) {
      return moduleName.replace(
        this.config.android.fileReplaceeRegex,
        this.config.android.fileReplacerStr
      );
    }
    return `${moduleName}.jar`;
  }

  /**
   * Finishes the release flow, by closing and releasing to the repository.
   * Note that this is a required step to make a release, but it doesn't
   * perform any release on its own. Required files must have previously been
   * uploaded accordingly.
   */
  public async closeAndRelease(): Promise<void> {
    // Maven central is very flaky, so retrying with an exponential delay in
    // in case it fails.
    retrySpawnProcess(
      () =>
        spawnProcess(this.mavenConfig.gradleCliPath, [
          'closeAndReleaseRepository',
        ]),
      'Closing and releasing',
      MAX_PUBLISHING_ATTEMPTS,
      RETRY_DELAY_SECS,
      RETRY_EXP_FACTOR
    );
  }
}
