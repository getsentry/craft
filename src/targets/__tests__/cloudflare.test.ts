import { vi } from 'vitest';

import { CloudflareTarget, targetSecrets } from '../cloudflare';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import * as system from '../../utils/system';
import { isDryRun } from '../../utils/helpers';

const TMP_DIR = '/tmp/craft-cloudflare-test';
const DEFAULT_SECRET_VALUE = 'secret_value';

vi.mock('../../utils/helpers');

vi.mock('../../utils/system', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/system')>();
  return {
    ...actual,
    checkExecutableIsPresent: vi.fn(),
    spawnProcess: vi.fn(async () => undefined),
    extractZipArchiveWithFlattening: vi.fn(async () => undefined),
  };
});

vi.mock('../../utils/files', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/files')>();
  return {
    ...actual,
    withTempDir: async (cb: (dir: string) => Promise<void>) => cb(TMP_DIR),
  };
});

function setTargetSecretsInEnv(): void {
  for (const secret of targetSecrets) {
    process.env[secret] = DEFAULT_SECRET_VALUE;
  }
}

function removeTargetSecretsFromEnv(): void {
  for (const secret of targetSecrets) {
    delete process.env[secret];
  }
}

function createCloudflareTarget(
  targetConfig?: Record<string, unknown>,
): CloudflareTarget {
  return new CloudflareTarget(
    {
      name: 'cloudflare',
      ...targetConfig,
    },
    new NoneArtifactProvider(),
    { owner: 'testOwner', repo: 'testRepo' },
  );
}

beforeEach(() => {
  setTargetSecretsInEnv();
  delete process.env.WRANGLER_BIN;
  (isDryRun as any).mockReturnValue(false);
});

afterEach(() => {
  removeTargetSecretsFromEnv();
  vi.clearAllMocks();
});

describe('cloudflare target configuration', () => {
  test('exports the expected secrets', () => {
    expect(targetSecrets).toContain('CLOUDFLARE_API_TOKEN');
    expect(targetSecrets).toContain('CLOUDFLARE_ACCOUNT_ID');
  });

  test('enforces required secrets', () => {
    removeTargetSecretsFromEnv();

    expect(() =>
      createCloudflareTarget({ projectName: 'my-project' }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Required value(s) CLOUDFLARE_API_TOKEN not found in configuration files or the environment. See the documentation for more details.]`,
    );

    process.env.CLOUDFLARE_API_TOKEN = DEFAULT_SECRET_VALUE;
    expect(() =>
      createCloudflareTarget({ projectName: 'my-project' }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Required value(s) CLOUDFLARE_ACCOUNT_ID not found in configuration files or the environment. See the documentation for more details.]`,
    );
  });

  test('applies default options (pages)', () => {
    const target = createCloudflareTarget({ projectName: 'my-project' });

    expect(target.cloudflareConfig).toStrictEqual({
      CLOUDFLARE_API_TOKEN: DEFAULT_SECRET_VALUE,
      CLOUDFLARE_ACCOUNT_ID: DEFAULT_SECRET_VALUE,
      deployType: 'pages',
      projectName: 'my-project',
      productionBranch: 'main',
      wranglerCliPath: 'wrangler',
      workingDir: undefined,
    });
  });

  test('allows overriding default options', () => {
    const target = createCloudflareTarget({
      deployType: 'worker',
      projectName: 'my-project',
      productionBranch: 'production',
      wranglerCliPath: '/custom/wrangler',
      workingDir: 'subdir',
    });

    expect(target.cloudflareConfig).toStrictEqual({
      CLOUDFLARE_API_TOKEN: DEFAULT_SECRET_VALUE,
      CLOUDFLARE_ACCOUNT_ID: DEFAULT_SECRET_VALUE,
      deployType: 'worker',
      projectName: 'my-project',
      productionBranch: 'production',
      wranglerCliPath: '/custom/wrangler',
      workingDir: 'subdir',
    });
  });

  test('resolves wrangler path from WRANGLER_BIN env', () => {
    process.env.WRANGLER_BIN = '/env/wrangler';
    const target = createCloudflareTarget({ projectName: 'my-project' });
    expect(target.cloudflareConfig.wranglerCliPath).toBe('/env/wrangler');
  });

  test('throws on invalid deployType', () => {
    expect(() =>
      createCloudflareTarget({ deployType: 'bogus', projectName: 'p' }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: [cloudflare] Invalid deployType "bogus": must be one of "pages", "worker"]`,
    );
  });

  test('requires projectName for pages deployType', () => {
    expect(() =>
      createCloudflareTarget({ deployType: 'pages' }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: [cloudflare] "projectName" is required when deployType is "pages"]`,
    );
  });

  test('does not require projectName for worker deployType', () => {
    expect(() =>
      createCloudflareTarget({ deployType: 'worker' }),
    ).not.toThrow();
  });

  test('checks wrangler is present in the constructor', () => {
    createCloudflareTarget({ projectName: 'my-project' });
    expect(system.checkExecutableIsPresent).toHaveBeenCalledWith('wrangler');
  });

  test('rejects config values that look like env-var expansions', () => {
    expect(() =>
      createCloudflareTarget({ projectName: '${CLOUDFLARE_API_TOKEN}' }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: [cloudflare] "projectName" must not be an environment-variable expansion (got "\${CLOUDFLARE_API_TOKEN}")]`,
    );

    expect(() =>
      createCloudflareTarget({
        projectName: 'ok',
        workingDir: '${CLOUDFLARE_ACCOUNT_ID}',
      }),
    ).toThrow(/workingDir.*must not be an environment-variable expansion/);
  });
});

describe('publish', () => {
  const revision = 'deadbeef';
  const version = '1.2.3';
  const artifact = { filename: 'cloudflare.zip' } as any;

  function stubArtifacts(target: CloudflareTarget, artifacts: any[]): void {
    target.getArtifactsForRevision = vi.fn(async () => artifacts);
    target.artifactProvider.downloadArtifact = vi.fn(
      async () => '/downloads/cloudflare.zip',
    );
  }

  test('deploys a pages project with production branch and provenance', async () => {
    const target = createCloudflareTarget({ projectName: 'my-project' });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    expect(system.extractZipArchiveWithFlattening).toHaveBeenCalledWith(
      '/downloads/cloudflare.zip',
      TMP_DIR,
    );

    expect(system.spawnProcess).toHaveBeenCalledTimes(1);
    const [bin, args, options] = (system.spawnProcess as any).mock.calls[0];
    expect(bin).toBe('wrangler');
    expect(args).toEqual([
      'pages',
      'deploy',
      TMP_DIR,
      '--project-name',
      'my-project',
      '--branch',
      'main',
      '--commit-hash',
      revision,
      '--commit-message',
      `Release ${version}`,
      '--commit-dirty',
      'false',
    ]);
    // Secrets must be in env, not argv
    expect(options.env.CLOUDFLARE_API_TOKEN).toBe(DEFAULT_SECRET_VALUE);
    expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe(DEFAULT_SECRET_VALUE);
    expect(args).not.toContain(DEFAULT_SECRET_VALUE);
  });

  test('uses the configured production branch', async () => {
    const target = createCloudflareTarget({
      projectName: 'my-project',
      productionBranch: 'release',
    });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [, args] = (system.spawnProcess as any).mock.calls[0];
    expect(args).toContain('--branch');
    expect(args[args.indexOf('--branch') + 1]).toBe('release');
  });

  test('deploys a worker using the local wrangler.toml', async () => {
    const target = createCloudflareTarget({ deployType: 'worker' });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [bin, args, options] = (system.spawnProcess as any).mock.calls[0];
    expect(bin).toBe('wrangler');
    expect(args).toEqual(['deploy']);
    expect(options.cwd).toBe(TMP_DIR);
    expect(options.env.CLOUDFLARE_API_TOKEN).toBe(DEFAULT_SECRET_VALUE);
  });

  test('deploys from workingDir subdirectory when configured', async () => {
    const target = createCloudflareTarget({
      projectName: 'my-project',
      workingDir: 'dist',
    });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [, args, options] = (system.spawnProcess as any).mock.calls[0];
    // pages deploy directory arg should point at the subdir
    expect(args[2]).toBe(`${TMP_DIR}/dist`);
    expect(options.cwd).toBe(`${TMP_DIR}/dist`);
  });

  test('reports an error and does not deploy when no artifacts found', async () => {
    const target = createCloudflareTarget({ projectName: 'my-project' });
    stubArtifacts(target, []);

    await expect(target.publish(version, revision)).rejects.toThrow(
      /no artifacts found/,
    );
    expect(system.spawnProcess).not.toHaveBeenCalled();
  });

  test('reports an error when more than one artifact found', async () => {
    const target = createCloudflareTarget({ projectName: 'my-project' });
    stubArtifacts(target, [artifact, artifact]);

    await expect(target.publish(version, revision)).rejects.toThrow(
      /more than one Cloudflare archive/,
    );
    expect(system.spawnProcess).not.toHaveBeenCalled();
  });

  test('does not deploy in dry-run mode (including worktree mode)', async () => {
    (isDryRun as any).mockReturnValue(true);
    const target = createCloudflareTarget({ projectName: 'my-project' });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    // Artifact is still extracted (local, safe), but the remote deploy is skipped
    expect(system.extractZipArchiveWithFlattening).toHaveBeenCalled();
    expect(system.spawnProcess).not.toHaveBeenCalled();
  });
});
