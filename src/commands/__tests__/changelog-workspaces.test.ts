import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

import type { ChangelogResult } from '../../utils/changelog';

vi.mock('../../logger');

const state = vi.hoisted(() => ({
  active: undefined as string | undefined,
  selections: [] as (string | undefined)[],
}));

vi.mock('../../config', () => ({
  findConfigFile: vi.fn(() => '/repo/.craft.yml'),
  getActiveWorkspace: vi.fn(() => state.active),
  setActiveWorkspace: vi.fn((name: string | undefined) => {
    state.active = name;
    state.selections.push(name);
  }),
  getWorkspaceNames: vi.fn(() => [
    'clients/python',
    'clients/rust',
    'objectstore-server',
  ]),
  getGitTagPrefix: vi.fn(() => `${state.active}@`),
  getVersioningPolicy: vi.fn(() =>
    state.active === 'objectstore-server' ? 'calver' : 'auto',
  ),
}));

vi.mock('../../utils/git', () => ({
  getGitClient: vi.fn().mockResolvedValue({}),
  getLatestTag: vi.fn(
    async (_git: unknown, prefix: string) => `${prefix}1.0.0`,
  ),
}));

const results: Record<string, ChangelogResult> = {
  'clients/python': {
    changelog: '### New Features\n> - Add option\n- Older python fix',
    prEntry: '### New Features\n> - Add option',
    bumpType: 'minor',
    totalCommits: 2,
    matchedCommitsWithSemver: 2,
    prSkipped: false,
  },
  'clients/rust': {
    changelog: '',
    bumpType: null,
    totalCommits: 0,
    matchedCommitsWithSemver: 0,
    prSkipped: false,
    prOutsideWorkspace: true,
  },
  'objectstore-server': {
    changelog: '### New Features\n> - Add option',
    prEntry: '### New Features\n> - Add option',
    bumpType: 'minor',
    totalCommits: 1,
    matchedCommitsWithSemver: 1,
    prSkipped: false,
  },
};

vi.mock('../../utils/changelog', async importOriginal => ({
  BUMP_TYPES: (await importOriginal<typeof import('../../utils/changelog')>())
    .BUMP_TYPES,
  generateChangesetFromGit: vi.fn(),
  generateChangelogWithHighlight: vi.fn(async () => results[state.active!]),
}));

describe('changelog --pr with release workspaces', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    state.active = undefined;
    state.selections = [];
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('previews the PR in each workspace it lands in', async () => {
    const { generateChangelogWithHighlight } =
      await import('../../utils/changelog');
    const { changelogMain } = await import('../changelog');

    await changelogMain({ pr: 7, format: 'json' });

    // Each workspace's preview starts from that workspace's latest tag
    expect(vi.mocked(generateChangelogWithHighlight).mock.calls).toEqual([
      [{}, 'clients/python@1.0.0', 7],
      [{}, 'clients/rust@1.0.0', 7],
      [{}, 'objectstore-server@1.0.0', 7],
    ]);
    // The selection is cleared afterwards
    expect(state.selections.at(-1)).toBeUndefined();

    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      changelog: '### New Features\n> - Add option',
      bumpType: 'minor',
      versioningPolicy: 'auto',
      prSkipped: false,
      workspaces: [
        {
          name: 'clients/python',
          bumpType: 'minor',
          versioningPolicy: 'auto',
        },
        {
          name: 'objectstore-server',
          bumpType: 'minor',
          versioningPolicy: 'calver',
        },
      ],
    });
  });

  it('reports no workspaces when the PR lands in none', async () => {
    const { generateChangelogWithHighlight } =
      await import('../../utils/changelog');
    const { changelogMain } = await import('../changelog');
    // Called once per workspace
    for (let i = 0; i < 3; i++) {
      vi.mocked(generateChangelogWithHighlight).mockResolvedValueOnce(
        results['clients/rust'],
      );
    }

    await changelogMain({ pr: 7, format: 'json' });

    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toMatchObject({
      changelog: '',
      bumpType: null,
      prSkipped: false,
      workspaces: [],
    });
  });

  it('uses the selected workspace alone when one is given', async () => {
    const { generateChangelogWithHighlight } =
      await import('../../utils/changelog');
    const { changelogMain } = await import('../changelog');
    state.active = 'clients/python';

    await changelogMain({ pr: 7, format: 'json' });

    expect(generateChangelogWithHighlight).toHaveBeenCalledTimes(1);
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.workspaces).toBeUndefined();
    expect(output.changelog).toContain('Older python fix');
  });
});
