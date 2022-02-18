import { promises as fsPromises } from 'fs';
import { platform } from 'os';
import simpleGit from 'simple-git';
import { PubDevTarget, targetSecrets } from '../pubDev';
import { spawnProcess } from '../../utils/system';
import { NoneArtifactProvider } from '../../artifact_providers/none';

jest.mock('../../utils/system');
jest.mock('../../utils/files', () => ({
  ...jest.requireActual('../../utils/files'),
  withTempDir: async (cb: (dir: string) => Promise<void>) => cb(TMP_DIR),
}));

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  platform: jest.fn(() => 'darwin'),
  homedir: jest.fn(() => '/usr'),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    access: jest.fn(() => Promise.resolve()),
    writeFile: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('simple-git', () => ({
  __esModule: true, // this property makes default export work
  default: jest.fn(() => ({
    clone: jest.fn(async (): Promise<void> => Promise.resolve()),
    checkout: jest.fn(async (): Promise<void> => Promise.resolve()),
  })),
}));

const DEFAULT_OPTION_VALUE = 'my_default_value';
const TMP_DIR = '/tmp/dir';

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

function createPubDevTarget(
  targetConfig?: Record<string, unknown>
): PubDevTarget {
  return new PubDevTarget(
    {
      name: 'pub-dev',
      ...targetConfig,
    },
    new NoneArtifactProvider(),
    { owner: 'testOwner', repo: 'testRepo' }
  );
}

beforeEach(() => {
  setTargetSecretsInEnv();
});

afterEach(() => {
  removeTargetSecretsFromEnv();
});

describe('PubDev target configuration', () => {
  test('should enforce required secrets', () => {
    removeTargetSecretsFromEnv();

    expect(createPubDevTarget).toThrowErrorMatchingInlineSnapshot(
      `"Required value(s) PUBDEV_ACCESS_TOKEN not found in configuration files or the environment. See the documentation for more details."`
    );

    process.env.PUBDEV_ACCESS_TOKEN = DEFAULT_OPTION_VALUE;
    expect(createPubDevTarget).toThrowErrorMatchingInlineSnapshot(
      `"Required value(s) PUBDEV_REFRESH_TOKEN not found in configuration files or the environment. See the documentation for more details."`
    );

    process.env.PUBDEV_REFRESH_TOKEN = DEFAULT_OPTION_VALUE;
    expect(createPubDevTarget).not.toThrow();
  });

  test('should set default options', () => {
    const target = createPubDevTarget();

    expect(target.pubDevConfig).toStrictEqual({
      PUBDEV_ACCESS_TOKEN: DEFAULT_OPTION_VALUE,
      PUBDEV_REFRESH_TOKEN: DEFAULT_OPTION_VALUE,
      dartCliPath: 'dart',
      packages: ['.'],
    });
  });

  test('should allow for overwriting default options', () => {
    process.env.PUBDEV_ACCESS_TOKEN = 'access';
    process.env.PUBDEV_REFRESH_TOKEN = 'refresh';

    const target = createPubDevTarget({
      dartCliPath: '/custom/path/dart',
      // GH Actions .yml format
      packages: {
        uno: undefined,
        dos: undefined,
        tres: undefined,
      },
    });

    expect(target.pubDevConfig).toStrictEqual({
      PUBDEV_ACCESS_TOKEN: 'access',
      PUBDEV_REFRESH_TOKEN: 'refresh',
      dartCliPath: '/custom/path/dart',
      packages: ['uno', 'dos', 'tres'],
    });
  });
});

describe('publish', () => {
  test('single package', async () => {
    const revision = 'r3v1s10n';
    const callOrder: string[] = [];
    const target = createPubDevTarget();
    target.createCredentialsFile = jest.fn(
      async () => void callOrder.push('createCredentialsFile')
    );
    target.cloneRepository = jest.fn(
      async () => void callOrder.push('cloneRepository')
    );
    target.publishPackage = jest.fn(
      async () => void callOrder.push('publishPackage')
    );

    await target.publish('1.0.0', revision);

    expect(target.createCredentialsFile).toHaveBeenCalled();
    expect(target.cloneRepository).toHaveBeenCalledWith(
      target.githubRepo,
      revision,
      TMP_DIR
    );
    expect(target.publishPackage).toHaveBeenCalledWith(TMP_DIR, '.');
    expect(callOrder).toStrictEqual([
      'createCredentialsFile',
      'cloneRepository',
      'publishPackage',
    ]);
  });

  test('multiple packages', async () => {
    const revision = 'r3v1s10n';
    const callOrder: string[] = [];
    const target = createPubDevTarget({
      packages: {
        uno: undefined,
        dos: undefined,
        tres: undefined,
      },
    });
    target.createCredentialsFile = jest.fn(
      async () => void callOrder.push('createCredentialsFile')
    );
    target.cloneRepository = jest.fn(
      async () => void callOrder.push('cloneRepository')
    );
    target.publishPackage = jest.fn(
      async () => void callOrder.push('publishPackage')
    );

    await target.publish('1.0.0', revision);

    expect(target.createCredentialsFile).toHaveBeenCalled();
    expect(target.cloneRepository).toHaveBeenCalledWith(
      target.githubRepo,
      revision,
      TMP_DIR
    );
    expect(target.publishPackage).toHaveBeenNthCalledWith(1, TMP_DIR, 'uno');
    expect(target.publishPackage).toHaveBeenNthCalledWith(2, TMP_DIR, 'dos');
    expect(target.publishPackage).toHaveBeenNthCalledWith(3, TMP_DIR, 'tres');
    expect(callOrder).toStrictEqual([
      'createCredentialsFile',
      'cloneRepository',
      'publishPackage',
      'publishPackage',
      'publishPackage',
    ]);
  });
});

describe('createCredentialsFile', () => {
  test('should not create a file if one is already present', async () => {
    fsPromises.access = jest.fn(() => Promise.resolve());
    const target = createPubDevTarget();
    await target.createCredentialsFile();
    expect(fsPromises.writeFile).not.toHaveBeenCalled();
  });

  test('should create a file if one is not present', async () => {
    fsPromises.access = jest.fn(() => Promise.reject());
    const target = createPubDevTarget();
    await target.createCredentialsFile();
    const writeFileMock = fsPromises.writeFile as jest.MockedFunction<
      typeof fsPromises.writeFile
    >;
    const [path, content] = writeFileMock.mock.calls[0];

    expect(path).toBe(
      `/usr/Library/Application Support/dart/pub-credentials.json`
    );
    expect(content).toMatchInlineSnapshot(
      `"{\\"accessToken\\":\\"my_default_value\\",\\"refreshToken\\":\\"my_default_value\\",\\"tokenEndpoint\\":\\"https://accounts.google.com/o/oauth2/token\\",\\"scopes\\":[\\"openid\\",\\"https://www.googleapis.com/auth/userinfo.email\\"],\\"expiration\\":1645564942000}"`
    );
  });

  test('should choose path based on the platform', async () => {
    fsPromises.access = jest.fn(() => Promise.reject());
    (platform as jest.MockedFunction<typeof platform>).mockImplementationOnce(
      () => 'linux'
    );
    const target = createPubDevTarget();
    await target.createCredentialsFile();
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      `/usr/.config/dart/pub-credentials.json`,
      expect.any(String)
    );
  });

  test('should throw when run on unsupported platform', async () => {
    fsPromises.access = jest.fn(() => Promise.reject());
    (platform as jest.MockedFunction<typeof platform>).mockImplementationOnce(
      () => 'win32'
    );
    const target = createPubDevTarget();
    await expect(target.createCredentialsFile()).rejects.toThrow();
  });
});

describe('cloneRepository', () => {
  test('should create an instance of simpleGit and call appropriate methods to clone the repo and checkout a revision', async () => {
    const revision = 'r3v1s10n';
    const target = createPubDevTarget();
    await target.cloneRepository(target.githubRepo, revision, TMP_DIR);

    const simpleGitMock = simpleGit as jest.MockedFunction<typeof simpleGit>;
    const simpleGitMockRv = simpleGitMock.mock.results[0].value;

    expect(simpleGitMock).toHaveBeenCalledWith(TMP_DIR);
    expect(simpleGitMockRv.clone).toHaveBeenCalledWith(
      `https://github.com/${target.githubRepo.owner}/${target.githubRepo.repo}.git`,
      TMP_DIR
    );
    expect(simpleGitMockRv.checkout).toHaveBeenCalledWith(revision);
  });
});

describe('publishPackage', () => {
  test('should call `dart` cli with appropriate arguments', async () => {
    const pkg = 'uno';
    const target = createPubDevTarget();
    await target.publishPackage(TMP_DIR, pkg);

    const spawnProcessMock = spawnProcess as jest.MockedFunction<
      typeof spawnProcess
    >;

    expect(spawnProcessMock).toHaveBeenCalledWith(
      'dart',
      ['pub', 'publish', '--force'],
      {
        cwd: `${TMP_DIR}/${pkg}`,
      },
      { showStdout: true }
    );
  });

  test('should use custom cli path if provided', async () => {
    const dartCliPath = '/custom/path/dart';
    const pkg = 'uno';
    const target = createPubDevTarget({
      dartCliPath,
    });
    await target.publishPackage(TMP_DIR, pkg);

    const spawnProcessMock = spawnProcess as jest.MockedFunction<
      typeof spawnProcess
    >;

    expect(spawnProcessMock).toHaveBeenCalledWith(
      dartCliPath,
      ['pub', 'publish', '--force'],
      {
        cwd: `${TMP_DIR}/${pkg}`,
      },
      { showStdout: true }
    );
  });
});