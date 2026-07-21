import { vi } from 'vitest';

import { CloudflareTarget, targetSecrets } from '../cloudflare';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import * as system from '../../utils/system';
import { isDryRun } from '../../utils/helpers';

const TMP_DIR = '/tmp/craft-cloudflare-test';
const DEFAULT_SECRET_VALUE = 'secret_value';
const ACCOUNT_ID = 'acc_1234';

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

/** Mocks global.fetch to return a Pages project with the given production branch. */
function mockFetchProductionBranch(branch: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ result: { production_branch: branch } }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  setTargetSecretsInEnv();
  delete process.env.WRANGLER_BIN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  (isDryRun as any).mockReturnValue(false);
});

afterEach(() => {
  removeTargetSecretsFromEnv();
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('cloudflare target configuration', () => {
  test('exports the expected secrets (only the API token is a secret)', () => {
    expect(targetSecrets).toContain('CLOUDFLARE_API_TOKEN');
    expect(targetSecrets).not.toContain('CLOUDFLARE_ACCOUNT_ID');
  });

  test('enforces the required API token secret', () => {
    removeTargetSecretsFromEnv();

    expect(() =>
      createCloudflareTarget({ deployType: 'worker' }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Required value(s) CLOUDFLARE_API_TOKEN not found in configuration files or the environment. See the documentation for more details.]`,
    );
  });

  test('does not require CLOUDFLARE_ACCOUNT_ID', () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    expect(() => createCloudflareTarget({ deployType: 'worker' })).not.toThrow();
  });

  test('applies default options (worker)', () => {
    const target = createCloudflareTarget({});

    expect(target.cloudflareConfig).toStrictEqual({
      CLOUDFLARE_API_TOKEN: DEFAULT_SECRET_VALUE,
      deployType: 'worker',
      projectName: undefined,
      productionBranch: undefined,
      wranglerCliPath: 'wrangler',
      workingDir: undefined,
      accountId: undefined,
    });
  });

  test('picks up CLOUDFLARE_ACCOUNT_ID from env when set', () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
    const target = createCloudflareTarget({});
    expect(target.cloudflareConfig.accountId).toBe(ACCOUNT_ID);
  });

  test('allows overriding default options', () => {
    const target = createCloudflareTarget({
      deployType: 'pages',
      projectName: 'my-project',
      productionBranch: 'production',
      wranglerCliPath: '/custom/wrangler',
      workingDir: 'subdir',
    });

    expect(target.cloudflareConfig).toStrictEqual({
      CLOUDFLARE_API_TOKEN: DEFAULT_SECRET_VALUE,
      deployType: 'pages',
      projectName: 'my-project',
      productionBranch: 'production',
      wranglerCliPath: '/custom/wrangler',
      workingDir: 'subdir',
      accountId: undefined,
    });
  });

  test('resolves wrangler path from WRANGLER_BIN env', () => {
    process.env.WRANGLER_BIN = '/env/wrangler';
    const target = createCloudflareTarget({});
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
    createCloudflareTarget({});
    expect(system.checkExecutableIsPresent).toHaveBeenCalledWith('wrangler');
  });

  test('rejects config values that look like env-var expansions', () => {
    expect(() =>
      createCloudflareTarget({
        deployType: 'pages',
        projectName: '${CLOUDFLARE_API_TOKEN}',
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: [cloudflare] "projectName" must not be an environment-variable expansion (got "\${CLOUDFLARE_API_TOKEN}")]`,
    );

    expect(() =>
      createCloudflareTarget({
        deployType: 'pages',
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

  test('deploys a pages project with the configured production branch and provenance', async () => {
    const target = createCloudflareTarget({
      deployType: 'pages',
      projectName: 'my-project',
      productionBranch: 'main',
    });
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
    // Secret must be in env, not argv
    expect(options.env.CLOUDFLARE_API_TOKEN).toBe(DEFAULT_SECRET_VALUE);
    expect(args).not.toContain(DEFAULT_SECRET_VALUE);
  });

  test('does not forward CLOUDFLARE_ACCOUNT_ID when unset', async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    const target = createCloudflareTarget({ deployType: 'worker' });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [, , options] = (system.spawnProcess as any).mock.calls[0];
    expect('CLOUDFLARE_ACCOUNT_ID' in options.env).toBe(false);
  });

  test('forwards CLOUDFLARE_ACCOUNT_ID when set', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
    const target = createCloudflareTarget({ deployType: 'worker' });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [, , options] = (system.spawnProcess as any).mock.calls[0];
    expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe(ACCOUNT_ID);
  });

  test('infers the production branch from the API when not configured', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
    const fetchMock = mockFetchProductionBranch('trunk');
    const target = createCloudflareTarget({
      deployType: 'pages',
      projectName: 'my-project',
    });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    // Correct API endpoint + auth header
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/my-project`,
    );
    expect(init.headers.Authorization).toBe(`Bearer ${DEFAULT_SECRET_VALUE}`);

    const [, args] = (system.spawnProcess as any).mock.calls[0];
    expect(args[args.indexOf('--branch') + 1]).toBe('trunk');
  });

  test('does not call the API when productionBranch is configured', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const target = createCloudflareTarget({
      deployType: 'pages',
      projectName: 'my-project',
      productionBranch: 'release',
    });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    expect(fetchMock).not.toHaveBeenCalled();
    const [, args] = (system.spawnProcess as any).mock.calls[0];
    expect(args[args.indexOf('--branch') + 1]).toBe('release');
  });

  test('omits --branch when the branch cannot be resolved (no account id)', async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const target = createCloudflareTarget({
      deployType: 'pages',
      projectName: 'my-project',
    });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    // No account id → cannot address the API → no fetch, no --branch
    expect(fetchMock).not.toHaveBeenCalled();
    const [, args] = (system.spawnProcess as any).mock.calls[0];
    expect(args).not.toContain('--branch');
  });

  test('omits --branch when the API call fails', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const target = createCloudflareTarget({
      deployType: 'pages',
      projectName: 'my-project',
    });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, args] = (system.spawnProcess as any).mock.calls[0];
    expect(args).not.toContain('--branch');
  });

  test('hard-fails when the Pages project is not found (404)', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const target = createCloudflareTarget({
      deployType: 'pages',
      projectName: 'missing-project',
    });
    stubArtifacts(target, [artifact]);

    await expect(target.publish(version, revision)).rejects.toThrow(
      /Pages project "missing-project" not found/,
    );
    expect(system.spawnProcess).not.toHaveBeenCalled();
  });

  test('ignores an API-sourced branch that looks like an env expansion', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
    mockFetchProductionBranch('${CLOUDFLARE_API_TOKEN}');
    const target = createCloudflareTarget({
      deployType: 'pages',
      projectName: 'my-project',
    });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [, args] = (system.spawnProcess as any).mock.calls[0];
    // The suspicious value must never reach argv.
    expect(args).not.toContain('--branch');
    expect(args).not.toContain('${CLOUDFLARE_API_TOKEN}');
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

  test('worker deploy never calls the Pages API', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const target = createCloudflareTarget({ deployType: 'worker' });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('deploys from workingDir subdirectory when configured', async () => {
    const target = createCloudflareTarget({
      deployType: 'pages',
      projectName: 'my-project',
      productionBranch: 'main',
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
    const target = createCloudflareTarget({ deployType: 'worker' });
    stubArtifacts(target, []);

    await expect(target.publish(version, revision)).rejects.toThrow(
      /no artifacts found/,
    );
    expect(system.spawnProcess).not.toHaveBeenCalled();
  });

  test('reports an error when more than one artifact found', async () => {
    const target = createCloudflareTarget({ deployType: 'worker' });
    stubArtifacts(target, [artifact, artifact]);

    await expect(target.publish(version, revision)).rejects.toThrow(
      /more than one Cloudflare archive/,
    );
    expect(system.spawnProcess).not.toHaveBeenCalled();
  });

  test('does not deploy or hit the API in dry-run mode (including worktree mode)', async () => {
    (isDryRun as any).mockReturnValue(true);
    process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const target = createCloudflareTarget({
      deployType: 'pages',
      projectName: 'my-project',
    });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    // Artifact is still extracted (local, safe), but the remote deploy AND the
    // production-branch API call are both skipped.
    expect(system.extractZipArchiveWithFlattening).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(system.spawnProcess).not.toHaveBeenCalled();
  });
});
