import { homedir } from 'os';
import { join } from 'path';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { MavenTarget } from '../maven';

const directories: Record<string, string[]> = {
  android: ['androidChild'],
  androidChild: ['android-release.aar'],

  other: ['otherChild'],
  otherChild: ['otherRelease'],
};

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    readdir: async (parentDir: string) => directories[parentDir],
    writeFile: async () => {
      /* do nothing */
    },
  },
}));

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  exec: () => {
    /** do nothing */
  },
}));

jest.mock('../../utils/system', () => ({
  ...jest.requireActual('../../utils/system'),
  checkExecutableIsPresent: () => {
    /** do nothing */
  },
}));

const REQUIRED_OPTIONS: string[] = [
  'GITHUB_TOKEN', // Not specific to Maven target
  'OSSRH_USERNAME',
  'OSSRH_PASSWORD',
  'MAVEN_CENTRAL_USERNAME',
  'MAVEN_CENTRAL_PASSWORD',
];

const OPTIONAL_OPTIONS: string[] = [
  'MAVEN_DISTRIBUTIONS_PATH',
  'MAVEN_SETTINGS_PATH',
  'MAVEN_REPO_URL',
  'MAVEN_REPO_ID',
  'MAVEN_CLI_PATH',
  'GRADLE_CLI_PATH',
];

const DEFAULT_OPTION_VALUE = 'my_default_value';

function setRequiredConfig(): void {
  for (const option of REQUIRED_OPTIONS) {
    process.env[option] = DEFAULT_OPTION_VALUE;
  }
}

function removeRequiredConfig(): void {
  for (const option of REQUIRED_OPTIONS) {
    delete process.env[option];
  }
}

function setOptionalConfig(): void {
  for (const option of OPTIONAL_OPTIONS) {
    process.env[option] = DEFAULT_OPTION_VALUE;
  }
}

function removeOptionalConfig(): void {
  for (const option of OPTIONAL_OPTIONS) {
    delete process.env[option];
  }
}

function createMavenTarget(): MavenTarget {
  return new MavenTarget(
    {
      name: 'maven',
      ['testKey']: 'testValue',
    },
    new NoneArtifactProvider()
  );
}

describe('maven target configuration', () => {
  beforeEach(() => {
    removeRequiredConfig();
    removeOptionalConfig();
  });

  describe('required options exist', () => {
    test('with optional options', () => {
      setRequiredConfig();
      setOptionalConfig();
      createMavenTarget();
    });
    test('without optional options', () => {
      setRequiredConfig();
      createMavenTarget();
    });
  });

  describe("required options don't exist", () => {
    test('with optional options', () => {
      setOptionalConfig();
      expect(createMavenTarget).toThrowError();
    });
    test('without optional options', () => {
      expect(createMavenTarget).toThrowError();
    });
  });
});

describe('upload to Maven', () => {
  beforeAll(() => {
    setRequiredConfig();
  });

  afterAll(() => {
    removeRequiredConfig();
  });

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

  test("when it's an Android distribution", async () => {
    const parentDir = 'android';
    process.env.MAVEN_DISTRIBUTIONS_PATH = parentDir;
    const distDir = directories[parentDir][0];
    const androidTestFile = directories[distDir][0];
    const { javadocFile, sourcesFile, pomFile } = getFileParameters(
      distDir,
      distDir
    );

    const mavenTarget = createMavenTarget();
    const mavenUploadCmdSpy = jest.spyOn(mavenTarget, 'getMavenUploadCmd');
    const androidDisSpy = jest.spyOn(mavenTarget, 'getAndroidDistributionFile');
    await mavenTarget.upload();

    expect(androidDisSpy).toHaveBeenCalledTimes(1);
    expect(mavenUploadCmdSpy).toHaveBeenCalledTimes(1);
    expect(mavenUploadCmdSpy).toHaveBeenCalledWith(
      androidTestFile,
      javadocFile,
      sourcesFile,
      pomFile
    );
  });

  test("when it's not an Android distribution", async () => {
    const parentDir = 'other';
    process.env.MAVEN_DISTRIBUTIONS_PATH = parentDir;
    const distDir = directories[parentDir][0];
    const nonAndroidTestFile = join(distDir, `${distDir}.jar`);
    const { javadocFile, sourcesFile, pomFile } = getFileParameters(
      distDir,
      distDir
    );

    const mavenTarget = createMavenTarget();
    const mavenUploadCmdSpy = jest.spyOn(mavenTarget, 'getMavenUploadCmd');
    const androidDisSpy = jest.spyOn(mavenTarget, 'getAndroidDistributionFile');
    await mavenTarget.upload();

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
  beforeAll(() => {
    setRequiredConfig();
  });

  afterAll(() => {
    removeRequiredConfig();
  });

  test('when exists', async () => {
    const parentDirectory = 'android';
    process.env.MAVEN_DISTRIBUTIONS_PATH = parentDirectory;
    const expectedChildDirectory = directories[parentDirectory][0];
    const expectedAndroidFile = directories[expectedChildDirectory][0];

    const mavenTarget = createMavenTarget();
    const androidDisSpy = jest.spyOn(mavenTarget, 'getAndroidDistributionFile');
    await mavenTarget.upload();

    expect(androidDisSpy).toHaveBeenCalledTimes(1);
    expect(androidDisSpy).toHaveBeenCalledWith(expectedChildDirectory);
    expect(androidDisSpy).toHaveReturnedWith(
      Promise.resolve(expectedAndroidFile)
    );

    jest.resetAllMocks();
  });

  test("when it doesn't exist", async () => {
    const parentDirectory = 'other';
    process.env.MAVEN_DISTRIBUTIONS_PATH = parentDirectory;
    const expectedChildDirectory = directories[parentDirectory][0];

    const mavenTarget = createMavenTarget();
    const androidDisSpy = jest.spyOn(mavenTarget, 'getAndroidDistributionFile');
    await mavenTarget.upload();

    expect(androidDisSpy).toHaveBeenCalledTimes(1);
    expect(androidDisSpy).toHaveBeenCalledWith(expectedChildDirectory);
    expect(androidDisSpy).toHaveReturnedWith(Promise.resolve(undefined));
  });
});

describe('get gradle home directory', () => {
  const gradleHomeEnvVar = 'GRADLE_USER_HOME';

  beforeEach(() => {
    setRequiredConfig();
    // no need to check whether it already exists
    delete process.env[gradleHomeEnvVar];
  });

  test('with gradle home', () => {
    const expectedHomeDir = 'testDirectory';
    process.env[gradleHomeEnvVar] = expectedHomeDir;
    const actual = createMavenTarget().getGradleHomeDir();
    expect(actual).toEqual(expectedHomeDir);
  });

  test('without gradle home', () => {
    const expected = join(homedir(), '.gradle');
    const actual = createMavenTarget().getGradleHomeDir();
    expect(actual).toEqual(expected);
  });
});
