import { parseVersion } from '../../utils/version';
import { getPublishTag, getLatestVersion } from '../npm';

function setNpmToken() {
  process.env.NPM_TOKEN = 'test-token';
}

const defaultNpmConfig = {
  useYarn: false,
  token: 'xxx',
};

describe('getLatestVersion', () => {
  beforeEach(() => {
    setNpmToken();
  });

  it('returns undefined for unexisting checkPackageName', async () => {
    const actual = await getLatestVersion(
      'sentry-xx-this-does-not-exist',
      defaultNpmConfig
    );
    expect(actual).toEqual(undefined);
  });

  it('returns version for valid id', async () => {
    const actual = await getLatestVersion('@sentry/browser', defaultNpmConfig);
    expect(actual).toBeDefined();

    // Returns a valid version
    const parsed = parseVersion(actual as string);
    expect(parsed).toBeDefined();
    expect(parsed?.major).toBeGreaterThanOrEqual(7);
  });
});

describe('getPublishTag', () => {
  beforeEach(() => {
    setNpmToken();
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
  });

  it('returns undefined for unexisting package id', async () => {
    const logger = {
      warn: jest.fn(),
    } as any;
    const actual = await getPublishTag(
      'sentry-xx-does-not-exist',
      undefined,
      defaultNpmConfig,
      logger
    );
    expect(actual).toEqual(undefined);
    expect(logger.warn).not.toHaveBeenCalled();
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
  });

  it('returns old for older versions', async () => {
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
  });

  it('returns old for older versions when using yarn', async () => {
    const logger = {
      warn: jest.fn(),
    } as any;
    const actual = await getPublishTag(
      '1.0.0',
      '@sentry/browser',
      {
        ...defaultNpmConfig,
        useYarn: true,
      },
      logger
    );
    expect(actual).toBe('old');
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
