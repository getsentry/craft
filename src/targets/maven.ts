import { TargetConfig } from '../schemas/project_config';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { BaseTarget } from './base';
import { basename, extname, join, parse } from 'path';
import { promises as fsPromises } from 'fs';
import { checkExecutableIsPresent, extractZipArchive } from '../utils/system';
import { retrySpawnProcess } from '../utils/async';
import { withTempDir } from '../utils/files';
import { ConfigurationError } from '../utils/errors';
import { stringToRegexp } from '../utils/filters';
import { checkEnvForPrerequisite } from '../utils/env';
import { importGPGKey } from '../utils/gpg';

export const POM_DEFAULT_FILENAME = 'pom-default.xml';
const POM_FILE_EXT = '.xml'; // Must include the leading `.`
const BOM_FILE_KEY_REGEXP = new RegExp('<packaging>pom</packaging>');

export const targetSecrets = [
  'GPG_PASSPHRASE',
  'OSSRH_USERNAME',
  'OSSRH_PASSWORD',
] as const;
type SecretsType = typeof targetSecrets[number];

export const targetOptions = [
  'mavenCliPath',
  'mavenSettingsPath',
  'mavenRepoId',
  'mavenRepoUrl',
] as const;
type OptionsType = typeof targetOptions[number];

type AndroidFields = {
  android:
    | false
    | {
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

type PartialTargetConfig = { name: string; value: string | undefined }[];

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

    if (process.env.GPG_PRIVATE_KEY) {
      importGPGKey(process.env.GPG_PRIVATE_KEY);
    }
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

  private reduceConfig(config: PartialTargetConfig): Record<string, string> {
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
    if (this.config.android === false) {
      return {
        android: false,
      };
    }

    if (!this.config.android) {
      throw new ConfigurationError(
        'Required Android configuration was not found in the configuration file. ' +
          'See the documentation for more details'
      );
    }

    if (
      !this.config.android.distDirRegex ||
      !this.config.android.fileReplaceeRegex ||
      !this.config.android.fileReplacerStr
    ) {
      throw new ConfigurationError(
        'Required Android configuration is incorrect. See the documentation for more details.'
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
    this.logger.debug('Checking if GPG is available');
    checkExecutableIsPresent('gpg');
  }

  /**
   * Publishes current Java and Android distributions.
   * @param version New version to be released.
   * @param revision Git commit SHA to be published.
   */
  public async publish(_version: string, revison: string): Promise<void> {
    await this.upload(revison);
    await this.closeAndReleaseRepository();
  }

  /**
   * Uploads the artifacts with the required files. This is a required step
   * to make a release, but this doesn't perform any releases; after upload,
   * the flow must finish with `closeAndReleaseRepository`.
   */
  public async upload(revision: string): Promise<void> {
    const artifacts = await this.getArtifactsForRevision(revision, {
      includeNames: this.config.includeNames,
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
    const bomFile = await this.getBomFileInDist(distDir);
    if (bomFile) {
      this.logger.debug('Found BOM: ', bomFile);
      await this.uploadBomDistribution(bomFile);
    } else {
      await this.uploadPomDistribution(distDir);
    }
  }

  /**
   * Returns the path to the BOM file in the given distribution directory, and
   * `undefined` if there isn't any.
   */
  private async getBomFileInDist(distDir: string): Promise<string | undefined> {
    const pomFilepath = join(distDir, POM_DEFAULT_FILENAME);
    if (await this.isBomFile(pomFilepath)) {
      return pomFilepath;
    }

    // There may be several files in the ZIP-ed artifact with the same name,
    // where the BOM may be one of them (there may not be a BOM). Files may be
    // renamed when extracting the ZIP, so the default name (`pom-default.xml`)
    // may not match. It's assumed that any renaming keeps the same extension,
    // so all files with the same extension are checked to identify the BOM.
    // TODO: make sure all scenarios are considered and tested.
    // Each file system may handle this case differently, and attended vs
    // unattended mode also have different behaviours. It's not desired to get
    // the BOM renamed in such a way that isn't handled by the target.
    const filesInDir = await fsPromises.readdir(distDir);
    const potentialPoms = filesInDir
      .filter(f => f !== POM_DEFAULT_FILENAME && extname(f) === POM_FILE_EXT)
      .map(f => join(distDir, f));

    return potentialPoms.find(f => this.isBomFile(f));
  }

  /**
   * Returns whether the given POM is a BOM.
   *
   * A BOM file is a POM file with the following key:
   * `<packaging>pom</packaging>`, usually named as `pom-default.xml`.
   *
   * @param pomFilepath path to the POM.
   * @returns true if the POM is a BOM.
   */
  public async isBomFile(pomFilepath: string): Promise<boolean> {
    try {
      const fileContents = await fsPromises.readFile(pomFilepath, {
        encoding: 'utf8',
      });
      return BOM_FILE_KEY_REGEXP.test(fileContents);
    } catch (error) {
      this.logger.warn(
        `Could not determine if path corresponds to a BOM file: ${pomFilepath}\n` +
          'Error:\n',
        error
      );
      return false;
    }
  }

  private async uploadBomDistribution(bomFile: string): Promise<void> {
    await retrySpawnProcess(this.mavenConfig.mavenCliPath, [
      'gpg:sign-and-deploy-file',
      `-Dfile=${bomFile}`,
      `-DpomFile=${bomFile}`,
      `-DrepositoryId=${this.mavenConfig.mavenRepoId}`,
      `-Durl=${this.mavenConfig.mavenRepoUrl}`,
      `-Dgpg.passphrase=${this.mavenConfig.GPG_PASSPHRASE}`,
      '--settings',
      this.mavenConfig.mavenSettingsPath,
    ]);
  }

  private async uploadPomDistribution(distDir: string): Promise<void> {
    const {
      targetFile,
      javadocFile,
      sourcesFile,
      pomFile,
    } = this.getFilesForMavenPomDist(distDir);

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
      `-Dgpg.passphrase=${this.mavenConfig.GPG_PASSPHRASE}`,
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
  private getFilesForMavenPomDist(distDir: string): Record<string, string> {
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

    if (this.mavenConfig.android !== false) {
      const isAndroidDistDir = this.mavenConfig.android.distDirRegex.test(
        moduleName
      );
      if (isAndroidDistDir) {
        return moduleName.replace(
          this.mavenConfig.android.fileReplaceeRegex,
          this.mavenConfig.android.fileReplacerStr
        );
      }
    }

    return `${moduleName}.jar`;
  }

  // Maven central does not indicate when it completes the action, so we need to
  // retry every so often and query it for the new state of repository.
  public async closeAndReleaseRepository(): Promise<void> {
    //
  }
}
