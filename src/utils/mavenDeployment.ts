import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

const ANDROID_DIST_EXTENSION = 'aar';
const ANDROID_RELEASE_SUBSTR = 'release';

/**
 * Uploads and releases the distributions to Maven Central.
 *
 * @param distributionsPath realtive path to the directory with distribution packages.
 * @param settingsPath relative path to Maven's settings.xml file, containing MavenCentral username and api key.
 * @param mavenRepoUrl URL to the maven repository.
 * @param mavenRepoId maven server ID in the settings.xml file.
 * @param mavenCliPath relative path to the maven CLI.
 * @param gradleCliPath relative path to the gradle CLI.
 */
export function releaseToMaven(
  distributionsPath: string,
  settingsPath: string,
  mavenRepoUrl: string,
  mavenRepoId: string,
  mavenCliPath: string, // mvnw
  gradleCliPath: string
): void {
  uploadToMaven(
    distributionsPath,
    settingsPath,
    mavenRepoUrl,
    mavenRepoId,
    mavenCliPath
  );
  closeAndRelease(gradleCliPath);
}

/**
 * Deploys to Maven Central the distribution packages.
 *
 * @param distributionsPath realtive path to the directory with distribution packages.
 * @param settingsPath relative path to Maven's settings.xml file, containing MavenCentral username and api key.
 * @param mavenRepoUrl URL to the maven repository.
 * @param mavenRepoId maven server ID in the settings.xml file.
 * @param mavenCliPath relative path to the maven CLI script.
 */
function uploadToMaven(
  distributionsPath: string,
  settingsPath: string,
  mavenRepoUrl: string,
  mavenRepoId: string,
  mavenCliPath: string
): void {
  const distributionsDirs: string[] = fs.readdirSync(distributionsPath);
  for (const distDir of distributionsDirs) {
    const moduleName = path.parse(distDir).base;
    let targetFile = getAndroidDistributionFile(distDir);
    if (!targetFile) {
      targetFile = path.join(distDir, `${moduleName}.jar`);
    }
    const javadocFile = path.join(distDir, `${moduleName}-javadoc.jar`);
    const sourcesFile = path.join(distDir, `${moduleName}-sources.jar`);
    const pomFile = path.join(distDir, 'pom-default.xml');

    exec(
      `./${mavenCliPath} gpg:sign-and-deploy-file ` +
        `-Dfile=${targetFile} ` +
        `-Dfiles=${javadocFile},${sourcesFile} ` +
        `-Dclassifiers=javadoc,sources ` +
        `-Dtypes=jar,jar ` +
        `-DpomFile=${pomFile} ` +
        `-DrepositoryId=${mavenRepoId} ` +
        `-Durl=${mavenRepoUrl} ` +
        `--settings ${settingsPath} `
    );
  }
}

/**
 * Returns the path to the first Android distribution file, if any.
 *
 * @param distributionDir directory of the distribution to check.
 * @returns path to the first Android distribution file.
 *
 */
function getAndroidDistributionFile(
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

function closeAndRelease(gradleCliPath: string): void {
  exec(`./${gradleCliPath} closeAndReleaseRepository`);
}
