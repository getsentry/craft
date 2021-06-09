import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

const ANDROID_DIST_EXTENSION = '.aar'; // Must include the leading `.`
const ANDROID_RELEASE_SUBSTR = 'release';

export class MavenReleaser {
  private distributionsPath: string;
  private settingsPath: string;
  private mavenRepoUrl: string;
  private mavenRepoId: string;
  private mavenCliPath: string; // mvnw
  private gradleCliPath: string;

  public constructor(
    distributionsPath: string,
    settingsPath: string,
    mavenRepoUrl: string,
    mavenRepoId: string,
    mavenCliPath: string, // mvnw
    gradleCliPath: string
  ) {
    this.distributionsPath = distributionsPath;
    this.settingsPath = settingsPath;
    this.mavenRepoUrl = mavenRepoUrl;
    this.mavenRepoId = mavenRepoId;
    this.mavenCliPath = mavenCliPath;
    this.gradleCliPath = gradleCliPath;
  }

  /**
   * Uploads and releases the distributions to Maven Central.
   */
  public release(): void {
    this.upload();
    this.closeAndRelease();
  }

  /**
   * Deploys to Maven Central the distribution packages.
   * Note that after upload, this must be `closeAndRelease`.
   */
  public upload(): void {
    const distributionsDirs: string[] = fs.readdirSync(this.distributionsPath);
    for (const distDir of distributionsDirs) {
      const moduleName = path.parse(distDir).base;
      let targetFile = this.getAndroidDistributionFile(distDir);
      if (!targetFile) {
        targetFile = path.join(distDir, `${moduleName}.jar`);
      }
      const javadocFile = path.join(distDir, `${moduleName}-javadoc.jar`);
      const sourcesFile = path.join(distDir, `${moduleName}-sources.jar`);
      const pomFile = path.join(distDir, 'pom-default.xml');

      const command = this.getMavenUploadCmd(
        targetFile,
        javadocFile,
        sourcesFile,
        pomFile
      );
      exec(command);
    }
  }

  public closeAndRelease(): void {
    exec(`./${this.gradleCliPath} closeAndReleaseRepository`);
  }

  /**
   * Returns the path to the first Android distribution file, if any.
   */
  private getAndroidDistributionFile(
    distributionDir: string
  ): string | undefined {
    const files = fs.readdirSync(distributionDir);
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
  private getMavenUploadCmd(
    targetFile: string,
    javadocFile: string,
    sourcesFile: string,
    pomFile: string
  ): string {
    return (
      `./${this.mavenCliPath} gpg:sign-and-deploy-file ` +
      `-Dfile=${targetFile} ` +
      `-Dfiles=${javadocFile},${sourcesFile} ` +
      `-Dclassifiers=javadoc,sources ` +
      `-Dtypes=jar,jar ` +
      `-DpomFile=${pomFile} ` +
      `-DrepositoryId=${this.mavenRepoId} ` +
      `-Durl=${this.mavenRepoUrl} ` +
      `--settings ${this.settingsPath} `
    );
  }
}
