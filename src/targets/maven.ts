import { TargetConfig } from '../schemas/project_config';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { BaseTarget } from './base';
import { basename, extname, join, parse } from 'path';
import { promises as fsPromises } from 'fs';
import fetch from 'node-fetch';
import { checkExecutableIsPresent, extractZipArchive } from '../utils/system';
import { retrySpawnProcess, sleep } from '../utils/async';
import { withTempDir } from '../utils/files';
import { ConfigurationError } from '../utils/errors';
import { stringToRegexp } from '../utils/filters';
import { checkEnvForPrerequisite } from '../utils/env';
import { importGPGKey } from '../utils/gpg';

export const POM_DEFAULT_FILENAME = 'pom-default.xml';
const POM_FILE_EXT = '.xml'; // Must include the leading `.`
const BOM_FILE_KEY_REGEXP = new RegExp('<packaging>pom</packaging>');

// TODO: Make it configurable to allow for sentry-clj releases?
export const NEXUS_API_BASE_URL =
  'https://oss.sonatype.org/service/local/staging';
const NEXUS_RETRY_DELAY = 10 * 1000; // 10s
const NEXUS_RETRY_DEADLINE = 30 * 60 * 1000; // 30min

export type NexusRepository = {
  repositoryId: string;
  type: 'open' | 'closed';
  transitioning: boolean;
};

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

type KotlinMultiplatformFields = {
  kotlinMultiplatform:
  | false
  | {
    appleDistDirRegex: RegExp;
    rootDistDirRegex: RegExp;
  }
}

type TargetSettingType = SecretsType | OptionsType;

/**
 * Config options for the "maven" target.
 */
export type MavenTargetConfig = Record<TargetSettingType, string> &
  AndroidFields & KotlinMultiplatformFields;

type PartialTargetConfig = Array<{ name: string; value: string | undefined }>;

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
    const config = {
      ...this.getTargetSecrets(),
      ...this.getOuterTargetSettings(),
      ...this.getAndroidSettings(),
      ...this.getKotlinMultiplatformSettings(),
    };

    this.checkRequiredSoftware(config);

    return config;
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

  private getKotlinMultiplatformSettings(): KotlinMultiplatformFields {
    if (this.config.kotlinMultiplatform === false || !this.config.kotlinMultiplatform) {
      return {
        kotlinMultiplatform: false,
      };
    }

    if (
      !this.config.kotlinMultiplatform.rootDistDirRegex
    ) {
      throw new ConfigurationError(
        'Required root configuration for Kotlin Multiplatform is incorrect. See the documentation for more details.'
      );
    }

    if (
      !this.config.kotlinMultiplatform.appleDistDirRegex
    ) {
      throw new ConfigurationError(
        'Required apple configuration for Kotlin Multiplatform is incorrect. See the documentation for more details.'
      );
    }

    return {
      kotlinMultiplatform: {
        appleDistDirRegex: stringToRegexp(this.config.kotlinMultiplatform.appleDistDirRegex),
        rootDistDirRegex: stringToRegexp(this.config.kotlinMultiplatform.rootDistDirRegex)
      },
     }
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
  private checkRequiredSoftware(config: MavenTargetConfig): void {
    this.logger.debug(
      'Checking if Maven CLI is available: ',
      config.mavenCliPath
    );
    checkExecutableIsPresent(config.mavenCliPath);
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
    if (this.mavenConfig.kotlinMultiplatform !== false) {
      const {
        targetFile,
        javadocFile,
        sourcesFile,
        klibFiles,
        allFile,
        metadataFile,
        moduleFile,
        pomFile,
      } = await this.getFilesForKmpMavenPomDist(distDir)
      const moduleName = parse(distDir).base;
      const isRootDistDir = this.mavenConfig.kotlinMultiplatform.rootDistDirRegex.test(
        moduleName
      );
      const isAppleDistDir = this.mavenConfig.kotlinMultiplatform.appleDistDirRegex.test(
        moduleName
      );

      let sideArtifacts = `${javadocFile},${sourcesFile}`;
      let classifiers = 'javadoc,sources';
      let types = 'jar,jar';

      if (isRootDistDir) {
        sideArtifacts += `,${allFile}`;
        types += ',jar';
        classifiers += ',all';
      } else if (isAppleDistDir) {
        if (klibFiles) {
          sideArtifacts += klibFiles;
          for (let i = 0; i < klibFiles.length; i++) {
            types += ',klib';
            classifiers += ',cinterop';
          }
        }
        sideArtifacts += `,${metadataFile}`;
        types += ',jar';
        classifiers += ',metadata';
      }

      // .module files should be available in every KMP artifact
      sideArtifacts += `,${moduleFile}`;
      types += ',module';
      classifiers += ',module';

      await retrySpawnProcess(this.mavenConfig.mavenCliPath, [
        'gpg:sign-and-deploy-file',
        `-Dfile=${targetFile}`,
        `-Dfiles=${sideArtifacts}`,
        `-Dclassifiers=${classifiers}`,
        `-Dtypes=${types}`,
        `-DpomFile=${pomFile}`,
        `-DrepositoryId=${this.mavenConfig.mavenRepoId}`,
        `-Durl=${this.mavenConfig.mavenRepoUrl}`,
        `-Dgpg.passphrase=${this.mavenConfig.GPG_PASSPHRASE}`,
        `--settings`,
        `${this.mavenConfig.mavenSettingsPath}`,
      ]);
    } else {
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
  }

  /**
   * Retrieves a record of all the required files by Maven CLI to upload
   * anything.
   *
   * @param distDir directory of the distribution.
   * @returns record of required files.
   */
  private getFilesForMavenPomDist(distDir: string): Record<string, string | string[]> {
    const moduleName = parse(distDir).base;
    return {
      targetFile: join(distDir, this.getTargetFilename(distDir)),
      javadocFile: join(distDir, `${moduleName}-javadoc.jar`),
      sourcesFile: join(distDir, `${moduleName}-sources.jar`),
      pomFile: join(distDir, 'pom-default.xml'),
    };
  }

    /**
   * Retrieves a record of all the required files by Maven CLI to upload
   * Kotlin Multiplatform (KMP) artifacts.
   *
   * @param distDir directory of the distribution.
   * @returns record of required files.
   */
  private async getFilesForKmpMavenPomDist(distDir: string): Promise<Record<string, string | string[]>> {
    const files = this.getFilesForMavenPomDist(distDir)
    const moduleName = parse(distDir).base;
    if (this.mavenConfig.kotlinMultiplatform !== false) {
      const isRootDistDir = this.mavenConfig.kotlinMultiplatform.rootDistDirRegex.test(
        moduleName
      );
      const isAppleDistDir = this.mavenConfig.kotlinMultiplatform.appleDistDirRegex.test(
        moduleName
      );
      if (isRootDistDir) {
        files['allFile'] = join(distDir, `${moduleName}-all.jar`);
      } else if (isAppleDistDir) {
        files['metadataFile'] = join(distDir, `${moduleName}-metadata.jar`);
        const cinteropFiles = (await fsPromises.readdir(distDir))
          .filter(file => file.includes('cinterop'))
          .map(file => join(distDir, file));

        files['klibFiles'] = cinteropFiles;
      }
      files['moduleFile'] = join(distDir, `${moduleName}.module`);
    }
    return files;
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
    if (this.mavenConfig.kotlinMultiplatform !== false) {
      const isAppleDistDir = this.mavenConfig.kotlinMultiplatform.appleDistDirRegex.test(
        moduleName
      );
      if (isAppleDistDir) {
        return `${moduleName}.klib`
      }
    }
    return `${moduleName}.jar`;
  }

  // Maven central does not indicate when it completes the action, so we need to
  // retry every so often and query it for the new state of repository.
  // Based on: https://github.com/vanniktech/gradle-maven-publish-plugin/ implementation.
  public async closeAndReleaseRepository(): Promise<void> {
    const { repositoryId, type } = await this.getRepository();

    if (type !== 'open') {
      throw new Error(
        'No open repositories available. Go to Nexus Repository Manager to see what happened.'
      );
    }

    await this.closeRepository(repositoryId);
    await this.releaseRepository(repositoryId);
  }

  public async getRepository(): Promise<NexusRepository> {
    const response = await fetch(`${NEXUS_API_BASE_URL}/profile_repositories`, {
      headers: this.getNexusRequestHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Unable to fetch repositories: ${response.status}, ${response.statusText}`
      );
    }

    const body = await response.json();
    const repositories = body.data;

    if (repositories.length === 0) {
      throw new Error(`No available repositories. Nothing to publish.`);
    }

    if (repositories.length > 1) {
      throw new Error(
        `There are more than 1 active repositories. Please close unwanted deployments.`
      );
    }

    return repositories[0];
  }

  public async closeRepository(repositoryId: string): Promise<boolean> {
    const response = await fetch(`${NEXUS_API_BASE_URL}/bulk/close`, {
      headers: this.getNexusRequestHeaders(),
      method: 'POST',
      body: JSON.stringify({
        data: { stagedRepositoryIds: [repositoryId] },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Unable to close repository ${repositoryId}: ${response.status}, ${response.statusText}`
      );
    }

    const poolingStartTime = Date.now();

    while (true) {
      if (Date.now() - poolingStartTime > NEXUS_RETRY_DEADLINE) {
        throw new Error('Deadline for Nexus repository status change reached.');
      }

      await sleep(NEXUS_RETRY_DELAY);

      const { type, transitioning } = await this.getRepository();

      if (type === 'closed' && !transitioning) {
        this.logger.info(`Nexus repository close correctly.`);
        return true;
      }

      this.logger.info(
        `Nexus repository still not closed. Waiting for ${
          NEXUS_RETRY_DELAY / 1000
        }s to try again.`
      );
    }
  }

  public async releaseRepository(repositoryId: string): Promise<boolean> {
    const response = await fetch(`${NEXUS_API_BASE_URL}/bulk/promote`, {
      headers: this.getNexusRequestHeaders(),
      method: 'POST',
      body: JSON.stringify({
        data: { stagedRepositoryIds: [repositoryId] },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Unable to release repository ${repositoryId}: ${response.status}, ${response.statusText}`
      );
    }

    this.logger.info(`Nexus repository closed correctly.`);
    return true;
  }

  private getNexusRequestHeaders(): Record<string, string> {
    // Nexus API is using `Accept` is for `GET` requests and `Content-Type` for `POST` requests, so it needs both.
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(
        `${this.mavenConfig.OSSRH_USERNAME}:${this.mavenConfig.OSSRH_PASSWORD}`
      ).toString(`base64`)}`,
    };
  }
}
