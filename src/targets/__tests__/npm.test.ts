import { getPublishTag, getLatestVersion } from '../npm';
import * as system from '../../utils/system';

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
