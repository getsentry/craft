import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

import type { ChangelogResult } from '../../utils/changelog';

// Mock all heavy dependencies
vi.mock('../../logger');

vi.mock('../../config', () => ({
  findConfigFile: vi.fn(),
  getVersioningPolicy: vi.fn(),
}));

vi.mock('../../utils/git', () => ({
  getGitClient: vi.fn().mockResolvedValue({}),
  getLatestTag: vi.fn().mockResolvedValue('1.0.0'),
}));

const mockResult: ChangelogResult = {
  changelog: '### Bug Fixes\n- fix something',
  bumpType: 'patch',
  totalCommits: 3,
  matchedCommitsWithSemver: 2,
};

vi.mock('../../utils/changelog', () => ({
  generateChangesetFromGit: vi.fn().mockResolvedValue(mockResult),
  generateChangelogWithHighlight: vi.fn().mockResolvedValue(mockResult),
}));

describe('changelog command versioningPolicy in JSON output', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function parseJsonOutput(): Record<string, unknown> {
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    return JSON.parse(consoleSpy.mock.calls[0][0] as string);
  }

  it('includes versioningPolicy "calver" when config has calver policy', async () => {
    const { findConfigFile, getVersioningPolicy } =
      await import('../../config');
    const { changelogMain } = await import('../changelog');

    vi.mocked(findConfigFile).mockReturnValue('/repo/.craft.yml');
    vi.mocked(getVersioningPolicy).mockReturnValue(
      'calver' as ReturnType<typeof getVersioningPolicy>,
    );

    await changelogMain({ format: 'json' });

    const output = parseJsonOutput();
    expect(output.versioningPolicy).toBe('calver');
    expect(output.bumpType).toBe('patch');
    expect(output.changelog).toContain('Bug Fixes');
  });

  it('includes versioningPolicy "auto" when config has auto policy', async () => {
    const { findConfigFile, getVersioningPolicy } =
      await import('../../config');
    const { changelogMain } = await import('../changelog');

    vi.mocked(findConfigFile).mockReturnValue('/repo/.craft.yml');
    vi.mocked(getVersioningPolicy).mockReturnValue(
      'auto' as ReturnType<typeof getVersioningPolicy>,
    );

    await changelogMain({ format: 'json' });

    const output = parseJsonOutput();
    expect(output.versioningPolicy).toBe('auto');
  });

  it('includes versioningPolicy "manual" when config has manual policy', async () => {
    const { findConfigFile, getVersioningPolicy } =
      await import('../../config');
    const { changelogMain } = await import('../changelog');

    vi.mocked(findConfigFile).mockReturnValue('/repo/.craft.yml');
    vi.mocked(getVersioningPolicy).mockReturnValue(
      'manual' as ReturnType<typeof getVersioningPolicy>,
    );

    await changelogMain({ format: 'json' });

    const output = parseJsonOutput();
    expect(output.versioningPolicy).toBe('manual');
  });

  it('defaults to "auto" when no config file exists', async () => {
    const { findConfigFile, getVersioningPolicy } =
      await import('../../config');
    const { changelogMain } = await import('../changelog');

    vi.mocked(findConfigFile).mockReturnValue(undefined);

    await changelogMain({ format: 'json' });

    const output = parseJsonOutput();
    expect(output.versioningPolicy).toBe('auto');
    expect(getVersioningPolicy).not.toHaveBeenCalled();
  });

  it('defaults to "auto" when getVersioningPolicy throws', async () => {
    const { findConfigFile, getVersioningPolicy } =
      await import('../../config');
    const { changelogMain } = await import('../changelog');

    vi.mocked(findConfigFile).mockReturnValue('/repo/.craft.yml');
    vi.mocked(getVersioningPolicy).mockImplementation(() => {
      throw new Error('Config parse error');
    });

    await changelogMain({ format: 'json' });

    const output = parseJsonOutput();
    expect(output.versioningPolicy).toBe('auto');
  });

  it('does not include versioningPolicy in text output', async () => {
    const { changelogMain } = await import('../changelog');

    await changelogMain({ format: 'text' });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const textOutput = consoleSpy.mock.calls[0][0] as string;
    expect(textOutput).not.toContain('versioningPolicy');
  });
});
