import { vi, type MockInstance } from 'vitest';
import {
  getPublishTag,
  getLatestVersion,
  NpmTarget,
  NpmPackageAccess,
  NPM_BIN,
  YARN_BIN,
} from '../npm';
import type { BaseArtifactProvider } from '../../artifact_providers/base';
import type { SemVer } from '../../utils/version';
import * as system from '../../utils/system';
import * as workspaces from '../../utils/workspaces';

const defaultNpmConfig = {
  useYarn: false,
  token: 'xxx',
  useOidc: false,
};

const oidcNpmConfigNoToken = {
  useYarn: false,
  token: undefined,
  useOidc: true,
};

describe('getLatestVersion', () => {
  let spawnProcessMock: MockInstance;

  beforeEach(() => {
    spawnProcessMock = vi
      .spyOn(system, 'spawnProcess')
      .mockImplementation(() => Promise.reject('does not exist'));
  });

  afterEach(() => {
    spawnProcessMock.mockReset();
  });

  it('returns undefined if package name does not exist', async () => {
    const actual = await getLatestVersion(
      'sentry-xx-this-does-not-exist',
      defaultNpmConfig,
    );
    expect(actual).toEqual(undefined);
    expect(spawnProcessMock).toBeCalledTimes(1);
    expect(spawnProcessMock).toBeCalledWith(
      'npm',
      ['info', 'sentry-xx-this-does-not-exist', 'version'],
      expect.objectContaining({}),
    );
  });

  it('returns version for valid package name', async () => {
    spawnProcessMock = vi
      .spyOn(system, 'spawnProcess')
      .mockImplementation(() =>
        Promise.resolve(Buffer.from('7.20.0\n', 'utf-8')),
      );
    const actual = await getLatestVersion('@sentry/browser', defaultNpmConfig);
    expect(actual).toBe('7.20.0');
    expect(spawnProcessMock).toBeCalledTimes(1);
    expect(spawnProcessMock).toBeCalledWith(
      'npm',
      ['info', '@sentry/browser', 'version'],
      expect.objectContaining({}),
    );
  });
});

describe('getPublishTag', () => {
  let spawnProcessMock: MockInstance;

  beforeEach(() => {
    spawnProcessMock = vi
      .spyOn(system, 'spawnProcess')
      .mockImplementation(() => Promise.reject('does not exist'));
  });

  afterEach(() => {
    spawnProcessMock.mockReset();
  });

  it('returns undefined without a checkPackageName', async () => {
    const logger = {
      warn: vi.fn(),
    } as any;
    const actual = await getPublishTag(
      '1.0.0',
      undefined,
      defaultNpmConfig,
      logger,
    );
    expect(actual).toEqual(undefined);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(spawnProcessMock).not.toBeCalled();
  });

  it('returns undefined for unexisting package name', async () => {
    const logger = {
      warn: vi.fn(),
    } as any;
    const actual = await getPublishTag(
      '1.0.0',
      'sentry-xx-does-not-exist',
      defaultNpmConfig,
      logger,
    );
    expect(actual).toEqual(undefined);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not fetch current version for package sentry-xx-does-not-exist',
    );
    expect(spawnProcessMock).toBeCalledTimes(1);
  });

  it('returns undefined for invalid package version', async () => {
    spawnProcessMock = vi
      .spyOn(system, 'spawnProcess')
      .mockImplementation(() =>
        Promise.resolve(Buffer.from('weird-version', 'utf-8')),
      );

    const logger = {
      warn: vi.fn(),
    } as any;
    const actual = await getPublishTag(
      '1.0.0',
      '@sentry/browser',
      defaultNpmConfig,
      logger,
    );
    expect(actual).toEqual(undefined);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not fetch current version for package @sentry/browser',
    );
    expect(spawnProcessMock).toBeCalledTimes(1);
  });

  it('returns next for prereleases', async () => {
    const logger = {
      warn: vi.fn(),
    } as any;
    const actual = await getPublishTag(
      '1.0.0-alpha.1',
      undefined,
      defaultNpmConfig,
      logger,
    );
    expect(actual).toBe('next');
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Detected pre-release version for npm package!',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Adding tag "next" to not make it "latest" in registry.',
    );
    expect(spawnProcessMock).not.toBeCalled();
  });

  it('returns old for older versions', async () => {
    spawnProcessMock = vi
      .spyOn(system, 'spawnProcess')
      .mockImplementation(() =>
        Promise.resolve(Buffer.from('7.20.0\n', 'utf-8')),
      );

    const logger = {
      warn: vi.fn(),
    } as any;

    const actual = await getPublishTag(
      '1.0.0',
      '@sentry/browser',
      defaultNpmConfig,
      logger,
    );
    expect(actual).toBe('old');
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /Detected older version than currently published version \(([\d.]+)\) for @sentry\/browser/,
      ),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Adding tag "old" to not make it "latest" in registry.',
    );
    expect(spawnProcessMock).toBeCalledTimes(1);
  });
});

describe('NpmTarget.expand', () => {
  let discoverWorkspacesMock: MockInstance;

  afterEach(() => {
    discoverWorkspacesMock?.mockRestore();
  });

  it('returns config as-is when workspaces is not enabled', async () => {
    const config = { name: 'npm', id: '@sentry/browser' };
    const result = await NpmTarget.expand(config, '/root');

    expect(result).toEqual([config]);
  });

  it('throws error when public package depends on private workspace package', async () => {
    discoverWorkspacesMock = vi
      .spyOn(workspaces, 'discoverWorkspaces')
      .mockResolvedValue({
        type: 'npm',
        packages: [
          {
            name: '@sentry/browser',
            location: '/root/packages/browser',
            private: false,
            hasPublicAccess: true,
            workspaceDependencies: ['@sentry/core', '@sentry-internal/utils'],
          },
          {
            name: '@sentry/core',
            location: '/root/packages/core',
            private: false,
            hasPublicAccess: true,
            workspaceDependencies: [],
          },
          {
            name: '@sentry-internal/utils',
            location: '/root/packages/utils',
            private: true, // This is private!
            hasPublicAccess: false,
            workspaceDependencies: [],
          },
        ],
      });

    const config = { name: 'npm', workspaces: true };

    await expect(NpmTarget.expand(config, '/root')).rejects.toThrow(
      /Public package "@sentry\/browser" depends on private workspace package\(s\): @sentry-internal\/utils/,
    );
  });

  it('allows public packages to depend on other public packages', async () => {
    discoverWorkspacesMock = vi
      .spyOn(workspaces, 'discoverWorkspaces')
      .mockResolvedValue({
        type: 'npm',
        packages: [
          {
            name: '@sentry/browser',
            location: '/root/packages/browser',
            private: false,
            hasPublicAccess: true,
            workspaceDependencies: ['@sentry/core'],
          },
          {
            name: '@sentry/core',
            location: '/root/packages/core',
            private: false,
            hasPublicAccess: true,
            workspaceDependencies: [],
          },
        ],
      });

    const config = { name: 'npm', workspaces: true };
    const result = await NpmTarget.expand(config, '/root');

    // Should return targets in dependency order (core before browser)
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('@sentry/core');
    expect(result[1].id).toBe('@sentry/browser');
  });

  it('excludes private packages from expanded targets', async () => {
    discoverWorkspacesMock = vi
      .spyOn(workspaces, 'discoverWorkspaces')
      .mockResolvedValue({
        type: 'npm',
        packages: [
          {
            name: '@sentry/browser',
            location: '/root/packages/browser',
            private: false,
            hasPublicAccess: true,
            workspaceDependencies: [],
          },
          {
            name: '@sentry-internal/test-utils',
            location: '/root/packages/test-utils',
            private: true,
            hasPublicAccess: false,
            workspaceDependencies: [],
          },
        ],
      });

    const config = { name: 'npm', workspaces: true };
    const result = await NpmTarget.expand(config, '/root');

    // Should only include the public package
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('@sentry/browser');
  });

  it('propagates excludeNames and other options to expanded targets', async () => {
    discoverWorkspacesMock = vi
      .spyOn(workspaces, 'discoverWorkspaces')
      .mockResolvedValue({
        type: 'npm',
        packages: [
          {
            name: '@sentry/browser',
            location: '/root/packages/browser',
            private: false,
            hasPublicAccess: true,
            workspaceDependencies: [],
          },
          {
            name: '@sentry/node',
            location: '/root/packages/node',
            private: false,
            hasPublicAccess: true,
            workspaceDependencies: [],
          },
        ],
      });

    const config = {
      name: 'npm',
      workspaces: true,
      excludeNames: '/.*-debug\\.tgz$/',
      access: NpmPackageAccess.PUBLIC,
      checkPackageName: '@sentry/browser',
    };
    const result = await NpmTarget.expand(config, '/root');

    expect(result).toHaveLength(2);

    // Both expanded targets should have the propagated options
    for (const target of result) {
      expect(target.excludeNames).toBe('/.*-debug\\.tgz$/');
      expect(target.access).toBe(NpmPackageAccess.PUBLIC);
      expect(target.checkPackageName).toBe('@sentry/browser');
    }
  });

  it('propagates oidc option to expanded workspace targets', async () => {
    discoverWorkspacesMock = vi
      .spyOn(workspaces, 'discoverWorkspaces')
      .mockResolvedValue({
        type: 'npm',
        packages: [
          {
            name: '@sentry/browser',
            location: '/root/packages/browser',
            private: false,
            hasPublicAccess: true,
            workspaceDependencies: [],
          },
        ],
      });

    const config = { name: 'npm', workspaces: true, oidc: true };
    const result = await NpmTarget.expand(config, '/root');

    expect(result).toHaveLength(1);
    expect((result[0] as any).oidc).toBe(true);
  });
});

describe('getLatestVersion OIDC mode', () => {
  let spawnProcessMock: MockInstance;

  beforeEach(() => {
    spawnProcessMock = vi
      .spyOn(system, 'spawnProcess')
      .mockResolvedValue(Buffer.from('7.20.0\n', 'utf-8'));
  });

  afterEach(() => {
    spawnProcessMock.mockRestore();
  });

  it('calls spawnProcess without auth when no token is available', async () => {
    await getLatestVersion('@sentry/browser', oidcNpmConfigNoToken);

    expect(spawnProcessMock).toBeCalledTimes(1);
    const spawnOptions = spawnProcessMock.mock.calls[0][2];
    expect(spawnOptions.env).not.toHaveProperty('npm_config_userconfig');
    expect(spawnOptions.env).not.toHaveProperty('NPM_TOKEN');
  });

  it('uses temp .npmrc auth when token is available', async () => {
    await getLatestVersion('@sentry/browser', defaultNpmConfig);

    expect(spawnProcessMock).toBeCalledTimes(1);
    const spawnOptions = spawnProcessMock.mock.calls[0][2];
    expect(spawnOptions.env).toHaveProperty('npm_config_userconfig');
    expect(spawnOptions.env).toHaveProperty('NPM_TOKEN', 'xxx');
  });

  it('returns version when called without token', async () => {
    const actual = await getLatestVersion(
      '@sentry/browser',
      oidcNpmConfigNoToken,
    );
    expect(actual).toBe('7.20.0');
  });

  it('returns undefined when npm info fails in no-token mode', async () => {
    spawnProcessMock.mockRejectedValue(new Error('not found'));
    const actual = await getLatestVersion(
      '@sentry/private-pkg',
      oidcNpmConfigNoToken,
    );
    expect(actual).toBeUndefined();
  });
});

describe('NpmTarget OIDC configuration', () => {
  // child_process.spawnSync cannot be spied on in ESM. Instead, use a TestNpmTarget
  // subclass that overrides checkRequirements() to inject a controllable npm version
  // and delegates hasExecutable() to the mockable system module.
  class TestNpmTarget extends NpmTarget {
    /** Set before construction to control which npm version checkRequirements reports */
    static mockVersion: SemVer = { major: 12, minor: 0, patch: 0 };

    protected override checkRequirements(): void {
      const config = this.config as { oidc?: boolean };
      if (system.hasExecutable(NPM_BIN)) {
        this.npmVersion = TestNpmTarget.mockVersion;
      } else if (system.hasExecutable(YARN_BIN)) {
        if (config.oidc) {
          throw new Error(
            'npm target: OIDC trusted publishing requires npm, but only yarn was found. ' +
              'Install npm >= 11.5.1 to use OIDC.',
          );
        }
      } else {
        throw new Error('No "npm" or "yarn" found!');
      }
    }
  }

  let hasExecutableMock: MockInstance;
  const mockArtifactProvider = {} as BaseArtifactProvider;

  beforeEach(() => {
    // Default: npm 12.0.0 available; reset mock version to avoid cross-test pollution
    TestNpmTarget.mockVersion = { major: 12, minor: 0, patch: 0 };
    hasExecutableMock = vi
      .spyOn(system, 'hasExecutable')
      .mockImplementation((bin: string) => bin === NPM_BIN);
  });

  afterEach(() => {
    hasExecutableMock.mockRestore();
    vi.unstubAllEnvs();
  });

  it('uses token auth when NPM_TOKEN is set (backward compat, no OIDC env)', () => {
    vi.stubEnv('NPM_TOKEN', 'my-token');
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_URL', '');
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', '');
    vi.stubEnv('NPM_ID_TOKEN', '');

    const target = new TestNpmTarget({ name: 'npm' }, mockArtifactProvider);
    expect(target.npmConfig.useOidc).toBe(false);
    expect(target.npmConfig.token).toBe('my-token');
  });

  it('auto-detects OIDC via GitHub Actions env vars when NPM_TOKEN is absent', () => {
    vi.stubEnv('NPM_TOKEN', '');
    vi.stubEnv(
      'ACTIONS_ID_TOKEN_REQUEST_URL',
      'https://token.actions.githubusercontent.com',
    );
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'gha-token');

    const target = new TestNpmTarget({ name: 'npm' }, mockArtifactProvider);
    expect(target.npmConfig.useOidc).toBe(true);
    expect(target.npmConfig.token).toBeUndefined();
  });

  it('auto-detects OIDC via GitLab env var when NPM_TOKEN is absent', () => {
    vi.stubEnv('NPM_TOKEN', '');
    vi.stubEnv('NPM_ID_TOKEN', 'gitlab-oidc-token');

    const target = new TestNpmTarget({ name: 'npm' }, mockArtifactProvider);
    expect(target.npmConfig.useOidc).toBe(true);
    expect(target.npmConfig.token).toBeUndefined();
  });

  it('token auth wins when NPM_TOKEN is set even if OIDC env vars are present', () => {
    vi.stubEnv('NPM_TOKEN', 'my-token');
    vi.stubEnv(
      'ACTIONS_ID_TOKEN_REQUEST_URL',
      'https://token.actions.githubusercontent.com',
    );
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'gha-token');

    const target = new TestNpmTarget({ name: 'npm' }, mockArtifactProvider);
    expect(target.npmConfig.useOidc).toBe(false);
    expect(target.npmConfig.token).toBe('my-token');
  });

  it('forces OIDC when oidc: true is set, even when NPM_TOKEN is present', () => {
    vi.stubEnv('NPM_TOKEN', 'my-token');

    const target = new TestNpmTarget(
      { name: 'npm', oidc: true },
      mockArtifactProvider,
    );
    expect(target.npmConfig.useOidc).toBe(true);
    // Token is still stored so getLatestVersion can use it for private packages
    expect(target.npmConfig.token).toBe('my-token');
  });

  it('throws when oidc: true and npm version is too old', () => {
    TestNpmTarget.mockVersion = { major: 5, minor: 6, patch: 0 };

    expect(
      () =>
        new TestNpmTarget({ name: 'npm', oidc: true }, mockArtifactProvider),
    ).toThrow(/npm >= 11\.5\.1/);
  });

  it('throws when oidc: true and only yarn is available', () => {
    hasExecutableMock.mockImplementation((bin: string) => bin === YARN_BIN);

    expect(
      () =>
        new TestNpmTarget({ name: 'npm', oidc: true }, mockArtifactProvider),
    ).toThrow(/OIDC trusted publishing requires npm/);
  });

  it('throws when no NPM_TOKEN and no OIDC environment', () => {
    vi.stubEnv('NPM_TOKEN', '');
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_URL', '');
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', '');
    vi.stubEnv('NPM_ID_TOKEN', '');

    expect(
      () => new TestNpmTarget({ name: 'npm' }, mockArtifactProvider),
    ).toThrow('NPM_TOKEN not found');
  });

  it('falls through to token error when OIDC env detected but npm version is too old', () => {
    TestNpmTarget.mockVersion = { major: 5, minor: 6, patch: 0 };
    vi.stubEnv('NPM_TOKEN', '');
    vi.stubEnv(
      'ACTIONS_ID_TOKEN_REQUEST_URL',
      'https://token.actions.githubusercontent.com',
    );
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'gha-token');

    // OIDC env present but npm too old → should fall through to "NPM_TOKEN not found"
    expect(
      () => new TestNpmTarget({ name: 'npm' }, mockArtifactProvider),
    ).toThrow('NPM_TOKEN not found');
  });
});
