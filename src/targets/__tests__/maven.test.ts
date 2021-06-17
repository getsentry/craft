import { homedir } from 'os';
import { join } from 'path';
import { ConfigurationError } from '../../utils/errors';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { MavenTarget } from '../maven';

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
  checkExecutableIsPresent: () => {
    /** do nothing */
  },
}));

const targetSecrets: string[] = [
  'OSSRH_USERNAME',
  'OSSRH_PASSWORD',
  'MAVEN_CENTRAL_USERNAME',
  'MAVEN_CENTRAL_PASSWORD',
];

const targetOptions: string[] = [
  'androidDistDirPattern',
  'androidFileReplaceePattern',
  'androidFileReplacerStr',
  'gradleCliPath',
  'mavenCliPath',
  'mavenSettingsPath',
  'mavenRepoId',
  'mavenRepoUrl',
];

const DEFAULT_OPTION_VALUE = 'my_default_value';

interface TestTargetConfig {
  name: string;
  [otherKeys: string]: string;
}

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

function getTargetOptions(): TestTargetConfig {
  const defaultOptions: TestTargetConfig = {
    name: 'maven',
  };
  targetOptions.map(option => (defaultOptions[option] = DEFAULT_OPTION_VALUE));
  return defaultOptions;
}

function createMavenTarget(targetOptions?: TestTargetConfig): MavenTarget {
  const options = targetOptions
    ? targetOptions
    : {
        name: 'maven',
        ['testKey']: 'testValue',
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

  test('with target secrets and options', () => {
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

  test('with only target secrets', () => {
    setTargetSecretsInEnv();
    expect(createMavenTarget).toThrowError(ConfigurationError);
  });

  test('with only target options', () => {
    expect(createMavenTarget).toThrowError(ConfigurationError);
  });
});

describe('publish to Maven', () => {
  beforeAll(() => setTargetSecretsInEnv());

  afterAll(() => removeTargetSecretsFromEnv());

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
