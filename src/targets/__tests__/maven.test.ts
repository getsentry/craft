import { homedir } from 'os';
import { join } from 'path';
import { ConfigurationError } from '../../utils/errors';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { MavenTarget, MavenTargetConfig, targetOptions } from '../maven';
import { retrySpawnProcess } from '../../utils/async';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    writeFile: async () => {
      /* do nothing */
    },
  },
}));

jest.mock('../../utils/system', () => ({
  ...jest.requireActual('../../utils/system'),
  checkExecutableIsPresent: jest.fn(),
  retrySpawnProcess: jest.fn(),
  extractZipArchive: jest.fn(),
}));

const targetSecrets: string[] = [
  'OSSRH_USERNAME',
  'OSSRH_PASSWORD',
  'MAVEN_CENTRAL_USERNAME',
  'MAVEN_CENTRAL_PASSWORD',
];

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

function getTargetOptions(): MavenTargetConfig {
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

function createMavenTarget(targetOptions?: MavenTargetConfig): MavenTarget {
  const finalOptions = targetOptions ? targetOptions : getTargetOptions();
  const options = {
    name: 'maven',
    ...finalOptions,
  };
  return new MavenTarget(options, new NoneArtifactProvider());
}

describe('Maven target configuration', () => {
  beforeEach(() => removeTargetSecretsFromEnv());

  function getExpectedValueOfConfigKey(configKey: string): string | RegExp {
    if (
      configKey.includes('androidDistDirPattern') ||
      configKey.includes('androidFileSearchPattern')
    ) {
      return new RegExp(DEFAULT_OPTION_VALUE);
    }
    return DEFAULT_OPTION_VALUE;
  }

  test('with options', () => {
    setTargetSecretsInEnv();
    const mvnTarget = createMavenTarget(getTargetOptions());
    targetOptions.map(secret =>
      expect(mvnTarget.config).toEqual(
        expect.objectContaining({
          [secret]: getExpectedValueOfConfigKey(secret),
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
    const mvnTarget = createMavenTarget(getTargetOptions());
    const gradlePropsMock = jest.fn();
    mvnTarget.createUserGradlePropsFile = gradlePropsMock;
    const uploadMock = jest.fn();
    mvnTarget.upload = uploadMock;
    const closeAndReleaseMock = jest.fn();
    mvnTarget.closeAndRelease = closeAndReleaseMock;

    const version = '1.0.0';
    const revision = 'r3v1s10n';

    await mvnTarget.publish(version, revision);
    expect(gradlePropsMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenLastCalledWith(revision);
    expect(closeAndReleaseMock).toHaveBeenCalledTimes(1);
  });

  test('upload', async () => {
    const mvnTarget = createMavenTarget(getTargetOptions());
    mvnTarget.getArtifactsForRevision = jest
      .fn()
      .mockResolvedValueOnce([{ filename: 'mockArtifact.zip' }]);
    mvnTarget.artifactProvider.downloadArtifact = jest
      .fn()
      .mockResolvedValueOnce('artifact/download/path');

    await mvnTarget.upload('r3v1s10n');
    expect(retrySpawnProcess).toBeCalledTimes(1);
  });

  test('close and release', async () => {
    const mvnTarget = createMavenTarget(getTargetOptions());
    await mvnTarget.closeAndRelease();
    expect(retrySpawnProcess).toHaveBeenCalledTimes(1);
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
    const actual = createMavenTarget(getTargetOptions()).getGradleHomeDir();
    expect(actual).toEqual(expectedHomeDir);
  });

  test('without gradle home', () => {
    const expected = join(homedir(), '.gradle');
    const actual = createMavenTarget(getTargetOptions()).getGradleHomeDir();
    expect(actual).toEqual(expected);
  });
});
