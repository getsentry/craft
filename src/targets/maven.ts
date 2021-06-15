import { TargetConfig } from '../schemas/project_config';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { BaseTarget } from './base';
import { ConfigurationError } from '../utils/errors';
import { homedir } from 'os';
import * as path from 'path';
import { promises as fsPromises } from 'fs';
import { sleep, withRetry } from '../utils/async';
import {
  checkExecutableIsPresent,
  extractZipArchive,
  spawnProcess,
} from '../utils/system';
import { withTempDir } from '../utils/files';

const GRADLE_PROPERTIES_FILENAME = 'gradle.properties';

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

/**
 * Config options for the "maven" target.
 */
type MavenTargetConfig = {
  [key in keyof (typeof RequiredConfig & typeof OptionalConfig)]: string;
};

enum RequiredConfig {
  ossrhUsername = 'OSSRH_USERNAME',
  ossrhPassword = 'OSSRH_PASSWORD',
  mavenUsername = 'MAVEN_CENTRAL_USERNAME',
  mavenPassword = 'MAVEN_CENTRAL_PASSWORD',
}

enum OptionalConfig {
  distributionsPath = 'MAVEN_DISTRIBUTIONS_PATH',
  settingsPath = 'MAVEN_SETTINGS_PATH',
  mavenRepoUrl = 'MAVEN_REPO_URL',
  mavenRepoId = 'MAVEN_REPO_ID',
  mavenCliPath = 'MAVEN_CLI_PATH',
  gradleCliPath = 'GRADLE_CLI_PATH',
}

const DEFAULT_ENV_VARIABLES: Record<string, string> = {
  MAVEN_DISTRIBUTIONS_PATH: 'distributions/',
  MAVEN_SETTINGS_PATH: 'scripts/settings.xml',
  MAVEN_REPO_URL:
    'https://oss.sonatype.org/service/local/staging/deploy/maven2/',
  MAVEN_REPO_ID: 'ossrh',
  MAVEN_CLI_PATH: 'scripts/mvnw.cmd',
  GRADLE_CLI_PATH: 'gradlew',
};

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
    // TODO: check for config
    this.mavenConfig = this.getMavenConfig();
    this.checkRequiredSoftware();
    this.makeRegexpFromConfiguration();
  }

  private getMavenConfig(): MavenTargetConfig {
    return {
      // Required env variables
      ossrhUsername: this.getEnvVarValue(RequiredConfig.ossrhUsername),
      ossrhPassword: this.getEnvVarValue(RequiredConfig.mavenPassword),
      // TODO: MAVEN_CENTRAL_* shouldnt be required if the user already has `gradle.properties`
      mavenUsername: this.getEnvVarValue(RequiredConfig.mavenUsername),
      mavenPassword: this.getEnvVarValue(RequiredConfig.mavenPassword),
      // Optional env variables
      distributionsPath: this.getEnvVarOrDefault(
        OptionalConfig.distributionsPath
      ),
      settingsPath: this.getEnvVarOrDefault(OptionalConfig.settingsPath),
      mavenRepoUrl: this.getEnvVarOrDefault(OptionalConfig.mavenRepoUrl),
      mavenRepoId: this.getEnvVarOrDefault(OptionalConfig.mavenRepoId),
      mavenCliPath: this.getEnvVarOrDefault(OptionalConfig.mavenCliPath),
      gradleCliPath: this.getEnvVarOrDefault(OptionalConfig.gradleCliPath),
    };
  }

  private getEnvVarValue(envVar: RequiredConfig): string {
    if (process.env[envVar]) {
      return process.env[envVar] as string; // `as string` to make TS happy
    }
    throw new ConfigurationError(
      `Cannot publish to Maven Central: missing credentials.
      Please, use the ${envVar} environment variable.`
    );
  }

  private getEnvVarOrDefault(envVar: OptionalConfig): string {
    if (process.env[envVar]) {
      return process.env[envVar] as string; // `as string` to make TS happy
    }
    return DEFAULT_ENV_VARIABLES[envVar];
  }

  /**
   * Checks whether the required software to run this target is available
   * in the system. It assumes the config for this target to be available.
   */
  private checkRequiredSoftware(): void {
    this.logger.debug(
      `Checking if Maven CLI is available on ${this.mavenConfig.mavenCliPath}...`
    );
    checkExecutableIsPresent(this.mavenConfig.mavenCliPath);
    this.logger.debug(`Checking if GPG is available in the path...`);
    checkExecutableIsPresent('gpg');
  }

  private makeRegexpFromConfiguration(): void {
    // TS needs to have the `RegExp` instance here, and not /regexp/
    this.config.androidDistDirPattern = new RegExp(
      this.config.androidDistDirPattern
    );
    this.config.androidFileSearchPattern = new RegExp(
      this.config.androidFileSearchPattern
    );
  }

  public async publish(_version: string, revison: string): Promise<void> {
    await this.createUserGradlePropsFile();
    await this.upload(revison);
    await this.closeAndRelease();
  }

  private async createUserGradlePropsFile(): Promise<void> {
    // TODO: set option to use current file, instead of always overwriting it
    await fsPromises.writeFile(
      path.join(this.getGradleHomeDir(), GRADLE_PROPERTIES_FILENAME),
      // Using `` instead of string concatenation makes all the lines but the
      // first one to be indented to the right. To avoid that, these lines
      // shouldn't have that much space at the beginning, something the linter
      // doesn't agree with (and the code would be harder to read).
      `mavenCentralUsername=${this.mavenConfig.mavenUsername}\n` +
        `mavenCentralPassword=${this.mavenConfig.mavenPassword}`
    );
  }

  public getGradleHomeDir(): string {
    // See https://docs.gradle.org/current/userguide/build_environment.html#sec:gradle_environment_variables
    if (process.env.GRADLE_USER_HOME) {
      return process.env.GRADLE_USER_HOME;
    }

    return path.join(homedir(), '.gradle');
  }

  /**
   * Deploys to Maven Central the distribution packages.
   * Note that after upload, this must be `closeAndRelease`.
   */
  public async upload(revision: string): Promise<void> {
    this.logger.debug('Fetching artifact list...');
    const artifacts = await this.getArtifactsForRevision(revision);

    await withTempDir(
      async dir => {
        await Promise.all(
          artifacts.map(
            async artifact => await this.uploadArtifact(artifact, dir)
          )
        );
      },
      true,
      'craft-release-maven-'
    );
  }

  private async uploadArtifact(
    artifact: RemoteArtifact,
    dir: string
  ): Promise<void> {
    await this.extractArtifact(artifact, dir);
    const pkgName = path.basename(artifact.filename, '.zip');
    const distDir = path.join(dir, pkgName);
    await this.uploadDistribution(distDir);
  }

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
    await extractZipArchive(downloadedPkgPath, dir);
  }

  private async uploadDistribution(distDir: string): Promise<void> {
    const {
      targetFile,
      javadocFile,
      sourcesFile,
      pomFile,
    } = this.getFilesForMavenCli(distDir);

    this.retrySpawnProcess(
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
          `--settings ${this.mavenConfig.settingsPath}`,
        ]),
      'Uploading'
    );
  }

  private getFilesForMavenCli(distDir: string): Record<string, string> {
    const moduleName = path.parse(distDir).base;
    const targetFile = path.join(
      this.mavenConfig.distributionsPath,
      distDir,
      this.getTargetFilename(distDir)
    );
    const javadocFile = path.join(
      this.mavenConfig.distributionsPath,
      distDir,
      `${moduleName}-javadoc.jar`
    );
    const sourcesFile = path.join(
      this.mavenConfig.distributionsPath,
      distDir,
      `${moduleName}-sources.jar`
    );
    const pomFile = path.join(
      this.mavenConfig.distributionsPath,
      distDir,
      'pom-default.xml'
    );
    return {
      targetFile,
      javadocFile,
      sourcesFile,
      pomFile,
    };
  }

  private getTargetFilename(distDir: string): string {
    const moduleName = path.parse(distDir).base;
    const isAndroidDistDir = this.config.androidDistDirPattern.test(moduleName);
    if (isAndroidDistDir) {
      return moduleName.replace(
        this.config.androidFileSearchPattern,
        this.config.androidFileReplaceStr
      );
    }
    return `${moduleName}.jar`;
  }
  private async retrySpawnProcess(
    processFn: () => Promise<any>,
    actionName: string
  ): Promise<void> {
    let retryDelay = RETRY_DELAY_SECS;
    await withRetry(
      () => processFn(),
      MAX_PUBLISHING_ATTEMPTS,
      async err => {
        this.logger.warn(
          `${actionName} failed. Trying again in ${retryDelay}s.`
        );
        this.logger.debug(`${actionName} error: ${err}`);
        await sleep(retryDelay * 1000);
        retryDelay *= RETRY_EXP_FACTOR;
        return true;
      }
    );
  }

  /**
   * Finishes the release flow.
   */
  public async closeAndRelease(): Promise<void> {
    const gradleCliAbsPath = path.resolve(this.mavenConfig.gradleCliPath);
    const spawnProcessFn = () =>
      spawnProcess(gradleCliAbsPath, ['closeAndReleaseRepository']);
    this.retrySpawnProcess(spawnProcessFn, 'Closing and releasing');
  }
}
