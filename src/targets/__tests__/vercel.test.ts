import { vi } from 'vitest';

import { createDeployment } from '@vercel/client';

import { VercelTarget, targetSecrets } from '../vercel';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import * as system from '../../utils/system';
import { isDryRun } from '../../utils/helpers';

const TMP_DIR = '/tmp/craft-vercel-test';
const DEFAULT_SECRET_VALUE = 'secret_value';
const ORG_ID = 'org_1234';
const PROJECT_ID = 'prj_1234';

vi.mock('../../utils/helpers');

vi.mock('@vercel/client', () => ({
  createDeployment: vi.fn(),
}));

vi.mock('../../utils/system', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/system')>();
  return {
    ...actual,
    extractZipArchive: vi.fn(async () => undefined),
  };
});

vi.mock('../../utils/files', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/files')>();
  return {
    ...actual,
    withTempDir: async (cb: (dir: string) => Promise<void>) => cb(TMP_DIR),
  };
});

function mockDeployment(url = 'my-app.vercel.app'): void {
  (createDeployment as any).mockImplementation(async function* () {
    yield { type: 'ready', payload: { url } };
  });
}

function mockDeploymentWithAlias(url = 'my-app.vercel.app'): void {
  (createDeployment as any).mockImplementation(async function* () {
    yield { type: 'ready', payload: { url } };
    yield { type: 'alias-assigned', payload: { url } };
  });
}

function mockDeploymentError(error: Error): void {
  (createDeployment as any).mockImplementation(async function* () {
    yield { type: 'error', payload: error };
  });
}

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
      workingDir: 'subdir',
    });

    expect(target.vercelConfig).toStrictEqual({
      VERCEL_TOKEN: DEFAULT_SECRET_VALUE,
      prebuilt: false,
      workingDir: 'subdir',
      orgId: undefined,
      projectId: undefined,
    });
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
    mockDeployment();
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    expect(system.extractZipArchive).toHaveBeenCalledWith(
      '/downloads/vercel.zip',
      TMP_DIR,
    );

    expect(createDeployment).toHaveBeenCalledTimes(1);
    const [clientOptions, deploymentOptions] = (createDeployment as any).mock
      .calls[0];
    expect(clientOptions.token).toBe(DEFAULT_SECRET_VALUE);
    expect(clientOptions.path).toBe(TMP_DIR);
    expect(clientOptions.prebuilt).toBe(true);
    expect(clientOptions.skipAutoDetectionConfirmation).toBe(true);
    expect(deploymentOptions.target).toBe('production');
    expect(deploymentOptions.meta.release).toBe(version);
  });

  test('omits prebuilt when prebuilt is false', async () => {
    mockDeployment();
    const target = createVercelTarget({ prebuilt: false });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [clientOptions] = (createDeployment as any).mock.calls[0];
    expect(clientOptions.prebuilt).toBe(false);
  });

  test('does not forward org/project IDs when unset', async () => {
    mockDeployment();
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [clientOptions, deploymentOptions] = (createDeployment as any).mock
      .calls[0];
    expect(clientOptions.teamId).toBeUndefined();
    expect('project' in deploymentOptions).toBe(false);
  });

  test('forwards org ID when set', async () => {
    mockDeployment();
    process.env.VERCEL_ORG_ID = ORG_ID;
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [clientOptions] = (createDeployment as any).mock.calls[0];
    expect(clientOptions.teamId).toBe(ORG_ID);
  });

  test('links the deployment to the project when VERCEL_PROJECT_ID is set', async () => {
    mockDeployment();
    process.env.VERCEL_PROJECT_ID = PROJECT_ID;
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [, deploymentOptions] = (createDeployment as any).mock.calls[0];
    expect(deploymentOptions.project).toBe(PROJECT_ID);
  });

  test('deploys from workingDir subdirectory when configured', async () => {
    mockDeployment();
    const target = createVercelTarget({ workingDir: 'dist' });
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    const [clientOptions] = (createDeployment as any).mock.calls[0];
    expect(clientOptions.path).toBe(`${TMP_DIR}/dist`);
  });

  test('reports an error and does not deploy when no artifacts found', async () => {
    mockDeployment();
    const target = createVercelTarget({});
    stubArtifacts(target, []);

    await expect(target.publish(version, revision)).rejects.toThrow(
      /no artifacts found/,
    );
    expect(createDeployment).not.toHaveBeenCalled();
  });

  test('reports an error when more than one artifact found', async () => {
    mockDeployment();
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact, artifact]);

    await expect(target.publish(version, revision)).rejects.toThrow(
      /more than one Vercel archive/,
    );
    expect(createDeployment).not.toHaveBeenCalled();
  });

  test('does not deploy in dry-run mode (including worktree mode)', async () => {
    (isDryRun as any).mockReturnValue(true);
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    // Artifact is still extracted (local, safe), but the remote deploy is
    // skipped.
    expect(system.extractZipArchive).toHaveBeenCalled();
    expect(createDeployment).not.toHaveBeenCalled();
  });

  test('throws when the deploy stream yields an error event', async () => {
    mockDeploymentError(new Error('boom'));
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await expect(target.publish(version, revision)).rejects.toThrow(/boom/);
  });

  test('succeeds when the deploy stream yields alias-assigned after ready', async () => {
    mockDeploymentWithAlias();
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    expect(createDeployment).toHaveBeenCalledTimes(1);
  });

  test('succeeds with a ready deployment when no alias-assigned event arrives', async () => {
    mockDeployment();
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await target.publish(version, revision);

    expect(createDeployment).toHaveBeenCalledTimes(1);
  });

  test('throws when the stream ends without a ready deployment', async () => {
    (createDeployment as any).mockImplementation(async function* () {
      // Stream ends without ready/alias-assigned/error events.
      yield { type: 'created', payload: { url: 'x.vercel.app' } };
    });
    const target = createVercelTarget({});
    stubArtifacts(target, [artifact]);

    await expect(target.publish(version, revision)).rejects.toThrow(
      /without a ready deployment/,
    );
  });
});
