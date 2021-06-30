import { TargetConfig } from '../schemas/project_config';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { BaseTarget } from './base';
import { homedir } from 'os';
import { basename, join, parse } from 'path';
import { promises as fsPromises } from 'fs';
import { checkExecutableIsPresent, extractZipArchive } from '../utils/system';
import { retrySpawnProcess } from '../utils/async';
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

export const targetSecrets = [
  'OSSRH_USERNAME',
  'OSSRH_PASSWORD',
  'MAVEN_CENTRAL_USERNAME',
  'MAVEN_CENTRAL_PASSWORD',
] as const;
type SecretsType = typeof targetSecrets[number];

export const targetOptions = [
  'gradleCliPath',
  'mavenCliPath',
  'mavenSettingsPath',
  'mavenRepoId',
  'mavenRepoUrl',
] as const;
type OptionsType = typeof targetOptions[number];

type AndroidFields = {
  android: {
    distDirRegex: RegExp;
    fileReplaceeRegex: RegExp;
    fileReplacerStr: string;
  };
};

type TargetSettingType = SecretsType | OptionsType;

/**
 * Config options for the "maven" target.
 */
export type MavenTargetConfig = Record<TargetSettingType, string> &
  AndroidFields;

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
        distDirRegex: stringToRegexp(this.config.android.distDirRegex),
        fileReplaceeRegex: stringToRegexp(
          this.config.android.fileReplaceeRegex
        ),
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
      'Checking if Maven CLI is available: ',
      this.mavenConfig.mavenCliPath
    );
    checkExecutableIsPresent(this.mavenConfig.mavenCliPath);
    this.logger.debug(
      'Checking if Gradle CLI is available: ',
      this.mavenConfig.gradleCliPath
    );
    checkExecutableIsPresent(this.mavenConfig.gradleCliPath);
    this.logger.debug(
      'Checking if GPG is available: ',
      this.mavenConfig.gradleCliPath
    );
    checkExecutableIsPresent('gpg');
  }

  /**
   * Publishes current Java and Android distributions.
   * @param version New version to be released.
   * @param revision Git commit SHA to be published.
   */
  public async publish(_version: string, revison: string): Promise<void> {
    await this.createUserGradlePropsFile();
    await this.upload(revison);

    // Maven central is very flaky, so retrying with an exponential delay in
    // in case it fails.
    // await retrySpawnProcess(this.mavenConfig.gradleCliPath, [
    //   'closeAndReleaseRepository',
    // ]);
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
    return process.env.GRADLE_USER_HOME || DEFAULT_GRADLE_USER_HOME;
  }

  /**
   * Uploads the artifacts with the required files. This is a required step
   * to make a release, but this doesn't perform any releases; after upload,
   * the flow must finish with `closeAndReleaseRepository`.
   */
  public async upload(revision: string): Promise<void> {
    const artifacts = await this.getArtifactsForRevision(revision, {
      includeNames:
        this.config.includeNames === undefined
          ? undefined
          : stringToRegexp(this.config.includeNames),
    });

    // We don't want to do this in parallel but in serial, because the gpg-agent
    // runs out of memory. See
    // https://github.com/sbt/sbt-pgp/issues/168
    // https://github.com/gradle/gradle/issues/12167
    for (const artifact of artifacts) {
      await this.uploadArtifact(artifact);
    }
  }

  /**
   * Extracts and uploads all required files in the artifact.
   *
   * @param artifact the remote artifact to be uploaded.
   * @param dir directory where the artifact can be extracted.
   */
  private async uploadArtifact(artifact: RemoteArtifact): Promise<void> {
    this.logger.debug('Downloading:', artifact.filename);
    const downloadedPkgPath = await this.artifactProvider.downloadArtifact(
      artifact
    );
    this.logger.debug(`Extracting ${artifact.filename}: `, downloadedPkgPath);

    await withTempDir(async dir => {
      await extractZipArchive(downloadedPkgPath, dir);
      // All artifacts downloaded from GitHub are ZIP files.
      const pkgName = basename(artifact.filename, '.zip');
      const distDir = join(dir, pkgName);
      await this.uploadDistribution(distDir);
    });
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
    await retrySpawnProcess(this.mavenConfig.mavenCliPath, [
      'gpg:sign-and-deploy-file',
      `-Dfile=${targetFile}`,
      `-Dfiles=${javadocFile},${sourcesFile}`,
      `-Dclassifiers=javadoc,sources`,
      `-Dtypes=jar,jar`,
      `-DpomFile=${pomFile}`,
      `-DrepositoryId=${this.mavenConfig.mavenRepoId}`,
      `-Durl=${this.mavenConfig.mavenRepoUrl}`,
      `--settings`,
      `${this.mavenConfig.mavenSettingsPath}`,
    ]);
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
    return {
      targetFile: join(distDir, this.getTargetFilename(distDir)),
      javadocFile: join(distDir, `${moduleName}-javadoc.jar`),
      sourcesFile: join(distDir, `${moduleName}-sources.jar`),
      pomFile: join(distDir, 'pom-default.xml'),
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

    const isAndroidDistDir = this.mavenConfig.android.distDirRegex.test(
      moduleName
    );
    return isAndroidDistDir
      ? moduleName.replace(
          this.mavenConfig.android.fileReplaceeRegex,
          this.mavenConfig.android.fileReplacerStr
        )
      : `${moduleName}.jar`;
  }
}
