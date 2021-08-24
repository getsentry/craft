import { homedir } from 'os';
import { join } from 'path';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import {
  MavenTarget,
  POM_DEFAULT_FILENAME,
  targetOptions,
  targetSecrets,
} from '../maven';
import { retrySpawnProcess } from '../../utils/async';
import { withTempDir } from '../../utils/files';

jest.mock('../../utils/files');

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    writeFile: jest.fn(() => Promise.resolve()),
    readFile: jest.fn((file: string) => file),
    readdir: async () => Promise.resolve([]), // empty dir
    unlink: jest.fn(),
    access: jest.fn(),
    copyFile: jest.fn(),
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

function getFullTargetConfig(): any {
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

function getRequiredTargetConfig(): any {
  return {
    OSSRH_USERNAME: DEFAULT_OPTION_VALUE,
    OSSRH_PASSWORD: DEFAULT_OPTION_VALUE,
    gradleCliPath: DEFAULT_OPTION_VALUE,
    mavenCliPath: DEFAULT_OPTION_VALUE,
    mavenSettingsPath: DEFAULT_OPTION_VALUE,
    mavenRepoId: DEFAULT_OPTION_VALUE,
    mavenRepoUrl: DEFAULT_OPTION_VALUE,
    android: false,
  };
}

function createMavenTarget(
  targetConfig?: Record<string, unknown>
): MavenTarget {
  const finalConfig = targetConfig ? targetConfig : getRequiredTargetConfig();
  const mergedConfig = {
    name: 'maven',
    ...finalConfig,
  };
  return new MavenTarget(mergedConfig, new NoneArtifactProvider());
}

describe('Maven target configuration', () => {
  beforeEach(() => setTargetSecretsInEnv());

  afterEach(() => removeTargetSecretsFromEnv());

  test('no env vars and no options', () => {
    removeTargetSecretsFromEnv();
    expect(createMavenTarget).toThrowErrorMatchingInlineSnapshot(
      `"Required value(s) OSSRH_USERNAME not found in configuration files or the environment. See the documentation for more details."`
    );
  });

  test('env vars without options', () => {
    expect(() => createMavenTarget({})).toThrowErrorMatchingInlineSnapshot(
      `"Required configuration gradleCliPath not found in configuration file. See the documentation for more details."`
    );
  });

  test('no android config', () => {
    const config = getRequiredTargetConfig();
    delete config.android;
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `"Required Android configuration was not found in the configuration file. See the documentation for more details"`
    );
  });

  test('incorrect one-line android config', () => {
    const config = getRequiredTargetConfig();
    config.android = 'yes';
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `"Required Android configuration is incorrect. See the documentation for more details."`
    );
  });

  test('correct one-line android config', () => {
    const config = getRequiredTargetConfig();
    const mvnTarget = createMavenTarget(config);
    expect(mvnTarget.mavenConfig.android).toStrictEqual(config.android);
  });

  test('incorrect object android config, missing prop', () => {
    const config = getFullTargetConfig();
    delete config.android.distDirRegex;
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `"Required Android configuration is incorrect. See the documentation for more details."`
    );
  });

  test('incorrect object android config, replaced prop', () => {
    const config = getFullTargetConfig();
    delete config.android.distDirRegex;
    config.android.anotherParam = 'unused';
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `"Required Android configuration is incorrect. See the documentation for more details."`
    );
  });

  test('correct object android config, with additional props', () => {
    const config = getFullTargetConfig();
    config.android.additionalProp = 'not relevant';
    const mvnTarget = createMavenTarget(config);
    const androidConfig: any = mvnTarget.mavenConfig.android;
    expect(config.android).toMatchObject(androidConfig);
    expect(androidConfig.additionalProp).not.toBeDefined();
  });

  test('minimum required options', () => {
    const mvnTarget = createMavenTarget(getRequiredTargetConfig());
    targetOptions.map(secret =>
      expect(mvnTarget.config).toEqual(
        expect.objectContaining({
          [secret]: DEFAULT_OPTION_VALUE,
        })
      )
    );
  });

  test('full target options', () => {
    setTargetSecretsInEnv();
    const mvnTarget = createMavenTarget(getFullTargetConfig());
    targetOptions.map(secret =>
      expect(mvnTarget.config).toEqual(
        expect.objectContaining({
          [secret]: DEFAULT_OPTION_VALUE,
        })
      )
    );
    expect(typeof mvnTarget.config.android.distDirRegex).toBe('string');
    expect(typeof mvnTarget.config.android.fileReplaceeRegex).toBe('string');
    expect(typeof mvnTarget.config.android.fileReplacerStr).toBe('string');
  });
});

describe('publish', () => {
  const tmpDirName = 'tmpDir';

  beforeAll(() => setTargetSecretsInEnv());

  afterAll(() => removeTargetSecretsFromEnv());

  beforeEach(() => jest.resetAllMocks());

  test('main flow', async () => {
    (withTempDir as jest.MockedFunction<typeof withTempDir>).mockImplementation(
      async cb => {
        return await cb(tmpDirName);
      }
    );

    const callOrder: string[] = [];
    const mvnTarget = createMavenTarget();
    const makeSnapshotMock = jest.fn(
      async () => void callOrder.push('makeSnapshot')
    );
    mvnTarget.createUserGradlePropsFile = makeSnapshotMock;
    const recoverGradlePropsSnapshot = jest.fn(
      async () => void callOrder.push('recoverSnapshot')
    );
    mvnTarget.recoverGradlePropsSnapshot = recoverGradlePropsSnapshot;
    const uploadMock = jest.fn(async () => void callOrder.push('upload'));
    mvnTarget.upload = uploadMock;
    (retrySpawnProcess as jest.MockedFunction<
      typeof retrySpawnProcess
    >).mockImplementationOnce(
      async () => void callOrder.push('closeAndRelease')
    );

    const revision = 'r3v1s10n';
    await mvnTarget.publish('1.0.0', revision);
    expect(makeSnapshotMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenLastCalledWith(revision);
    expect(recoverGradlePropsSnapshot).toHaveBeenCalledTimes(1);
    expect(retrySpawnProcess).toHaveBeenCalledTimes(1);
    expect(retrySpawnProcess).toHaveBeenCalledWith(DEFAULT_OPTION_VALUE, [
      'closeAndReleaseRepository',
    ]);
    expect(callOrder).toStrictEqual([
      'makeSnapshot',
      'upload',
      'closeAndRelease',
      'recoverSnapshot',
    ]);
  });

  test('upload POM', async () => {
    // simple mock to always use the same temporary directory,
    // instead of creating a new one
    (withTempDir as jest.MockedFunction<typeof withTempDir>).mockImplementation(
      async cb => {
        return await cb(tmpDirName);
      }
    );

    const mvnTarget = createMavenTarget();
    mvnTarget.getArtifactsForRevision = jest
      .fn()
      .mockResolvedValueOnce([{ filename: 'mockArtifact.zip' }]);
    mvnTarget.artifactProvider.downloadArtifact = jest
      .fn()
      .mockResolvedValueOnce('artifact/download/path');
    mvnTarget.isBomFile = jest.fn().mockResolvedValueOnce(false);

    await mvnTarget.upload('r3v1s10n');

    expect(retrySpawnProcess).toHaveBeenCalledTimes(1);
    const callArgs = (retrySpawnProcess as jest.MockedFunction<
      typeof retrySpawnProcess
    >).mock.calls[0];

    expect(callArgs).toHaveLength(2);
    expect(callArgs[0]).toEqual(DEFAULT_OPTION_VALUE);

    const cmdArgs = callArgs[1] as string[];
    expect(cmdArgs).toHaveLength(10);
    expect(cmdArgs[0]).toBe('gpg:sign-and-deploy-file');
    expect(cmdArgs[1]).toMatch(new RegExp(`-Dfile=${tmpDirName}.+`));
    expect(cmdArgs[2]).toMatch(
      new RegExp(
        `-Dfiles=${tmpDirName}.+-javadoc\.jar,${tmpDirName}.+-sources\.jar`
      )
    );
    expect(cmdArgs[3]).toBe(`-Dclassifiers=javadoc,sources`);
    expect(cmdArgs[4]).toBe(`-Dtypes=jar,jar`);
    expect(cmdArgs[5]).toMatch(
      new RegExp(`-DpomFile=${tmpDirName}.+pom-default\.xml`)
    );
    expect(cmdArgs[6]).toBe(`-DrepositoryId=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[7]).toBe(`-Durl=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[8]).toBe('--settings');
    expect(cmdArgs[9]).toBe(DEFAULT_OPTION_VALUE);
  });

  test('upload BOM', async () => {
    // simple mock to always use the same temporary directory,
    // instead of creating a new one
    (withTempDir as jest.MockedFunction<typeof withTempDir>).mockImplementation(
      async cb => {
        return await cb(tmpDirName);
      }
    );

    const mvnTarget = createMavenTarget();
    mvnTarget.getArtifactsForRevision = jest
      .fn()
      .mockResolvedValueOnce([{ filename: 'mockArtifact.zip' }]);
    mvnTarget.artifactProvider.downloadArtifact = jest
      .fn()
      .mockResolvedValueOnce('artifact/download/path');
    mvnTarget.isBomFile = jest.fn().mockResolvedValueOnce('path/to/bomfile');

    await mvnTarget.upload('r3v1s10n');

    expect(retrySpawnProcess).toHaveBeenCalledTimes(1);
    const callArgs = (retrySpawnProcess as jest.MockedFunction<
      typeof retrySpawnProcess
    >).mock.calls[0];

    expect(callArgs).toHaveLength(2);
    expect(callArgs[0]).toEqual(DEFAULT_OPTION_VALUE);

    const cmdArgs = callArgs[1] as string[];
    expect(cmdArgs).toHaveLength(7);
    expect(cmdArgs[0]).toBe('gpg:sign-and-deploy-file');
    expect(cmdArgs[1]).toMatch(
      new RegExp(`-Dfile=${tmpDirName}.+${POM_DEFAULT_FILENAME}`)
    );
    expect(cmdArgs[2]).toMatch(
      new RegExp(`-DpomFile=${tmpDirName}.*${POM_DEFAULT_FILENAME}`)
    );
    expect(cmdArgs[3]).toBe(`-DrepositoryId=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[4]).toBe(`-Durl=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[5]).toBe('--settings');
    expect(cmdArgs[6]).toBe(DEFAULT_OPTION_VALUE);
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

describe('gradle props snapshots', () => {
  beforeAll(() => setTargetSecretsInEnv());

  afterAll(() => removeTargetSecretsFromEnv());

  test('recover an existing snapshot', () => {
    const mvnTarget = createMavenTarget(getRequiredTargetConfig());
    mvnTarget.deleteUserGradlePropsFile = jest.fn();
    mvnTarget.recoverGradlePropsSnapshot('/a/random/path');
    expect(mvnTarget.deleteUserGradlePropsFile).not.toHaveBeenCalled();
  });

  test('recover a nonexisting snapshot', () => {
    const mvnTarget = createMavenTarget(getRequiredTargetConfig());
    mvnTarget.deleteUserGradlePropsFile = jest.fn();
    mvnTarget.recoverGradlePropsSnapshot(undefined);
    expect(mvnTarget.deleteUserGradlePropsFile).toHaveBeenCalledTimes(1);
  });
});
