import { URL } from 'url';
import nock from 'nock';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import {
  MavenTarget,
  NexusRepository,
  NEXUS_API_BASE_URL,
  POM_DEFAULT_FILENAME,
  targetOptions,
  targetSecrets,
} from '../maven';
import { retrySpawnProcess, sleep } from '../../utils/async';
import { withTempDir } from '../../utils/files';
import { importGPGKey } from '../../utils/gpg';

jest.mock('../../utils/files');
jest.mock('../../utils/gpg');

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    writeFile: jest.fn(() => Promise.resolve()),
    readFile: jest.fn((file: string) => file),
    mkdir: jest.fn(() => Promise.resolve()),
    readdir: async () => Promise.resolve([]), // empty dir
    unlink: jest.fn(),
  },
}));

jest.mock('../../utils/system', () => ({
  ...jest.requireActual('../../utils/system'),
  checkExecutableIsPresent: jest.fn(),
  extractZipArchive: jest.fn(),
}));

jest.mock('../../utils/async', () => ({
  ...jest.requireActual('../../utils/async'),
  retrySpawnProcess: jest.fn(() => Promise.resolve()),
  sleep: jest.fn(() =>
    setTimeout(() => {
      Promise.resolve();
    }, 10)
  ),
}));

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
    GPG_PASSPHRASE: DEFAULT_OPTION_VALUE,
    OSSRH_USERNAME: DEFAULT_OPTION_VALUE,
    OSSRH_PASSWORD: DEFAULT_OPTION_VALUE,
    mavenCliPath: DEFAULT_OPTION_VALUE,
    mavenSettingsPath: DEFAULT_OPTION_VALUE,
    mavenRepoId: DEFAULT_OPTION_VALUE,
    mavenRepoUrl: DEFAULT_OPTION_VALUE,
    android: {
      distDirRegex: '/distDir/',
      fileReplaceeRegex: '/replacee/',
      fileReplacerStr: 'replacer',
    },
    kmp: {
      rootDistDirRegex: '/distDir/',
      appleDistDirRegex: '/apple-distDir/',
    },
  };
}

function getRequiredTargetConfig(): any {
  return {
    GPG_PASSPHRASE: DEFAULT_OPTION_VALUE,
    OSSRH_USERNAME: DEFAULT_OPTION_VALUE,
    OSSRH_PASSWORD: DEFAULT_OPTION_VALUE,
    mavenCliPath: DEFAULT_OPTION_VALUE,
    mavenSettingsPath: DEFAULT_OPTION_VALUE,
    mavenRepoId: DEFAULT_OPTION_VALUE,
    mavenRepoUrl: DEFAULT_OPTION_VALUE,
    android: false,
    kmp: false,
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

function getRepositoryInfo(
  type: NexusRepository['type'],
  transitioning: NexusRepository['transitioning']
): NexusRepository {
  return {
    type,
    repositoryId: 'sentry-java',
    transitioning,
  };
}

beforeEach(() => {
  setTargetSecretsInEnv();
});

afterEach(() => {
  removeTargetSecretsFromEnv();
  jest.resetAllMocks();
});

describe('Maven target configuration', () => {
  test('no env vars and no options', () => {
    removeTargetSecretsFromEnv();
    expect(createMavenTarget).toThrowErrorMatchingInlineSnapshot(
      `"Required value(s) GPG_PASSPHRASE not found in configuration files or the environment. See the documentation for more details."`
    );
  });

  test('env vars without options', () => {
    expect(() => createMavenTarget({})).toThrowErrorMatchingInlineSnapshot(
      `"Required configuration mavenCliPath not found in configuration file. See the documentation for more details."`
    );
  });

  test('no android config', () => {
    const config = getRequiredTargetConfig();
    delete config.android;
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `"Required Android configuration was not found in the configuration file. See the documentation for more details"`
    );
  });

  test('no kotlinMultiplatform config', () => {
    const config = getRequiredTargetConfig();
    delete config.kmp;
    expect(() => createMavenTarget(config)).not.toThrowError();
  });

  test('incorrect one-line android config', () => {
    const config = getRequiredTargetConfig();
    config.android = 'yes';
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `"Required Android configuration is incorrect. See the documentation for more details."`
    );
  });

  test('incorrect one-line kotlinMultiplatform config', () => {
    const config = getRequiredTargetConfig();
    config.kmp = 'yes';
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `"Required root configuration for Kotlin Multiplatform is incorrect. See the documentation for more details."`
    );
  });

  test('correct one-line android config', () => {
    const config = getRequiredTargetConfig();
    const mvnTarget = createMavenTarget(config);
    expect(mvnTarget.mavenConfig.android).toStrictEqual(config.android);
  });

  test('correct one-line kotlinMultiplatform config', () => {
    const config = getRequiredTargetConfig();
    const mvnTarget = createMavenTarget(config);
    expect(mvnTarget.mavenConfig.kmp).toStrictEqual(config.kmp);
  });

  test('incorrect object android config, missing prop', () => {
    const config = getFullTargetConfig();
    delete config.android.distDirRegex;
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `"Required Android configuration is incorrect. See the documentation for more details."`
    );
  });

  test('incorrect object kotlinMultiplatform config, replaced root distDir', () => {
    const config = getFullTargetConfig();
    delete config.kmp.rootDistDirRegex;
    config.kmp.anotherParam = 'unused';
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `"Required root configuration for Kotlin Multiplatform is incorrect. See the documentation for more details."`
    );
  });

  test('incorrect object kotlinMultiplatform config, replaced apple distDir', () => {
    const config = getFullTargetConfig();
    delete config.kmp.appleDistDirRegex;
    config.kmp.anotherParam = 'unused';
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `"Required apple configuration for Kotlin Multiplatform is incorrect. See the documentation for more details."`
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

  test('correct object kotlinMultiplatform config, with additional props', () => {
    const config = getFullTargetConfig();
    config.kmp.additionalProp = 'not relevant';
    const mvnTarget = createMavenTarget(config);
    const kotlinMultiplatformConfig: any = mvnTarget.mavenConfig.kmp;
    expect(config.kmp).toMatchObject(kotlinMultiplatformConfig);
    expect(kotlinMultiplatformConfig.additionalProp).not.toBeDefined();
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
    expect(typeof mvnTarget.config.kmp.rootDistDirRegex).toBe('string');
    expect(typeof mvnTarget.config.kmp.appleDistDirRegex).toBe('string');
  });

  test('import GPG private key if one is present in the environment', async () => {
    setTargetSecretsInEnv();
    process.env.GPG_PRIVATE_KEY = DEFAULT_OPTION_VALUE;
    const mvnTarget = createMavenTarget(getFullTargetConfig());
    await mvnTarget.publish('1.0.0', 'r3v1s10n');
    expect(importGPGKey).toHaveBeenCalledWith(DEFAULT_OPTION_VALUE);
  });
});

describe('publish', () => {
  test('main flow', async () => {
    const callOrder: string[] = [];
    const mvnTarget = createMavenTarget();
    mvnTarget.upload = jest.fn(async () => void callOrder.push('upload'));
    mvnTarget.closeAndReleaseRepository = jest.fn(
      async () => void callOrder.push('closeAndReleaseRepository')
    );
    const revision = 'r3v1s10n';
    await mvnTarget.publish('1.0.0', revision);
    expect(mvnTarget.upload).toHaveBeenCalledTimes(1);
    expect(mvnTarget.upload).toHaveBeenCalledWith(revision);
    expect(mvnTarget.closeAndReleaseRepository).toHaveBeenCalledTimes(1);
    expect(callOrder).toStrictEqual(['upload', 'closeAndReleaseRepository']);
  });
});

describe('transform KMP artifacts', () => {
  const tmpDirName = 'tmpDir';

  test('transform apple target side artifacts', async () => {
    (withTempDir as jest.MockedFunction<typeof withTempDir>).mockImplementation(
      async cb => {
        return await cb(tmpDirName);
      }
    );

    const mvnTarget = createMavenTarget(getFullTargetConfig());
    const files: Record<string, string | string[]> = {
      javadocFile: `${tmpDirName}-javadoc.jar`,
      sourcesFile: `${tmpDirName}-sources.jar`,
      klibFiles: [
        `${tmpDirName}-cinterop-Sentry.NSException.klib`,
        `${tmpDirName}-cinterop-Sentry.klib`,
      ],
      allFile: '',
      metadataFile: `${tmpDirName}-metadata.jar`,
      moduleFile: `${tmpDirName}.module`,
    };
    const {
      sideArtifacts,
      classifiers,
      types,
    } = mvnTarget.transformKmpSideArtifacts(false, true, files);
    expect(sideArtifacts).toEqual(
      `${files.javadocFile},${files.sourcesFile},${files.klibFiles},${files.metadataFile},${files.moduleFile}`
    );
    expect(classifiers).toEqual(
      'javadoc,sources,cinterop-Sentry.NSException,cinterop-Sentry,metadata,'
    );
    expect(types).toEqual('jar,jar,klib,klib,jar,module');
  });

  test('transform root target side artifacts', async () => {
    (withTempDir as jest.MockedFunction<typeof withTempDir>).mockImplementation(
      async cb => {
        return await cb(tmpDirName);
      }
    );

    const mvnTarget = createMavenTarget(getFullTargetConfig());
    const files: Record<string, string | string[]> = {
      javadocFile: `${tmpDirName}-javadoc.jar`,
      sourcesFile: `${tmpDirName}-sources.jar`,
      klibFiles: [],
      allFile: `${tmpDirName}-all.jar`,
      metadataFile: '',
      moduleFile: `${tmpDirName}.module`,
      kotlinToolingMetadataFile: `${tmpDirName}-kotlin-tooling-metadata.json`,
    };
    const {
      sideArtifacts,
      classifiers,
      types,
    } = mvnTarget.transformKmpSideArtifacts(true, false, files);
    expect(sideArtifacts).toEqual(
      `${files.javadocFile},${files.sourcesFile},${files.allFile},${files.kotlinToolingMetadataFile},${files.moduleFile}`
    );
    expect(classifiers).toEqual('javadoc,sources,all,kotlin-tooling-metadata,');
    expect(types).toEqual('jar,jar,jar,json,module');
  });
});

describe('upload', () => {
  const tmpDirName = 'tmpDir';

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
    mvnTarget.getPomFileInDist = jest
      .fn()
      .mockResolvedValueOnce('pom-default.xml');

    await mvnTarget.upload('r3v1s10n');

    expect(retrySpawnProcess).toHaveBeenCalledTimes(1);
    const callArgs = (retrySpawnProcess as jest.MockedFunction<
      typeof retrySpawnProcess
    >).mock.calls[0];

    expect(callArgs).toHaveLength(2);
    expect(callArgs[0]).toEqual(DEFAULT_OPTION_VALUE);

    const cmdArgs = callArgs[1] as string[];
    expect(cmdArgs).toHaveLength(11);
    expect(cmdArgs[0]).toBe('gpg:sign-and-deploy-file');
    expect(cmdArgs[1]).toMatch(new RegExp(`-Dfile=${tmpDirName}.+`));
    expect(cmdArgs[2]).toMatch(
      new RegExp(
        `-Dfiles=${tmpDirName}.+-javadoc\\.jar,${tmpDirName}.+-sources\\.jar,${tmpDirName}.+\\.module`
      )
    );
    expect(cmdArgs[3]).toBe(`-Dclassifiers=javadoc,sources,`);
    expect(cmdArgs[4]).toBe(`-Dtypes=jar,jar,module`);
    expect(cmdArgs[5]).toMatch(
      new RegExp(`-DpomFile=${tmpDirName}.+pom-default\\.xml`)
    );
    expect(cmdArgs[6]).toBe(`-DrepositoryId=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[7]).toBe(`-Durl=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[8]).toBe(`-Dgpg.passphrase=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[9]).toBe('--settings');
    expect(cmdArgs[10]).toBe(DEFAULT_OPTION_VALUE);
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
    mvnTarget.getPomFileInDist = jest.fn().mockResolvedValueOnce(undefined);

    await mvnTarget.upload('r3v1s10n');

    expect(retrySpawnProcess).toHaveBeenCalledTimes(1);
    const callArgs = (retrySpawnProcess as jest.MockedFunction<
      typeof retrySpawnProcess
    >).mock.calls[0];

    expect(callArgs).toHaveLength(2);
    expect(callArgs[0]).toEqual(DEFAULT_OPTION_VALUE);

    const cmdArgs = callArgs[1] as string[];
    expect(cmdArgs).toHaveLength(8);
    expect(cmdArgs[0]).toBe('gpg:sign-and-deploy-file');
    expect(cmdArgs[1]).toMatch(
      new RegExp(`-Dfile=${tmpDirName}.+${POM_DEFAULT_FILENAME}`)
    );
    expect(cmdArgs[2]).toMatch(
      new RegExp(`-DpomFile=${tmpDirName}.*${POM_DEFAULT_FILENAME}`)
    );
    expect(cmdArgs[3]).toBe(`-DrepositoryId=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[4]).toBe(`-Durl=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[5]).toBe(`-Dgpg.passphrase=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[6]).toBe('--settings');
    expect(cmdArgs[7]).toBe(DEFAULT_OPTION_VALUE);
  });

  test('should skip upload for artifacts without any POM/BOM', async () => {
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
    mvnTarget.getPomFileInDist = jest.fn().mockResolvedValueOnce(undefined);

    await mvnTarget.upload('r3v1s10n');

    expect(retrySpawnProcess).toHaveBeenCalledTimes(0);
  });
});

describe('closeAndReleaseRepository', () => {
  test('should throw if repository is not opened', async () => {
    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = jest.fn(() =>
      Promise.resolve(getRepositoryInfo('closed', false))
    );
    await expect(mvnTarget.closeAndReleaseRepository()).rejects.toThrow();
  });

  test('should call closeRepository and releaseRepository with fetched repository ID', async () => {
    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = jest.fn(() =>
      Promise.resolve(getRepositoryInfo('open', false))
    );
    const callOrder: string[] = [];
    mvnTarget.closeRepository = jest.fn(async () => {
      callOrder.push('closeRepository');
      return true;
    });
    mvnTarget.releaseRepository = jest.fn(async () => {
      callOrder.push('releaseRepository');
      return true;
    });

    await mvnTarget.closeAndReleaseRepository();

    expect(mvnTarget.closeRepository).toHaveBeenCalledWith('sentry-java');
    expect(mvnTarget.releaseRepository).toHaveBeenCalledWith('sentry-java');
    expect(callOrder).toStrictEqual(['closeRepository', 'releaseRepository']);
  });

  test('should not release repostiory if it was not closed properly', async () => {
    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = jest.fn(() =>
      Promise.resolve(getRepositoryInfo('open', false))
    );
    mvnTarget.closeRepository = jest.fn(() => Promise.reject());
    mvnTarget.releaseRepository = jest.fn(() => Promise.resolve(true));

    try {
      await mvnTarget.closeAndReleaseRepository();
    } catch (e) {
      // We only use `closeAndReleaseRepository` to trigger the expected behavior
      // however, the assertion itself is done on `closeRepository` and `releaseRepository`
    }

    expect(mvnTarget.closeRepository).toHaveBeenCalledWith('sentry-java');
    expect(mvnTarget.releaseRepository).not.toHaveBeenCalledWith();
  });
});

describe('getRepository', () => {
  const url = new URL(NEXUS_API_BASE_URL);
  const repositoryInfo = getRepositoryInfo('open', false);

  test('should return the repository if server responds correctly', async () => {
    nock(url.origin)
      .get(`${url.pathname}/profile_repositories`)
      .reply(200, {
        data: [repositoryInfo],
      });

    const mvnTarget = createMavenTarget();
    await expect(mvnTarget.getRepository()).resolves.toStrictEqual(
      repositoryInfo
    );
  });

  test('should throw if server returns no active repositories', async () => {
    nock(url.origin).get(`${url.pathname}/profile_repositories`).reply(200, {
      data: [],
    });

    const mvnTarget = createMavenTarget();
    await expect(mvnTarget.getRepository()).rejects.toThrow(
      new Error('No available repositories. Nothing to publish.')
    );
  });

  test('should throw if server returns more than one active repository', async () => {
    nock(url.origin)
      .get(`${url.pathname}/profile_repositories`)
      .reply(200, {
        data: [repositoryInfo, repositoryInfo],
      });

    const mvnTarget = createMavenTarget();
    await expect(mvnTarget.getRepository()).rejects.toThrow(
      new Error(
        'There are more than 1 active repositories. Please close unwanted deployments.'
      )
    );
  });

  test('should throw if server doesnt accept the request', async () => {
    nock(url.origin).get(`${url.pathname}/profile_repositories`).reply(500);

    const mvnTarget = createMavenTarget();
    await expect(mvnTarget.getRepository()).rejects.toThrow(
      new Error('Unable to fetch repositories: 500, Internal Server Error')
    );
  });
});

describe('closeRepository', () => {
  const url = new URL(NEXUS_API_BASE_URL);
  const repositoryId = 'sentry-java';

  test('should return true if server responds correctly', async () => {
    nock(url.origin)
      .post(`${url.pathname}/bulk/close`, {
        data: { stagedRepositoryIds: [repositoryId] },
      })
      .reply(200);

    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = jest.fn(() =>
      Promise.resolve(getRepositoryInfo('closed', false))
    );

    await expect(mvnTarget.closeRepository(repositoryId)).resolves.toBe(true);
  });

  test('should throw if server doesnt accept the request', async () => {
    nock(url.origin)
      .post(`${url.pathname}/bulk/close`, {
        data: { stagedRepositoryIds: [repositoryId] },
      })
      .reply(500);

    const mvnTarget = createMavenTarget();
    await expect(mvnTarget.closeRepository(repositoryId)).rejects.toThrow(
      new Error(
        'Unable to close repository sentry-java: 500, Internal Server Error'
      )
    );
  });

  test('should wait for the status of repository to be changed', async () => {
    nock(url.origin)
      .post(`${url.pathname}/bulk/close`, {
        data: { stagedRepositoryIds: [repositoryId] },
      })
      .reply(200);

    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = jest
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(getRepositoryInfo('open', false))
      )
      .mockImplementationOnce(() =>
        Promise.resolve(getRepositoryInfo('open', false))
      )
      .mockImplementationOnce(() =>
        Promise.resolve(getRepositoryInfo('closed', false))
      );

    await expect(mvnTarget.closeRepository(repositoryId)).resolves.toBe(true);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(mvnTarget.getRepository).toHaveBeenCalledTimes(3);
  });

  test('should wait for the repository to not be in transitioning state', async () => {
    nock(url.origin)
      .post(`${url.pathname}/bulk/close`, {
        data: { stagedRepositoryIds: [repositoryId] },
      })
      .reply(200);

    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = jest
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(getRepositoryInfo('closed', true))
      )
      .mockImplementationOnce(() =>
        Promise.resolve(getRepositoryInfo('closed', true))
      )
      .mockImplementationOnce(() =>
        Promise.resolve(getRepositoryInfo('closed', false))
      );

    await expect(mvnTarget.closeRepository(repositoryId)).resolves.toBe(true);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(mvnTarget.getRepository).toHaveBeenCalledTimes(3);
  });

  test('should throw when status change deadline is reached', async () => {
    nock(url.origin)
      .post(`${url.pathname}/bulk/close`, {
        data: { stagedRepositoryIds: [repositoryId] },
      })
      .reply(200);

    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = jest.fn(() =>
      Promise.resolve(getRepositoryInfo('open', false))
    );

    // Deadline is 60min, so we fake pooling start time and initial read to 1min
    // and second iteration to something over 60min
    jest
      .spyOn(Date, 'now')
      .mockImplementationOnce(() => 1 * 60 * 1000)
      .mockImplementationOnce(() => 1 * 60 * 1000)
      .mockImplementationOnce(() => 62 * 60 * 1000);

    await expect(mvnTarget.closeRepository(repositoryId)).rejects.toThrow(
      new Error('Deadline for Nexus repository status change reached.')
    );
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(mvnTarget.getRepository).toHaveBeenCalledTimes(1);
  });
});

describe('releaseRepository', () => {
  const url = new URL(NEXUS_API_BASE_URL);
  const repositoryId = 'sentry-java';

  test('should return true if server responds correctly', async () => {
    nock(url.origin)
      .post(`${url.pathname}/bulk/promote`, {
        data: { stagedRepositoryIds: [repositoryId] },
      })
      .reply(200);

    const mvnTarget = createMavenTarget();
    await expect(mvnTarget.releaseRepository(repositoryId)).resolves.toBe(true);
  });

  test('should throw if server doesnt accept the request', async () => {
    nock(url.origin)
      .post(`${url.pathname}/bulk/promote`, {
        data: { stagedRepositoryIds: [repositoryId] },
      })
      .reply(500);

    const mvnTarget = createMavenTarget();
    await expect(mvnTarget.releaseRepository(repositoryId)).rejects.toThrow(
      new Error(
        'Unable to release repository sentry-java: 500, Internal Server Error'
      )
    );
  });
});
