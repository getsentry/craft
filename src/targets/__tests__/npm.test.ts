import { getPublishTag, getLatestVersion, NpmTarget } from '../npm';
import * as system from '../../utils/system';
import * as workspaces from '../../utils/workspaces';

const defaultNpmConfig = {
  useYarn: false,
  token: 'xxx',
};

describe('getLatestVersion', () => {
  let spawnProcessMock: jest.SpyInstance;

  beforeEach(() => {
    spawnProcessMock = jest
      .spyOn(system, 'spawnProcess')
      .mockImplementation(() => Promise.reject('does not exist'));
  });

  afterEach(() => {
    spawnProcessMock.mockReset();
  });

  it('returns undefined if package name does not exist', async () => {
    const actual = await getLatestVersion(
      'sentry-xx-this-does-not-exist',
      defaultNpmConfig
    );
    expect(actual).toEqual(undefined);
    expect(spawnProcessMock).toBeCalledTimes(1);
    expect(spawnProcessMock).toBeCalledWith(
      'npm',
      ['info', 'sentry-xx-this-does-not-exist', 'version'],
      expect.objectContaining({})
    );
  });

  it('returns version for valid package name', async () => {
    spawnProcessMock = jest
      .spyOn(system, 'spawnProcess')
      .mockImplementation(() =>
        Promise.resolve(Buffer.from('7.20.0\n', 'utf-8'))
      );
    const actual = await getLatestVersion('@sentry/browser', defaultNpmConfig);
    expect(actual).toBe('7.20.0');
    expect(spawnProcessMock).toBeCalledTimes(1);
    expect(spawnProcessMock).toBeCalledWith(
      'npm',
      ['info', '@sentry/browser', 'version'],
      expect.objectContaining({})
    );
  });
});

describe('getPublishTag', () => {
  let spawnProcessMock: jest.SpyInstance;

  beforeEach(() => {
    spawnProcessMock = jest
      .spyOn(system, 'spawnProcess')
      .mockImplementation(() => Promise.reject('does not exist'));
  });

  afterEach(() => {
    spawnProcessMock.mockReset();
  });

  it('returns undefined without a checkPackageName', async () => {
    const logger = {
      warn: jest.fn(),
    } as any;
    const actual = await getPublishTag(
      '1.0.0',
      undefined,
      defaultNpmConfig,
      logger
    );
    expect(actual).toEqual(undefined);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(spawnProcessMock).not.toBeCalled();
  });

  it('returns undefined for unexisting package name', async () => {
    const logger = {
      warn: jest.fn(),
    } as any;
    const actual = await getPublishTag(
      '1.0.0',
      'sentry-xx-does-not-exist',
      defaultNpmConfig,
      logger
    );
    expect(actual).toEqual(undefined);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not fetch current version for package sentry-xx-does-not-exist'
    );
    expect(spawnProcessMock).toBeCalledTimes(1);
  });

  it('returns undefined for invalid package version', async () => {
    spawnProcessMock = jest
      .spyOn(system, 'spawnProcess')
      .mockImplementation(() =>
        Promise.resolve(Buffer.from('weird-version', 'utf-8'))
      );

    const logger = {
      warn: jest.fn(),
    } as any;
    const actual = await getPublishTag(
      '1.0.0',
      '@sentry/browser',
      defaultNpmConfig,
      logger
    );
    expect(actual).toEqual(undefined);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not fetch current version for package @sentry/browser'
    );
    expect(spawnProcessMock).toBeCalledTimes(1);
  });

  it('returns next for prereleases', async () => {
    const logger = {
      warn: jest.fn(),
    } as any;
    const actual = await getPublishTag(
      '1.0.0-alpha.1',
      undefined,
      defaultNpmConfig,
      logger
    );
    expect(actual).toBe('next');
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Detected pre-release version for npm package!'
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Adding tag "next" to not make it "latest" in registry.'
    );
    expect(spawnProcessMock).not.toBeCalled();
  });

  it('returns old for older versions', async () => {
    spawnProcessMock = jest
      .spyOn(system, 'spawnProcess')
      .mockImplementation(() =>
        Promise.resolve(Buffer.from('7.20.0\n', 'utf-8'))
      );

    const logger = {
      warn: jest.fn(),
    } as any;

    const actual = await getPublishTag(
      '1.0.0',
      '@sentry/browser',
      defaultNpmConfig,
      logger
    );
    expect(actual).toBe('old');
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /Detected older version than currently published version \(([\d.]+)\) for @sentry\/browser/
      )
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Adding tag "old" to not make it "latest" in registry.'
    );
    expect(spawnProcessMock).toBeCalledTimes(1);
  });
});

describe('NpmTarget.expand', () => {
  let discoverWorkspacesMock: jest.SpyInstance;

  afterEach(() => {
    discoverWorkspacesMock?.mockRestore();
  });

  it('returns config as-is when workspaces is not enabled', async () => {
    const config = { name: 'npm', id: '@sentry/browser' };
    const result = await NpmTarget.expand(config, '/root');

    expect(result).toEqual([config]);
  });

  it('throws error when public package depends on private workspace package', async () => {
    discoverWorkspacesMock = jest
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
      /Public package "@sentry\/browser" depends on private workspace package\(s\): @sentry-internal\/utils/
    );
  });

  it('allows public packages to depend on other public packages', async () => {
    discoverWorkspacesMock = jest
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
    discoverWorkspacesMock = jest
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
});
