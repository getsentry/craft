import { vi, type Mock, type MockInstance, type Mocked, type MockedFunction } from 'vitest';
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
  CENTRAL_API_BASE_URL,
} from '../maven';
import { retrySpawnProcess, sleep } from '../../utils/async';
import { withTempDir } from '../../utils/files';
import { importGPGKey } from '../../utils/gpg';
import * as fs from 'fs';

vi.mock('../../utils/files');
vi.mock('../../utils/gpg');

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      writeFile: vi.fn(() => Promise.resolve()),
      readFile: vi.fn((file: string) => file),
      mkdir: vi.fn(() => Promise.resolve()),
      readdir: async () => Promise.resolve([]), // empty dir
      unlink: vi.fn(),
    },
  };
});

vi.mock('../../utils/system', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/system')>();
  return {
    ...actual,
    checkExecutableIsPresent: vi.fn(),
    extractZipArchive: vi.fn(),
  };
});

vi.mock('../../utils/async', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/async')>();
  return {
    ...actual,
    retrySpawnProcess: vi.fn(() => Promise.resolve()),
    sleep: vi.fn(() =>
      setTimeout(() => {
        Promise.resolve();
      }, 10)
    ),
  };
});

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
      rootDistDirRegex: '/root-distDir/',
      appleDistDirRegex: '/apple-distDir/',
      klibDistDirRegex: '/klib-distDir/',
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

function getRepositoryInfo(state: NexusRepository['state']): NexusRepository {
  return {
    state,
    repositoryId: 'sentry-java',
    deploymentId: '1234',
  };
}

beforeEach(() => {
  setTargetSecretsInEnv();
});

afterEach(() => {
  removeTargetSecretsFromEnv();
  vi.resetAllMocks();
});

describe('Maven target configuration', () => {
  test('no env vars and no options', () => {
    removeTargetSecretsFromEnv();
    expect(createMavenTarget).toThrowErrorMatchingInlineSnapshot(
      `[Error: Required value(s) GPG_PASSPHRASE not found in configuration files or the environment. See the documentation for more details.]`
    );
  });

  test('env vars without options', () => {
    expect(() => createMavenTarget({})).toThrowErrorMatchingInlineSnapshot(
      `[Error: Required configuration mavenCliPath not found in configuration file. See the documentation for more details.]`
    );
  });

  test('no android config', () => {
    const config = getRequiredTargetConfig();
    delete config.android;
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `[Error: Required Android configuration was not found in the configuration file. See the documentation for more details]`
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
      `[Error: Required Android configuration is incorrect. See the documentation for more details.]`
    );
  });

  test('incorrect one-line kotlinMultiplatform config', () => {
    const config = getRequiredTargetConfig();
    config.kmp = 'yes';
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `[Error: Required root configuration for Kotlin Multiplatform is incorrect. See the documentation for more details.]`
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
      `[Error: Required Android configuration is incorrect. See the documentation for more details.]`
    );
  });

  test('incorrect object kotlinMultiplatform config, replaced root distDir', () => {
    const config = getFullTargetConfig();
    delete config.kmp.rootDistDirRegex;
    config.kmp.anotherParam = 'unused';
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `[Error: Required root configuration for Kotlin Multiplatform is incorrect. See the documentation for more details.]`
    );
  });

  test('incorrect object kotlinMultiplatform config, replaced apple distDir', () => {
    const config = getFullTargetConfig();
    delete config.kmp.appleDistDirRegex;
    config.kmp.anotherParam = 'unused';
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `[Error: Required apple configuration for Kotlin Multiplatform is incorrect. See the documentation for more details.]`
    );
  });

  test('incorrect object android config, replaced prop', () => {
    const config = getFullTargetConfig();
    delete config.android.distDirRegex;
    config.android.anotherParam = 'unused';
    expect(() => createMavenTarget(config)).toThrowErrorMatchingInlineSnapshot(
      `[Error: Required Android configuration is incorrect. See the documentation for more details.]`
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
    expect(typeof mvnTarget.config.kmp.klibDistDirRegex).toBe('string');
  });

  test('import GPG private key if one is present in the environment', async () => {
    setTargetSecretsInEnv();
    process.env.GPG_PRIVATE_KEY = DEFAULT_OPTION_VALUE;
    const callOrder: string[] = [];
    const mvnTarget = createMavenTarget(getFullTargetConfig());
    mvnTarget.upload = vi.fn(async () => void callOrder.push('upload'));
    mvnTarget.closeAndReleaseRepository = vi.fn(
      async () => void callOrder.push('closeAndReleaseRepository')
    );
    await mvnTarget.publish('1.0.0', 'r3v1s10n');
    expect(importGPGKey).toHaveBeenCalledWith(DEFAULT_OPTION_VALUE);
  });
});

describe('publish', () => {
  test('main flow', async () => {
    const callOrder: string[] = [];
    const mvnTarget = createMavenTarget();
    mvnTarget.upload = vi.fn(async () => void callOrder.push('upload'));
    mvnTarget.closeAndReleaseRepository = vi.fn(
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

  test('transform klib distDir target side artifacts', async () => {
    (withTempDir as MockedFunction<typeof withTempDir>).mockImplementation(
      async cb => {
        return await cb(tmpDirName);
      }
    );

    const mvnTarget = createMavenTarget(getFullTargetConfig());
    const files: Record<string, string | string[]> = {
      javadocFile: `${tmpDirName}-javadoc.jar`,
      sourcesFile: `${tmpDirName}-sources.jar`,
      klibFiles: [`${tmpDirName}.klib`],
      allFile: '',
      metadataFile: ``,
      moduleFile: `${tmpDirName}.module`,
    };
    const {
      sideArtifacts,
      classifiers,
      types,
    } = mvnTarget.transformKmpSideArtifacts(false, false, true, files);
    expect(sideArtifacts).toEqual(
      `${files.javadocFile},${files.sourcesFile},${files.klibFiles},${files.moduleFile}`
    );
    expect(classifiers).toEqual('javadoc,sources,,');
    expect(types).toEqual('jar,jar,klib,module');
  });

  test('transform apple target side artifacts', async () => {
    (withTempDir as MockedFunction<typeof withTempDir>).mockImplementation(
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
    } = mvnTarget.transformKmpSideArtifacts(false, true, false, files);
    expect(sideArtifacts).toEqual(
      `${files.javadocFile},${files.sourcesFile},${files.klibFiles},${files.metadataFile},${files.moduleFile}`
    );
    expect(classifiers).toEqual(
      'javadoc,sources,cinterop-Sentry.NSException,cinterop-Sentry,metadata,'
    );
    expect(types).toEqual('jar,jar,klib,klib,jar,module');
  });

  test('transform root target side artifacts', async () => {
    (withTempDir as MockedFunction<typeof withTempDir>).mockImplementation(
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
    } = mvnTarget.transformKmpSideArtifacts(true, false, false, files);
    expect(sideArtifacts).toEqual(
      `${files.javadocFile},${files.sourcesFile},${files.allFile},${files.kotlinToolingMetadataFile},${files.moduleFile}`
    );
    expect(classifiers).toEqual('javadoc,sources,all,kotlin-tooling-metadata,');
    expect(types).toEqual('jar,jar,jar,json,module');
  });
});

describe('upload', () => {
  const tmpDirName = 'tmpDir';

  test('upload POM for Maven', async () => {
    // simple mock to always use the same temporary directory,
    // instead of creating a new one
    (withTempDir as MockedFunction<typeof withTempDir>).mockImplementation(
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
    mvnTarget.isBomFile = vi.fn().mockResolvedValueOnce(false);
    mvnTarget.getPomFileInDist = jest
      .fn()
      .mockResolvedValueOnce('pom-default.xml');

    await mvnTarget.upload('r3v1s10n');

    expect(retrySpawnProcess).toHaveBeenCalledTimes(1);
    const callArgs = (retrySpawnProcess as MockedFunction<
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
        `-Dfiles=${tmpDirName}.+-javadoc\\.jar,${tmpDirName}.+-sources\\.jar`
      )
    );
    expect(cmdArgs[3]).toBe(`-Dclassifiers=javadoc,sources`);
    expect(cmdArgs[4]).toBe(`-Dtypes=jar,jar`);
    expect(cmdArgs[5]).toMatch(
      new RegExp(`-DpomFile=${tmpDirName}.+pom-default\\.xml`)
    );
    expect(cmdArgs[6]).toBe(`-DrepositoryId=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[7]).toBe(`-Durl=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[8]).toBe(`-Dgpg.passphrase=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[9]).toBe('--settings');
    expect(cmdArgs[10]).toBe(DEFAULT_OPTION_VALUE);
  });

  test('upload POM for Gradle', async () => {
    // simple mock to always use the same temporary directory,
    // instead of creating a new one
    (withTempDir as MockedFunction<typeof withTempDir>).mockImplementation(
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
    mvnTarget.isBomFile = vi.fn().mockResolvedValueOnce(false);
    mvnTarget.getPomFileInDist = jest
      .fn()
      .mockResolvedValueOnce('pom-default.xml');
    mvnTarget.fileExists = vi.fn().mockResolvedValue(true);

    await mvnTarget.upload('r3v1s10n');

    expect(retrySpawnProcess).toHaveBeenCalledTimes(1);
    const callArgs = (retrySpawnProcess as MockedFunction<
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
    (withTempDir as MockedFunction<typeof withTempDir>).mockImplementation(
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
    mvnTarget.isBomFile = vi.fn().mockResolvedValueOnce('path/to/bomfile');
    mvnTarget.getPomFileInDist = vi.fn().mockResolvedValueOnce(undefined);

    await mvnTarget.upload('r3v1s10n');

    expect(retrySpawnProcess).toHaveBeenCalledTimes(1);
    const callArgs = (retrySpawnProcess as MockedFunction<
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
    (withTempDir as MockedFunction<typeof withTempDir>).mockImplementation(
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

    mvnTarget.isBomFile = vi.fn().mockResolvedValueOnce(false);
    mvnTarget.getPomFileInDist = vi.fn().mockResolvedValueOnce(undefined);

    await mvnTarget.upload('r3v1s10n');

    expect(retrySpawnProcess).toHaveBeenCalledTimes(0);
  });

  test('upload KMP klib-only distribution', async () => {
    const klibDistDirName = 'sentry-klib-distDir-linuxx64-1.0.0'; // matches klib regex
    const klibDistDir = `${tmpDirName}/${klibDistDirName}`;

    (withTempDir as MockedFunction<typeof withTempDir>).mockImplementation(
      async cb => {
        return await cb(tmpDirName);
      }
    );

    // Override fs.promises.readdir for this test to return klib files
    const readdirSpy = jest
      .spyOn(fs.promises, 'readdir')
      .mockImplementation((dirPath: any) => {
        if (dirPath.toString().includes(klibDistDirName)) {
          return Promise.resolve([
            `${klibDistDirName}-javadoc.jar`,
            `${klibDistDirName}.klib`,
            `${klibDistDirName}-sources.jar`,
            `${klibDistDirName}.module`,
            POM_DEFAULT_FILENAME,
          ] as any);
        }
        return Promise.resolve([] as any);
      });

    const mvnTarget = createMavenTarget(getFullTargetConfig());
    mvnTarget.getArtifactsForRevision = jest
      .fn()
      .mockResolvedValueOnce([{ filename: `${klibDistDirName}.zip` }]);
    mvnTarget.artifactProvider.downloadArtifact = jest
      .fn()
      .mockResolvedValueOnce('artifact/download/path');
    mvnTarget.isBomFile = vi.fn().mockResolvedValueOnce(false);
    mvnTarget.getPomFileInDist = jest
      .fn()
      .mockResolvedValueOnce('pom-default.xml');
    mvnTarget.fileExists = vi.fn().mockResolvedValue(true);

    await mvnTarget.upload('r3v1s10n');

    expect(retrySpawnProcess).toHaveBeenCalledTimes(1);
    const callArgs = (retrySpawnProcess as MockedFunction<
      typeof retrySpawnProcess
    >).mock.calls[0];

    expect(callArgs).toHaveLength(2);
    expect(callArgs[0]).toEqual(DEFAULT_OPTION_VALUE);

    const cmdArgs = callArgs[1] as string[];
    expect(cmdArgs).toHaveLength(11);
    expect(cmdArgs[0]).toBe('gpg:sign-and-deploy-file');
    expect(cmdArgs[1]).toMatch(
      new RegExp(`-Dfile=${klibDistDir}/${klibDistDirName}`)
    );
    expect(cmdArgs[2]).toBe(
      `-Dfiles=${klibDistDir}/${klibDistDirName}-javadoc.jar,${klibDistDir}/${klibDistDirName}-sources.jar,${klibDistDir}/${klibDistDirName}.klib,${klibDistDir}/${klibDistDirName}.module`
    );
    expect(cmdArgs[3]).toBe(`-Dclassifiers=javadoc,sources,,`);
    expect(cmdArgs[4]).toBe(`-Dtypes=jar,jar,klib,module`);
    expect(cmdArgs[5]).toMatch(
      new RegExp(`-DpomFile=${klibDistDir}/pom-default\\.xml`)
    );
    expect(cmdArgs[6]).toBe(`-DrepositoryId=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[7]).toBe(`-Durl=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[8]).toBe(`-Dgpg.passphrase=${DEFAULT_OPTION_VALUE}`);
    expect(cmdArgs[9]).toBe('--settings');
    expect(cmdArgs[10]).toBe(DEFAULT_OPTION_VALUE);

    // Restore original mock
    readdirSpy.mockRestore();
  });
});

describe('closeAndReleaseRepository', () => {
  test('should throw if repository is not opened', async () => {
    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = vi.fn(() =>
      Promise.resolve(getRepositoryInfo('closed'))
    );
    await expect(mvnTarget.closeAndReleaseRepository()).rejects.toThrow();
  });

  test('should call closeRepository and releaseRepository with fetched repository ID', async () => {
    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = vi.fn(() =>
      Promise.resolve(getRepositoryInfo('open'))
    );
    const callOrder: string[] = [];
    mvnTarget.closeRepository = vi.fn(async () => {
      callOrder.push('closeRepository');
      return true;
    });
    mvnTarget.releaseRepository = vi.fn(async () => {
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
    mvnTarget.getRepository = vi.fn(() =>
      Promise.resolve(getRepositoryInfo('open'))
    );
    mvnTarget.closeRepository = vi.fn(() => Promise.reject());
    mvnTarget.releaseRepository = vi.fn(() => Promise.resolve(true));

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
  const repositoryInfo = getRepositoryInfo('open');

  test('should return the repository if server responds correctly', async () => {
    nock(url.origin)
      .get('/manual/search/repositories')
      .reply(200, {
        repositories: [
          { key: 'sentry-java', state: 'open', portal_deployment_id: '1234' },
        ],
      });

    const mvnTarget = createMavenTarget();
    await expect(mvnTarget.getRepository()).resolves.toStrictEqual(
      repositoryInfo
    );
  });

  test('should throw if server returns no active repositories', async () => {
    nock(url.origin).get('/manual/search/repositories').reply(200, {
      repositories: [],
    });

    const mvnTarget = createMavenTarget();
    await expect(mvnTarget.getRepository()).rejects.toThrow(
      new Error('No available repositories. Nothing to publish.')
    );
  });

  test('should throw if server returns more than one active repository', async () => {
    nock(url.origin)
      .get('/manual/search/repositories')
      .reply(200, {
        repositories: [repositoryInfo, repositoryInfo],
      });

    const mvnTarget = createMavenTarget();
    await expect(mvnTarget.getRepository()).rejects.toThrow(
      new Error(
        'There are more than 1 active repositories. Please close unwanted deployments.'
      )
    );
  });

  test('should throw if server doesnt accept the request', async () => {
    nock(url.origin).get('/manual/search/repositories').reply(500);

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
      .post('/service/local/staging/bulk/close', {
        data: {
          stagedRepositoryIds: [repositoryId],
          description: '',
          autoDropAfterRelease: true,
        },
      })
      .reply(200);

    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = vi.fn(() =>
      Promise.resolve(getRepositoryInfo('closed'))
    );

    await expect(mvnTarget.closeRepository(repositoryId)).resolves.toBe(true);
  });

  test('should throw if server doesnt accept the request', async () => {
    nock(url.origin)
      .post('/service/local/staging/bulk/close', {
        data: {
          stagedRepositoryIds: [repositoryId],
          description: '',
          autoDropAfterRelease: true,
        },
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
      .post('/service/local/staging/bulk/close', {
        data: {
          stagedRepositoryIds: [repositoryId],
          description: '',
          autoDropAfterRelease: true,
        },
      })
      .reply(200);

    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve(getRepositoryInfo('open')))
      .mockImplementationOnce(() => Promise.resolve(getRepositoryInfo('open')))
      .mockImplementationOnce(() =>
        Promise.resolve(getRepositoryInfo('closed'))
      );

    await expect(mvnTarget.closeRepository(repositoryId)).resolves.toBe(true);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(mvnTarget.getRepository).toHaveBeenCalledTimes(3);
  });

  test('should throw when status change deadline is reached', async () => {
    nock(url.origin)
      .post('/service/local/staging/bulk/close', {
        data: {
          stagedRepositoryIds: [repositoryId],
          description: '',
          autoDropAfterRelease: true,
        },
      })
      .reply(200);

    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = vi.fn(() =>
      Promise.resolve(getRepositoryInfo('open'))
    );

    // Deadline is 2h, so we fake pooling start time and initial read to 1min
    // and second iteration to something over 2h
    jest
      .spyOn(Date, 'now')
      .mockImplementationOnce(() => 1 * 60 * 1000)
      .mockImplementationOnce(() => 1 * 60 * 1000)
      .mockImplementationOnce(() => 122 * 60 * 1000);

    await expect(mvnTarget.closeRepository(repositoryId)).rejects.toThrow(
      new Error('Deadline for Nexus repository status change reached.')
    );
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(mvnTarget.getRepository).toHaveBeenCalledTimes(1);
  });
});

describe('releaseRepository', () => {
  const url = new URL(NEXUS_API_BASE_URL);
  const centralUrl = new URL(CENTRAL_API_BASE_URL);
  const repositoryId = 'sentry-java';
  const deploymentId = '1234';

  test('should return true if server responds correctly', async () => {
    nock(url.origin)
      .post('/service/local/staging/bulk/promote', {
        data: {
          stagedRepositoryIds: [repositoryId],
          description: '',
          autoDropAfterRelease: true,
        },
      })
      .reply(200);

    nock(centralUrl.origin)
      .post(`${centralUrl.pathname}/publisher/status?id=${deploymentId}`)
      .reply(200, {
        deploymentState: 'PUBLISHED',
      });

    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = vi.fn(() =>
      Promise.resolve(getRepositoryInfo('closed'))
    );
    await expect(mvnTarget.releaseRepository(repositoryId)).resolves.toBe(true);
  });

  test('should throw if server doesnt accept the request', async () => {
    nock(url.origin)
      .post('/service/local/staging/bulk/promote', {
        data: {
          stagedRepositoryIds: [repositoryId],
          description: '',
          autoDropAfterRelease: true,
        },
      })
      .reply(500);

    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = vi.fn(() =>
      Promise.resolve(getRepositoryInfo('closed'))
    );
    await expect(mvnTarget.releaseRepository(repositoryId)).rejects.toThrow(
      new Error(
        'Unable to release repository sentry-java: 500, Internal Server Error'
      )
    );
  });

  test('should wait for the status of deployment to be changed', async () => {
    nock(url.origin)
      .post('/service/local/staging/bulk/promote', {
        data: {
          stagedRepositoryIds: [repositoryId],
          description: '',
          autoDropAfterRelease: true,
        },
      })
      .reply(200);

    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = vi.fn(() =>
      Promise.resolve(getRepositoryInfo('closed'))
    );

    nock(centralUrl.origin)
      .post(`${centralUrl.pathname}/publisher/status?id=${deploymentId}`)
      .reply(200, {
        deploymentState: 'VALIDATED',
      })
      .post(`${centralUrl.pathname}/publisher/status?id=${deploymentId}`)
      .reply(200, {
        deploymentState: 'PUBLISHING',
      })
      .post(`${centralUrl.pathname}/publisher/status?id=${deploymentId}`)
      .reply(200, {
        deploymentState: 'PUBLISHED',
      });

    await expect(mvnTarget.releaseRepository(repositoryId)).resolves.toBe(true);
  });

  test('should throw if deadline is reached', async () => {
    nock(url.origin)
      .post('/service/local/staging/bulk/promote', {
        data: {
          stagedRepositoryIds: [repositoryId],
          description: '',
          autoDropAfterRelease: true,
        },
      })
      .reply(200);

    const mvnTarget = createMavenTarget();
    mvnTarget.getRepository = vi.fn(() =>
      Promise.resolve(getRepositoryInfo('closed'))
    );

    nock(centralUrl.origin)
      .post(`${centralUrl.pathname}/publisher/status?id=${deploymentId}`)
      .reply(200, {
        deploymentState: 'PUBLISHING',
      });

    // Deadline is 2h, so we fake pooling start time and initial read to 1min
    // and second iteration to something over 2h
    jest
      .spyOn(Date, 'now')
      .mockImplementationOnce(() => 1 * 60 * 1000)
      .mockImplementationOnce(() => 1 * 60 * 1000)
      .mockImplementationOnce(() => 122 * 60 * 1000);

    await expect(mvnTarget.releaseRepository(repositoryId)).rejects.toThrow(
      new Error('Deadline for Central repository status change reached.')
    );
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(mvnTarget.getRepository).toHaveBeenCalledTimes(1);
  });
});
