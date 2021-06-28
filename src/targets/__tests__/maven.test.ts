import { homedir } from 'os';
import { join } from 'path';
import { ConfigurationError } from '../../utils/errors';
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

jest.mock('../../utils/async', () => ({
  ...jest.requireActual('../../utils/async'),
  retrySpawnProcess: jest.fn(),
}));

// simple mock to always use the same temporary directory,
// instead of creating a new one
// jest.mock('../../utils/files', () => ({
//   ...jest.requireActual('../../utils/files'),
//   withTempDir: jest.fn().mockImplementation(async cb => {
//     return await cb('tmpDir');
//   }),
// }));

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
    MAVEN_CENTRAL_USERNAME: DEFAULT_OPTION_VALUE,
    MAVEN_CENTRAL_PASSWORD: DEFAULT_OPTION_VALUE,
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
  const options = {
    name: 'maven',
    ...finalOptions,
  };
  return new MavenTarget(options, new NoneArtifactProvider());
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

  test('without options', () => {
    expect(createMavenTarget).toThrowError(ConfigurationError);
  });
});

describe('publish to Maven', () => {
  beforeAll(() => setTargetSecretsInEnv());

  afterAll(() => removeTargetSecretsFromEnv());

  beforeEach(() => jest.resetAllMocks());

  test('main flow', async () => {
    const mvnTarget = createMavenTarget();
    const gradlePropsMock = jest.fn();
    mvnTarget.createUserGradlePropsFile = gradlePropsMock;
    const uploadMock = jest.fn();
    mvnTarget.upload = uploadMock;

    const version = '1.0.0';
    const revision = 'r3v1s10n';

    await mvnTarget.publish(version, revision);
    expect(gradlePropsMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenLastCalledWith(revision);
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
    // if `withTempDir` gets mocked (eg by uncommenting the lines at the top
    // of the file), this gets called 0 times and thus fails
    expect(retrySpawnProcess).toBeCalledTimes(1);
    // expect(retrySpawnProcess).toHaveBeenLastCalledWith(
    //   DEFAULT_OPTION_VALUE,
    //   // Only testing the command here
    //   expect.any(Array)
    // );

    // @ts-ignore
    const tmp = retrySpawnProcess.mock.calls[0];
    expect(tmp).toMatchInlineSnapshot();
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
