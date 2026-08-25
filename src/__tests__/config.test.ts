import { describe, test, expect, vi, afterEach } from 'vitest';
/**
 * Tests of our ability to read craft config files. (This is NOT general test
 * configuration).
 */

import {
  getGitTagPrefix,
  loadConfigurationFromString,
  validateConfiguration,
  setActiveWorkspace,
  getActiveWorkspace,
  getVersioningPolicy,
  WORKSPACES_MIN_VERSION,
} from '../config';
import { CraftProjectConfigSchema } from '../schemas/project_config';
import { logger } from '../logger';

describe('validateConfiguration', () => {
  test('parses minimal configuration', () => {
    const data = { github: { owner: 'getsentry', repo: 'craft' } };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('parses configuration with targets', () => {
    const data = {
      github: { owner: 'getsentry', repo: 'craft' },
      targets: [{ name: 'npm' }, { name: 'github', tagPrefix: 'v' }],
    };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('parses configuration with changelog object', () => {
    const data = {
      changelog: {
        filePath: 'CHANGELOG.md',
        policy: 'auto',
        scopeGrouping: true,
      },
    };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('parses configuration with changelog string', () => {
    const data = {
      changelog: 'CHANGELOG.md',
    };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('parses configuration with versioning', () => {
    const data = {
      versioning: {
        policy: 'calver',
        calver: {
          offset: 14,
          format: '%y.%-m',
        },
      },
    };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('fails with invalid github config', () => {
    expect(() =>
      validateConfiguration({ github: { owner: 'getsentry' } }),
    ).toThrow(/repo.*Required/);
  });

  test('fails with invalid minVersion format', () => {
    expect(() => validateConfiguration({ minVersion: 'invalid' })).toThrow(
      /minVersion/,
    );
  });

  test('fails with invalid changelog policy', () => {
    expect(() =>
      validateConfiguration({ changelog: { policy: 'invalid' } }),
    ).toThrow(/changelog/);
  });
});

describe('CraftProjectConfigSchema', () => {
  test('schema validates correct config', () => {
    const data = {
      github: { owner: 'getsentry', repo: 'craft' },
      minVersion: '2.14.0',
    };

    const result = CraftProjectConfigSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test('schema rejects invalid minVersion', () => {
    const data = {
      minVersion: 'not-a-version',
    };

    const result = CraftProjectConfigSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe('noMerge config', () => {
  test('parses configuration with noMerge: true', () => {
    const data = { noMerge: true };
    expect(validateConfiguration(data)).toEqual(data);
  });

  test('parses configuration with noMerge: false', () => {
    const data = { noMerge: false };
    expect(validateConfiguration(data)).toEqual(data);
  });

  test('noMerge defaults to undefined when not specified', () => {
    const data = { github: { owner: 'getsentry', repo: 'craft' } };
    const result = validateConfiguration(data);
    expect(result.noMerge).toBeUndefined();
  });

  test('fails with invalid noMerge type', () => {
    expect(() => validateConfiguration({ noMerge: 'yes' })).toThrow(/noMerge/);
  });

  test('parses configuration with workspaces', () => {
    const data = {
      minVersion: '2.27.0',
      github: { owner: 'getsentry', repo: 'toolkit' },
      workspaces: {
        cli: {
          releaseBranchPrefix: 'release/cli',
          github: { projectPath: 'cli' },
          targets: [{ name: 'github', tagPrefix: 'cli@' }],
        },
        mcp: {
          targets: [{ name: 'github', tagPrefix: 'mcp@' }],
        },
      },
    };

    expect(validateConfiguration(data)).toEqual(data);
  });

  test('allows a workspace github override without owner/repo', () => {
    const data = {
      workspaces: {
        cli: { github: { projectPath: 'cli' } },
      },
    };

    // Workspace github is partial; owner/repo are inherited, not required here.
    expect(() => validateConfiguration(data)).not.toThrow();
  });
});

describe('getGitTagPrefix', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function loadWithTargets(targets: unknown[]): void {
    loadConfigurationFromString(
      [
        'github:',
        '  owner: getsentry',
        '  repo: craft',
        'targets:',
        ...targets.map(t => `  - ${JSON.stringify(t)}`),
      ].join('\n'),
    );
  }

  test('returns empty string when no github target has a tagPrefix', () => {
    loadWithTargets([{ name: 'npm' }, { name: 'github' }]);
    expect(getGitTagPrefix()).toBe('');
  });

  test("returns the github target's tagPrefix", () => {
    loadWithTargets([{ name: 'npm' }, { name: 'github', tagPrefix: 'cli@' }]);
    expect(getGitTagPrefix()).toBe('cli@');
  });

  test('does not warn for a single github target', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    loadWithTargets([{ name: 'github', tagPrefix: 'cli@' }]);
    expect(getGitTagPrefix()).toBe('cli@');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('does not warn when multiple github targets share the same prefix', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    loadWithTargets([
      { name: 'github', tagPrefix: 'cli@' },
      { name: 'github', tagPrefix: 'cli@', id: 'second' },
    ]);
    expect(getGitTagPrefix()).toBe('cli@');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('warns and returns the first prefix when github targets disagree', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    loadWithTargets([
      { name: 'github', tagPrefix: 'cli@' },
      { name: 'github', tagPrefix: 'mcp@', id: 'second' },
    ]);
    expect(getGitTagPrefix()).toBe('cli@');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/different "tagPrefix"/);
  });

  test('warns when one github target has a prefix and another omits it', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    loadWithTargets([
      { name: 'github', tagPrefix: 'cli@' },
      { name: 'github', id: 'second' },
    ]);
    // A mixed defined/undefined prefix is still ambiguous.
    expect(getGitTagPrefix()).toBe('cli@');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('workspaces', () => {
  afterEach(() => {
    setActiveWorkspace(undefined);
    vi.restoreAllMocks();
  });

  const WS_CONFIG = [
    `minVersion: ${WORKSPACES_MIN_VERSION}`,
    'github:',
    '  owner: getsentry',
    '  repo: toolkit',
    'changelog: CHANGELOG.md',
    'workspaces:',
    '  cli:',
    '    releaseBranchPrefix: release/cli',
    '    github:',
    '      projectPath: cli',
    '    targets:',
    '      - name: github',
    '        tagPrefix: "cli@"',
    '  mcp:',
    '    releaseBranchPrefix: release/mcp',
    '    versioning:',
    '      policy: calver',
    '    targets:',
    '      - name: github',
    '        tagPrefix: "mcp@"',
  ].join('\n');

  test('backward compatible: no workspaces, no selection resolves normally', () => {
    setActiveWorkspace(undefined);
    loadConfigurationFromString(
      ['github:', '  owner: getsentry', '  repo: craft'].join('\n'),
    );
    expect(getActiveWorkspace()).toBeUndefined();
  });

  test('resolves the selected workspace: overrides win, base inherited', () => {
    setActiveWorkspace('cli');
    const config = loadConfigurationFromString(WS_CONFIG);

    // Overridden by the workspace.
    expect(config.releaseBranchPrefix).toBe('release/cli');
    expect(getGitTagPrefix()).toBe('cli@');
    // github is shallow-merged: owner/repo inherited, projectPath overridden.
    expect(config.github).toEqual({
      owner: 'getsentry',
      repo: 'toolkit',
      projectPath: 'cli',
    });
    // Inherited from the top level.
    expect(config.changelog).toBe('CHANGELOG.md');
    // `workspaces` is stripped from the resolved config.
    expect(config.workspaces).toBeUndefined();
  });

  test('a different workspace resolves independently', () => {
    setActiveWorkspace('mcp');
    const config = loadConfigurationFromString(WS_CONFIG);
    expect(config.releaseBranchPrefix).toBe('release/mcp');
    expect(getGitTagPrefix()).toBe('mcp@');
    expect(getVersioningPolicy()).toBe('calver');
    // mcp did not override github.projectPath, so it inherits base github only.
    expect(config.github).toEqual({ owner: 'getsentry', repo: 'toolkit' });
  });

  test('errors when workspaces are defined but none is selected', () => {
    setActiveWorkspace(undefined);
    expect(() => loadConfigurationFromString(WS_CONFIG)).toThrow(
      /defines workspaces; select one/,
    );
  });

  test('errors on an unknown workspace name', () => {
    setActiveWorkspace('nope');
    expect(() => loadConfigurationFromString(WS_CONFIG)).toThrow(
      /Unknown workspace "nope"/,
    );
  });

  test.each(['constructor', 'toString', '__proto__'])(
    'rejects prototype-named workspace %s',
    workspace => {
      setActiveWorkspace(workspace);
      expect(() => loadConfigurationFromString(WS_CONFIG)).toThrow(
        new RegExp(`Unknown workspace "${workspace}"`),
      );
    },
  );

  test('errors when a workspace is selected but none are defined', () => {
    setActiveWorkspace('cli');
    expect(() =>
      loadConfigurationFromString(
        ['github:', '  owner: getsentry', '  repo: craft'].join('\n'),
      ),
    ).toThrow(/no "workspaces" are defined/);
  });

  test('errors when minVersion is below the workspaces gate', () => {
    setActiveWorkspace('cli');
    const belowGate = WS_CONFIG.replace(
      `minVersion: ${WORKSPACES_MIN_VERSION}`,
      'minVersion: 2.14.0',
    );
    expect(() => loadConfigurationFromString(belowGate)).toThrow(
      new RegExp(`requires minVersion >= ${WORKSPACES_MIN_VERSION}`),
    );
  });

  test('accepts build metadata in a workspace minVersion', () => {
    setActiveWorkspace('cli');
    const config = loadConfigurationFromString(
      WS_CONFIG.replace(
        `minVersion: ${WORKSPACES_MIN_VERSION}`,
        `minVersion: ${WORKSPACES_MIN_VERSION}+linux`,
      ),
    );
    expect(config.releaseBranchPrefix).toBe('release/cli');
  });

  test('setActiveWorkspace re-resolves against a new selection', () => {
    setActiveWorkspace('cli');
    loadConfigurationFromString(WS_CONFIG);
    expect(getGitTagPrefix()).toBe('cli@');

    setActiveWorkspace('mcp');
    loadConfigurationFromString(WS_CONFIG);
    expect(getGitTagPrefix()).toBe('mcp@');
  });

  test('resolved config exposes the workspace targets (publish builder contract)', () => {
    // Regression for the parse-time interaction: the `publish` builder reads
    // getConfiguration().targets to compute --target choices. With a workspace
    // selected up front, this must resolve to that workspace's targets and must
    // not throw the "select a workspace" error.
    setActiveWorkspace('cli');
    const config = loadConfigurationFromString(WS_CONFIG);
    expect(config.targets).toEqual([{ name: 'github', tagPrefix: 'cli@' }]);
  });

  test('does not produce an incomplete github when base has none', () => {
    // A workspace that sets only github.projectPath, with NO top-level github,
    // must NOT yield a truthy-but-incomplete github object (missing owner/repo)
    // — that would make getGlobalGitHubConfig skip its git-remote fallback.
    setActiveWorkspace('cli');
    const config = loadConfigurationFromString(
      [
        `minVersion: ${WORKSPACES_MIN_VERSION}`,
        'workspaces:',
        '  cli:',
        '    github:',
        '      projectPath: cli',
        '    targets:',
        '      - name: github',
        '        tagPrefix: "cli@"',
      ].join('\n'),
    );
    // Incomplete github is dropped so git-remote detection can still run.
    expect(config.github).toBeUndefined();
  });

  test('keeps github when workspace override completes owner/repo', () => {
    setActiveWorkspace('cli');
    const config = loadConfigurationFromString(
      [
        `minVersion: ${WORKSPACES_MIN_VERSION}`,
        'workspaces:',
        '  cli:',
        '    github:',
        '      owner: getsentry',
        '      repo: toolkit',
        '      projectPath: cli',
        '    targets:',
        '      - name: github',
      ].join('\n'),
    );
    expect(config.github).toEqual({
      owner: 'getsentry',
      repo: 'toolkit',
      projectPath: 'cli',
    });
  });
});
