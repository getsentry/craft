import { TargetConfig } from '../schemas/project_config';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { BaseTarget } from './base';
import { ConfigurationError } from '../utils/errors';
import { homedir } from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { isDryRun } from '../utils/helpers';
import { withRetry } from '../utils/async';
import { checkExecutableIsPresent } from '../utils/system';

const GRADLE_PROPERTIES_FILENAME = 'gradle.properties';

const ANDROID_DIST_EXTENSION = '.aar'; // Must include the leading `.`
const ANDROID_RELEASE_SUBSTR = 'release';

/** Config options for the "maven" target. */
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

// Paths should be relative to the root of the repository
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
    this.mavenConfig = this.getMavenConfig();
    this.checkRequiredSoftware();
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
    this.logger.debug('Checking Maven CLI is available...');
    checkExecutableIsPresent(this.mavenConfig.mavenCliPath);
    this.logger.debug('Checking GPG is available...');
    checkExecutableIsPresent('gpg');
  }

  public async publish(_version: string, _revison: string): Promise<void> {
    await this.createUserGradlePropsFile();
    if (isDryRun()) {
      this.logger.info('[dry-run] Not uploading to Maven.');
      return;
    }
    await this.upload();
    this.closeAndRelease();
  }

  /**
   * Deploys to Maven Central the distribution packages.
   * Note that after upload, this must be `closeAndRelease`.
   */
  public async upload(): Promise<void> {
    const distributionsDirs = await fs.promises.readdir(
      this.mavenConfig.distributionsPath
    );
    for (const distDir of distributionsDirs) {
      const moduleName = path.parse(distDir).base;
      const androidFile = await this.getAndroidDistributionFile(distDir);
      const targetFile = androidFile
        ? androidFile
        : path.join(distDir, `${moduleName}.jar`);
      const javadocFile = path.join(distDir, `${moduleName}-javadoc.jar`);
      const sourcesFile = path.join(distDir, `${moduleName}-sources.jar`);
      const pomFile = path.join(distDir, 'pom-default.xml');

      const command = this.getMavenUploadCmd(
        targetFile,
        javadocFile,
        sourcesFile,
        pomFile
      );

      await withRetry(() => {
        exec(command, (error, _stdout, _stderr) => {
          if (error) {
            throw new Error(`Cannot upload ${distDir} to Maven:\n` + error);
          }
        });
        // Not handling an exception forces `withRetry` to try executing the
        // function again. In the very minute this point has been reached,
        // there've been no errors running the command, so there's no need to
        // return any other thing than resolving the promise.
        return Promise.resolve();
      });
    }
  }

  /**
   * Finishes the release flow.
   */
  public closeAndRelease(): void {
    withRetry(() => {
      exec(
        `./${this.mavenConfig.gradleCliPath} closeAndReleaseRepository`,
        (error, _stdout, _stderr) => {
          if (error) {
            throw new Error(`Cannot close and release to Maven:\n` + error);
          }
        }
      );
      // Not handling an exception forces `withRetry` to try executing the
      // function again. In the very minute this point has been reached,
      // there've been no errors running the command, so there's no need to
      // return any other thing than resolving the promise.
      return Promise.resolve();
    });
  }

  /**
   * Returns the path to the first Android distribution file, if any.
   */
  public async getAndroidDistributionFile(
    distributionDir: string
  ): Promise<string | undefined> {
    const files = await fs.promises.readdir(distributionDir);
    for (const filepath of files) {
      const file = path.parse(filepath);
      if (
        file.ext === ANDROID_DIST_EXTENSION &&
        file.base.includes(ANDROID_RELEASE_SUBSTR)
      ) {
        return filepath;
      }
    }
    return undefined;
  }

  /**
   * Returns the command to be executed, using the given parameters.
   */
  public getMavenUploadCmd(
    targetFile: string,
    javadocFile: string,
    sourcesFile: string,
    pomFile: string
  ): string {
    return (
      `./${this.mavenConfig.mavenCliPath} gpg:sign-and-deploy-file ` +
      `-Dfile=${targetFile} ` +
      `-Dfiles=${javadocFile},${sourcesFile} ` +
      `-Dclassifiers=javadoc,sources ` +
      `-Dtypes=jar,jar ` +
      `-DpomFile=${pomFile} ` +
      `-DrepositoryId=${this.mavenConfig.mavenRepoId} ` +
      `-Durl=${this.mavenConfig.mavenRepoUrl} ` +
      `--settings ${this.mavenConfig.settingsPath} `
    );
  }

  private async createUserGradlePropsFile(): Promise<void> {
    // TODO: set option to use current file, instead of always overwriting it
    await fs.promises.writeFile(
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
}
