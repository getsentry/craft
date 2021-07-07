import { homedir } from 'os';
import { join } from 'path';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { MavenTarget, targetOptions, targetSecrets } from '../maven';
import { retrySpawnProcess } from '../../utils/async';
import { withTempDir } from '../../utils/files';

jest.mock('../../utils/files');

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
  const tmpDirName = 'tmpDir';

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

    await mvnTarget.upload('r3v1s10n');
    expect(retrySpawnProcess).toBeCalledTimes(1);
    const callArgs = (retrySpawnProcess as jest.MockedFunction<
      typeof retrySpawnProcess
    >).mock.calls[0];

    console.log(callArgs);
    expect(callArgs).toHaveLength(2);
    expect(callArgs[0]).toEqual(DEFAULT_OPTION_VALUE);
    const cmdArgs = callArgs[1];
    expect(cmdArgs).toBeDefined();
    expect(cmdArgs).toHaveLength(10);
    // @ts-ignore `cmdArgs[*]` possibly undefined
    expect(cmdArgs[0]).toEqual('gpg:sign-and-deploy-file');
    // @ts-ignore `cmdArgs[*]` possibly undefined
    expect(cmdArgs[1]).toMatch(new RegExp(`-Dfile=${tmpDirName}.*`));
    // @ts-ignore `cmdArgs[*]` possibly undefined
    expect(cmdArgs[2]).toMatch(
      new RegExp(
        `-Dfiles=${tmpDirName}.*-javadoc\.jar,${tmpDirName}.*-sources\.jar`
      )
    );
    // @ts-ignore `cmdArgs[*]` possibly undefined
    expect(cmdArgs[3]).toMatch(new RegExp(`-Dclassifiers=javadoc,sources`));
    // @ts-ignore `cmdArgs[*]` possibly undefined
    expect(cmdArgs[4]).toMatch(new RegExp(`-Dtypes=jar,jar`));
    // @ts-ignore `cmdArgs[*]` possibly undefined
    expect(cmdArgs[5]).toMatch(
      new RegExp(`-DpomFile=${tmpDirName}.*pom-default\.xml`)
    );
    // @ts-ignore `cmdArgs[*]` possibly undefined
    expect(cmdArgs[6]).toMatch(
      new RegExp(`-DrepositoryId=${DEFAULT_OPTION_VALUE}`)
    );
    // @ts-ignore `cmdArgs[*]` possibly undefined
    expect(cmdArgs[7]).toMatch(new RegExp(`-Durl=${DEFAULT_OPTION_VALUE}`));
    // @ts-ignore `cmdArgs[*]` possibly undefined
    expect(cmdArgs[8]).toMatch(new RegExp(`--settings`));
    // @ts-ignore `cmdArgs[*]` possibly undefined
    expect(cmdArgs[9]).toMatch(DEFAULT_OPTION_VALUE);
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
