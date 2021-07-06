import { homedir } from 'os';
import { join } from 'path';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { MavenTarget, targetOptions, targetSecrets } from '../maven';
import { retrySpawnProcess } from '../../utils/async';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    writeFile: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../../utils/system', () => ({
  ...jest.requireActual('../../utils/system'),
  checkExecutableIsPresent: jest.fn(),
  extractZipArchive: jest.fn(),
}));

jest.mock('../../utils/async');

const DEFAULT_OPTION_VALUE = 'my_default_value';

function setTargetSecretsInEnv(): void {
  for (const option of targetSecrets) {
    process.env[option] = DEFAULT_OPTION_VALUE;
  }
}

function removeTargetSecretsFromEnv(): void {
  for (const option of targetSecrets) {
    delete process.env[option];
  }
}

function getTargetOptions() {
  return {
    OSSRH_USERNAME: DEFAULT_OPTION_VALUE,
    OSSRH_PASSWORD: DEFAULT_OPTION_VALUE,
    gradleCliPath: DEFAULT_OPTION_VALUE,
    mavenCliPath: DEFAULT_OPTION_VALUE,
    mavenSettingsPath: DEFAULT_OPTION_VALUE,
    mavenRepoId: DEFAULT_OPTION_VALUE,
    mavenRepoUrl: DEFAULT_OPTION_VALUE,
    android: {
      distDirRegex: '/distDir/',
      fileReplaceeRegex: '/replacee/',
      fileReplacerStr: 'replacer',
    },
  };
}

function createMavenTarget(
  targetOptions?: Record<string, unknown>
): MavenTarget {
  const finalOptions = targetOptions ? targetOptions : getTargetOptions();
  const mergedOptions = {
    name: 'maven',
    ...finalOptions,
  };
  return new MavenTarget(mergedOptions, new NoneArtifactProvider());
}

describe('Maven target configuration', () => {
  beforeEach(() => removeTargetSecretsFromEnv());

  test('with options', () => {
    setTargetSecretsInEnv();
    const mvnTarget = createMavenTarget(getTargetOptions());
    targetOptions.map(secret =>
      expect(mvnTarget.config).toEqual(
        expect.objectContaining({
          [secret]: DEFAULT_OPTION_VALUE,
        })
      )
    );
  });

  test('without options', () =>
    expect(createMavenTarget).toThrowErrorMatchingInlineSnapshot(
      `"Required value(s) OSSRH_USERNAME not found in configuration files or the environment. See the documentation for more details."`
    ));
});

describe('publish', () => {
  beforeAll(() => setTargetSecretsInEnv());

  afterAll(() => removeTargetSecretsFromEnv());

  beforeEach(() => jest.resetAllMocks());

  test('main flow', async () => {
    const callOrder: string[] = [];
    const mvnTarget = createMavenTarget();
    const gradlePropsMock = jest.fn(
      async () => void callOrder.push('gradleProps')
    );
    mvnTarget.createUserGradlePropsFile = gradlePropsMock;
    const uploadMock = jest.fn(async () => void callOrder.push('upload'));
    mvnTarget.upload = uploadMock;
    (retrySpawnProcess as jest.MockedFunction<
      typeof retrySpawnProcess
    >).mockImplementationOnce(
      async () => void callOrder.push('closeAndRelease')
    );

    const version = '1.0.0';
    const revision = 'r3v1s10n';

    await mvnTarget.publish(version, revision);
    expect(gradlePropsMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenLastCalledWith(revision);
    expect(retrySpawnProcess).toHaveBeenCalledTimes(1);
    expect(retrySpawnProcess).toHaveBeenCalledWith(DEFAULT_OPTION_VALUE, [
      'closeAndReleaseRepository',
    ]);
    expect(callOrder).toStrictEqual([
      'gradleProps',
      'upload',
      'closeAndRelease',
    ]);
  });

  test('upload', async () => {
    const mvnTarget = createMavenTarget();
    mvnTarget.getArtifactsForRevision = jest
      .fn()
      .mockResolvedValueOnce([{ filename: 'mockArtifact.zip' }]);
    mvnTarget.artifactProvider.downloadArtifact = jest
      .fn()
      .mockResolvedValueOnce('artifact/download/path');

    await mvnTarget.upload('r3v1s10n');
    expect(retrySpawnProcess).toBeCalledTimes(1);
    const callArgs = (retrySpawnProcess as jest.MockedFunction<
      typeof retrySpawnProcess
    >).mock.calls[0];
    expect(callArgs).toMatchInlineSnapshot(`
      Array [
        "my_default_value",
        Array [
          "gpg:sign-and-deploy-file",
          "-Dfile=C:\\\\Users\\\\byk\\\\AppData\\\\Local\\\\Temp\\\\craft-neTYOE\\\\mockArtifact\\\\mockArtifact.jar",
          "-Dfiles=C:\\\\Users\\\\byk\\\\AppData\\\\Local\\\\Temp\\\\craft-neTYOE\\\\mockArtifact\\\\mockArtifact-javadoc.jar,C:\\\\Users\\\\byk\\\\AppData\\\\Local\\\\Temp\\\\craft-neTYOE\\\\mockArtifact\\\\mockArtifact-sources.jar",
          "-Dclassifiers=javadoc,sources",
          "-Dtypes=jar,jar",
          "-DpomFile=C:\\\\Users\\\\byk\\\\AppData\\\\Local\\\\Temp\\\\craft-neTYOE\\\\mockArtifact\\\\pom-default.xml",
          "-DrepositoryId=my_default_value",
          "-Durl=my_default_value",
          "--settings",
          "my_default_value",
        ],
      ]
    `);
  });
});

describe('get gradle home directory', () => {
  const gradleHomeEnvVar = 'GRADLE_USER_HOME';

  beforeEach(() => {
    setTargetSecretsInEnv();
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
