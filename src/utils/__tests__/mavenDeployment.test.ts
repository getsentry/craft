import { MavenReleaser } from '../mavenDeployment';
import 'fs';
import { join } from 'path';
import 'child_process';

const directories: Record<string, string[]> = {
  android: ['androidChild'],
  androidChild: ['android-release.aar'],

  other: ['otherChild'],
  otherChild: ['otherRelease'],
};

jest.mock('fs', () => ({
  readdirSync: (parentDir: string) => directories[parentDir],
}));

jest.mock('child_process', () => ({
  exec: () => {
    /** do nothing */
  },
}));

describe('release to Maven', () => {
  test('release flow', () => {
    const releaser = new MavenReleaser('', '', '', '', '', '');
    releaser.upload = jest.fn();
    releaser.closeAndRelease = jest.fn();
    releaser.release();

    expect(releaser.upload).toHaveBeenCalledTimes(1);
    expect(releaser.closeAndRelease).toHaveBeenCalledTimes(1);
  });
});

describe('upload to Maven', () => {
  function getFileParameters(
    distDir: string,
    moduleName: string
  ): Record<string, string> {
    return {
      javadocFile: join(distDir, `${moduleName}-javadoc.jar`),
      sourcesFile: join(distDir, `${moduleName}-sources.jar`),
      pomFile: join(distDir, 'pom-default.xml'),
    };
  }

  test("when it's an Android distribution", () => {
    const parentDir = 'android';
    const distDir = directories[parentDir][0];
    const androidTestFile = directories[distDir][0];
    const { javadocFile, sourcesFile, pomFile } = getFileParameters(
      distDir,
      distDir
    );

    const releaser = new MavenReleaser(parentDir, '', '', '', '', '');
    const mavenUploadCmdSpy = jest.spyOn(releaser, 'getMavenUploadCmd');
    const androidDisSpy = jest.spyOn(releaser, 'getAndroidDistributionFile');
    releaser.upload();

    expect(androidDisSpy).toHaveBeenCalledTimes(1);
    expect(mavenUploadCmdSpy).toHaveBeenCalledTimes(1);
    expect(mavenUploadCmdSpy).toHaveBeenCalledWith(
      androidTestFile,
      javadocFile,
      sourcesFile,
      pomFile
    );
  });

  test("when it's not an Android distribution", () => {
    const parentDir = 'other';
    const distDir = directories[parentDir][0];
    const nonAndroidTestFile = join(distDir, `${distDir}.jar`);
    const { javadocFile, sourcesFile, pomFile } = getFileParameters(
      distDir,
      distDir
    );

    const releaser = new MavenReleaser(parentDir, '', '', '', '', '');
    const mavenUploadCmdSpy = jest.spyOn(releaser, 'getMavenUploadCmd');
    const androidDisSpy = jest.spyOn(releaser, 'getAndroidDistributionFile');
    releaser.upload();

    expect(androidDisSpy).toHaveBeenCalledTimes(1);
    expect(mavenUploadCmdSpy).toHaveBeenCalledTimes(1);
    expect(mavenUploadCmdSpy).toHaveBeenCalledWith(
      nonAndroidTestFile,
      javadocFile,
      sourcesFile,
      pomFile
    );
  });
});

describe('get Android distribution file', () => {
  test('when exists', () => {
    const parentDirectory = 'android';
    const expectedChildDirectory = directories[parentDirectory][0];
    const expectedAndroidFile = directories[expectedChildDirectory][0];

    const releaser = new MavenReleaser(parentDirectory, '', '', '', '', '');
    const androidDisSpy = jest.spyOn(releaser, 'getAndroidDistributionFile');
    releaser.upload();

    expect(androidDisSpy).toHaveBeenCalledTimes(1);
    expect(androidDisSpy).toHaveBeenCalledWith(expectedChildDirectory);
    expect(androidDisSpy).toHaveReturnedWith(expectedAndroidFile);

    jest.resetAllMocks();
  });

  test("when it doesn't exist", () => {
    const parentDirectory = 'other';
    const expectedChildDirectory = directories[parentDirectory][0];

    const releaser = new MavenReleaser(parentDirectory, '', '', '', '', '');
    const androidDisSpy = jest.spyOn(releaser, 'getAndroidDistributionFile');
    releaser.upload();

    expect(androidDisSpy).toHaveBeenCalledTimes(1);
    expect(androidDisSpy).toHaveBeenCalledWith(expectedChildDirectory);
    expect(androidDisSpy).toHaveReturnedWith(undefined);
  });
});
