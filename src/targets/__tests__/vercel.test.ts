import { vi } from 'vitest';

import { VercelTarget, targetSecrets } from '../vercel';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import * as system from '../../utils/system';
import { isDryRun } from '../../utils/helpers';

const TMP_DIR = '/tmp/craft-vercel-test';
const DEFAULT_SECRET_VALUE = 'secret_value';
const ORG_ID = 'org_1234';
const PROJECT_ID = 'prj_1234';

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

function createVercelTarget(
  targetConfig?: Record<string, unknown>,
): VercelTarget {
  return new VercelTarget(
    {
      name: 'vercel',
      ...targetConfig,
    },
    new NoneArtifactProvider(),
    { owner: 'testOwner', repo: 'testRepo' },
  );
}

beforeEach(() => {
  setTargetSecretsInEnv();
  delete process.env.VERCEL_BIN;
  delete process.env.VERCEL_ORG_ID;
  delete process.env.VERCEL_PROJECT_ID;
  (isDryRun as any).mockReturnValue(false);
});

afterEach(() => {
  removeTargetSecretsFromEnv();
  delete process.env.VERCEL_ORG_ID;
  delete process.env.VERCEL_PROJECT_ID;
  vi.clearAllMocks();
});

describe('vercel target configuration', () => {
  test('exports the expected secrets (only the token is a secret)', () => {
    expect(targetSecrets).toContain('VERCEL_TOKEN');
    expect(targetSecrets).not.toContain('VERCEL_ORG_ID');
    expect(targetSecrets).not.toContain('VERCEL_PROJECT_ID');
  });

  test('enforces the required token secret', () => {
    removeTargetSecretsFromEnv();

    expect(() => createVercelTarget({})).toThrowErrorMatchingInlineSnapshot(
      `[Error: Required value(s) VERCEL_TOKEN not found in configuration files or the environment. See the documentation for more details.]`,
    );
  });

  test('does not require VERCEL_ORG_ID or VERCEL_PROJECT_ID', () => {
    expect(() => createVercelTarget({})).not.toThrow();
  });

  test('applies default options', () => {
    const target = createVercelTarget({});

    expect(target.vercelConfig).toStrictEqual({
      VERCEL_TOKEN: DEFAULT_SECRET_VALUE,
      prebuilt: true,
      vercelCliPath: 'vercel',
      workingDir: undefined,
      orgId: undefined,
      projectId: undefined,
    });
  });

  test('picks up VERCEL_ORG_ID and VERCEL_PROJECT_ID from env when set', () => {
    process.env.VERCEL_ORG_ID = ORG_ID;
    process.env.VERCEL_PROJECT_ID = PROJECT_ID;
    const target = createVercelTarget({});
    expect(target.vercelConfig.orgId).toBe(ORG_ID);
    expect(target.vercelConfig.projectId).toBe(PROJECT_ID);
  });

  test('allows overriding default options', () => {
    const target = createVercelTarget({
      prebuilt: false,
      vercelCliPath: '/custom/vercel',
      workingDir: 'subdir',
    });

    expect(target.vercelConfig).toStrictEqual({
      VERCEL_TOKEN: DEFAULT_SECRET_VALUE,
      prebuilt: false,
      vercelCliPath: '/custom/vercel',
      workingDir: 'subdir',
      orgId: undefined,
      projectId: undefined,
    });
  });

  test('resolves vercel path from VERCEL_BIN env', () => {
    process.env.VERCEL_BIN = '/env/vercel';
    const target = createVercelTarget({});
    expect(target.vercelConfig.vercelCliPath).toBe('/env/vercel');
  });

  test('checks vercel is present in the constructor', () => {
    createVercelTarget({});
    expect(system.checkExecutableIsPresent).toHaveBeenCalledWith('vercel');
  });

  test('rejects config values that look like env-var expansions', () => {
    expect(() => createVercelTarget({ workingDir: '${VERCEL_TOKEN}' })).toThrow(
      /workingDir.*must not be an environment-variable expansion/,
    );
  });
});

describe('publish', () => {
  const revision = 'deadbeef';
  const version = '1.2.3';
  const artifact = { filename: 'vercel.zip' } as any;

  function stubArtifacts(target: VercelTarget, artifacts: any[]): void {
    target.getArtifactsForRevision = vi.fn(async () => artifacts);
    target.artifactProvider.downloadArtifact = vi.fn(
      async () => '/downloads/vercel.zip',
    );
  }

  test('deploys a prebuilt artifact to production with provenance', async () => {
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    expect(system.extractZipArchiveWithFlattening).toHaveBeenCalledWith(
      '/downloads/vercel.zip',
      TMP_DIR,
    );

    expect(system.spawnProcess).toHaveBeenCalledTimes(1);
    const [bin, args, options] = (system.spawnProcess as any).mock.calls[0];
    expect(bin).toBe('vercel');
    expect(args).toEqual([
      'deploy',
      '--prod',
      '--yes',
      '--prebuilt',
      '--meta',
      `craftRelease=${version}`,
    ]);
    expect(options.cwd).toBe(TMP_DIR);
    // Secret must be in env, not argv
    expect(options.env.VERCEL_TOKEN).toBe(DEFAULT_SECRET_VALUE);
    expect(args).not.toContain(DEFAULT_SECRET_VALUE);
  });

  test('omits --prebuilt when prebuilt is false', async () => {
    const target = createVercelTarget({ prebuilt: false });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [, args] = (system.spawnProcess as any).mock.calls[0];
    expect(args).not.toContain('--prebuilt');
  });

  test('does not forward org/project IDs when unset', async () => {
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [, , options] = (system.spawnProcess as any).mock.calls[0];
    expect('VERCEL_ORG_ID' in options.env).toBe(false);
    expect('VERCEL_PROJECT_ID' in options.env).toBe(false);
  });

  test('forwards org/project IDs when set', async () => {
    process.env.VERCEL_ORG_ID = ORG_ID;
    process.env.VERCEL_PROJECT_ID = PROJECT_ID;
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [, , options] = (system.spawnProcess as any).mock.calls[0];
    expect(options.env.VERCEL_ORG_ID).toBe(ORG_ID);
    expect(options.env.VERCEL_PROJECT_ID).toBe(PROJECT_ID);
  });

  test('deploys from workingDir subdirectory when configured', async () => {
    const target = createVercelTarget({ workingDir: 'dist' });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [, , options] = (system.spawnProcess as any).mock.calls[0];
    expect(options.cwd).toBe(`${TMP_DIR}/dist`);
  });

  test('reports an error and does not deploy when no artifacts found', async () => {
    const target = createVercelTarget({});
    stubArtifacts(target, []);

    await expect(target.publish(version, revision)).rejects.toThrow(
      /no artifacts found/,
    );
    expect(system.spawnProcess).not.toHaveBeenCalled();
  });

  test('reports an error when more than one artifact found', async () => {
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact, artifact]);

    await expect(target.publish(version, revision)).rejects.toThrow(
      /more than one Vercel archive/,
    );
    expect(system.spawnProcess).not.toHaveBeenCalled();
  });

  test('does not deploy in dry-run mode (including worktree mode)', async () => {
    (isDryRun as any).mockReturnValue(true);
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    // Artifact is still extracted (local, safe), but the remote deploy is
    // skipped.
    expect(system.extractZipArchiveWithFlattening).toHaveBeenCalled();
    expect(system.spawnProcess).not.toHaveBeenCalled();
  });
});
