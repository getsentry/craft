import { vi, beforeEach, describe, it, expect } from 'vitest';

// Mock the logger before importing changelog
vi.mock('../../logger');

// Mock the config module to control getConfigFileDir
vi.mock('../../config', () => ({
  getConfigFileDir: vi.fn(),
  getGlobalGitHubConfig: vi.fn(),
  getChangelogConfig: vi.fn(),
}));

// Mock fs to control file reading
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

describe('getNormalizedReleaseConfig semver warnings', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('warns when custom config has categories without semver fields', async () => {
    const { readFileSync } = await import('fs');
    const { getConfigFileDir } = await import('../../config');
    const { logger } = await import('../../logger');

    // Setup: custom config file exists with missing semver fields
    vi.mocked(getConfigFileDir).mockReturnValue('/test/repo');
    vi.mocked(readFileSync).mockReturnValue(`
changelog:
  categories:
    - title: Features
      labels:
        - enhancement
    - title: Bug Fixes
      labels:
        - bug
`);

    // Import fresh module after mocks are set up
    const { getNormalizedReleaseConfig, clearReleaseConfigCache } =
      await import('../changelog');
    clearReleaseConfigCache();

    getNormalizedReleaseConfig();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Features'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Bug Fixes'),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('semver'));
  });

  it('does not warn when using default config (no file)', async () => {
    const { readFileSync } = await import('fs');
    const { getConfigFileDir } = await import('../../config');
    const { logger } = await import('../../logger');

    // Setup: no config file dir
    vi.mocked(getConfigFileDir).mockReturnValue(null);

    const { getNormalizedReleaseConfig, clearReleaseConfigCache } =
      await import('../changelog');
    clearReleaseConfigCache();

    getNormalizedReleaseConfig();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('does not warn when all categories have semver fields', async () => {
    const { readFileSync } = await import('fs');
    const { getConfigFileDir } = await import('../../config');
    const { logger } = await import('../../logger');

    vi.mocked(getConfigFileDir).mockReturnValue('/test/repo');
    vi.mocked(readFileSync).mockReturnValue(`
changelog:
  categories:
    - title: Features
      labels:
        - enhancement
      semver: minor
    - title: Bug Fixes
      labels:
        - bug
      semver: patch
`);

    const { getNormalizedReleaseConfig, clearReleaseConfigCache } =
      await import('../changelog');
    clearReleaseConfigCache();

    getNormalizedReleaseConfig();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('only warns about categories missing semver', async () => {
    const { readFileSync } = await import('fs');
    const { getConfigFileDir } = await import('../../config');
    const { logger } = await import('../../logger');

    vi.mocked(getConfigFileDir).mockReturnValue('/test/repo');
    vi.mocked(readFileSync).mockReturnValue(`
changelog:
  categories:
    - title: Features
      labels:
        - enhancement
      semver: minor
    - title: Internal
      labels:
        - internal
`);

    const { getNormalizedReleaseConfig, clearReleaseConfigCache } =
      await import('../changelog');
    clearReleaseConfigCache();

    getNormalizedReleaseConfig();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Internal'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.not.stringContaining('Features'),
    );
  });

  it('only warns once due to memoization', async () => {
    const { readFileSync } = await import('fs');
    const { getConfigFileDir } = await import('../../config');
    const { logger } = await import('../../logger');

    vi.mocked(getConfigFileDir).mockReturnValue('/test/repo');
    vi.mocked(readFileSync).mockReturnValue(`
changelog:
  categories:
    - title: Features
      labels:
        - enhancement
`);

    const { getNormalizedReleaseConfig, clearReleaseConfigCache } =
      await import('../changelog');
    clearReleaseConfigCache();

    // Call multiple times
    getNormalizedReleaseConfig();
    getNormalizedReleaseConfig();
    getNormalizedReleaseConfig();

    // Should only warn once due to memoization
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('includes documentation URL in warning message', async () => {
    const { readFileSync } = await import('fs');
    const { getConfigFileDir } = await import('../../config');
    const { logger } = await import('../../logger');

    vi.mocked(getConfigFileDir).mockReturnValue('/test/repo');
    vi.mocked(readFileSync).mockReturnValue(`
changelog:
  categories:
    - title: Features
      labels:
        - enhancement
`);

    const { getNormalizedReleaseConfig, clearReleaseConfigCache } =
      await import('../changelog');
    clearReleaseConfigCache();

    getNormalizedReleaseConfig();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://getsentry.github.io/craft/configuration/#auto-mode',
      ),
    );
  });
});
