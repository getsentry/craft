import { vi } from 'vitest';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { ConfigurationError } from '../../utils/errors';
import { BrewTarget } from '../brew';

// Mock the GitHub API client
vi.mock('../../utils/githubApi', () => ({
  getGitHubClient: vi.fn(() => ({
    repos: {
      getContent: vi.fn(),
      createOrUpdateFileContents: vi.fn(),
    },
  })),
}));

const DEFAULT_GITHUB_REPO = {
  owner: 'getsentry',
  repo: 'sentry-cli',
};

/** Returns a new BrewTarget test instance. */
function getBrewTarget(
  config: Record<string, unknown> = {},
  githubRepo = DEFAULT_GITHUB_REPO
): BrewTarget {
  return new BrewTarget(
    {
      name: 'brew',
      template: 'class TestFormula < Formula\nend',
      tap: 'getsentry/tools',
      ...config,
    },
    new NoneArtifactProvider(),
    githubRepo
  );
}

describe('BrewTarget configuration', () => {
  test('throws on missing template', () => {
    expect(() => {
      new BrewTarget(
        { name: 'brew' },
        new NoneArtifactProvider(),
        DEFAULT_GITHUB_REPO
      );
    }).toThrow(ConfigurationError);
  });

  test('parses tap correctly', () => {
    const brewTarget = getBrewTarget();
    expect(brewTarget.brewConfig.tapRepo).toEqual({
      owner: 'getsentry',
      repo: 'homebrew-tools',
    });
  });

  test('defaults to homebrew-core when no tap specified', () => {
    const brewTarget = getBrewTarget({ tap: undefined });
    expect(brewTarget.brewConfig.tapRepo).toEqual({
      owner: 'homebrew',
      repo: 'homebrew-core',
    });
  });

  test('throws on invalid tap name', () => {
    expect(() => {
      getBrewTarget({ tap: 'invalid' });
    }).toThrow(ConfigurationError);
  });
});

describe('formula name templating', () => {
  test('formula name without template variables', () => {
    const brewTarget = getBrewTarget({ formula: 'sentry-cli' });
    const resolved = brewTarget.resolveFormulaName('10.2.3');
    expect(resolved).toBe('sentry-cli');
  });

  test('formula name with major version variable', () => {
    const brewTarget = getBrewTarget({ formula: 'sentry-cli-v{{{major}}}' });
    const resolved = brewTarget.resolveFormulaName('10.2.3');
    expect(resolved).toBe('sentry-cli-v10');
  });

  test('formula name with multiple version variables', () => {
    const brewTarget = getBrewTarget({
      formula: 'sentry-cli-{{{major}}}-{{{minor}}}-{{{patch}}}',
    });
    const resolved = brewTarget.resolveFormulaName('10.2.3');
    expect(resolved).toBe('sentry-cli-10-2-3');
  });

  test('formula name with full version variable', () => {
    const brewTarget = getBrewTarget({ formula: 'sentry-cli-{{{version}}}' });
    const resolved = brewTarget.resolveFormulaName('10.2.3');
    expect(resolved).toBe('sentry-cli-10.2.3');
  });

  test('formula name with prerelease version still parses major', () => {
    const brewTarget = getBrewTarget({ formula: 'sentry-cli-v{{{major}}}' });
    const resolved = brewTarget.resolveFormulaName('10.2.3-alpha.1');
    expect(resolved).toBe('sentry-cli-v10');
  });

  test('falls back to repo name when no formula specified', () => {
    const brewTarget = getBrewTarget({ formula: undefined });
    const resolved = brewTarget.resolveFormulaName('1.0.0');
    expect(resolved).toBe('sentry-cli');
  });

  test('repo name with version template', () => {
    const brewTarget = getBrewTarget(
      { formula: undefined },
      { owner: 'getsentry', repo: 'craft-v{{{major}}}' }
    );
    const resolved = brewTarget.resolveFormulaName('2.5.0');
    expect(resolved).toBe('craft-v2');
  });
});

describe('prerelease skip', () => {
  test('skips publishing for beta version', async () => {
    const brewTarget = getBrewTarget();
    const result = await brewTarget.publish('2.0.0-beta.0', 'abc123');
    expect(result).toBeUndefined();
  });

  test('skips publishing for alpha version', async () => {
    const brewTarget = getBrewTarget();
    const result = await brewTarget.publish('1.5.0-alpha.1', 'abc123');
    expect(result).toBeUndefined();
  });

  test('skips publishing for rc version', async () => {
    const brewTarget = getBrewTarget();
    const result = await brewTarget.publish('3.0.0-rc.1', 'abc123');
    expect(result).toBeUndefined();
  });

  test('skips publishing for preview version', async () => {
    const brewTarget = getBrewTarget();
    const result = await brewTarget.publish('2.0.0-preview.1', 'abc123');
    expect(result).toBeUndefined();
  });

  test('skips publishing for dev version', async () => {
    const brewTarget = getBrewTarget();
    const result = await brewTarget.publish('1.0.0-dev.1', 'abc123');
    expect(result).toBeUndefined();
  });
});
