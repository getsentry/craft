import { vi, describe, test, expect, beforeEach, afterAll } from 'vitest';
import { PypiTarget } from '../pypi';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { RemoteArtifact } from '../../artifact_providers/base';

vi.mock('../../utils/system', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/system')>();
  return {
    ...actual,
    checkExecutableIsPresent: vi.fn(),
  };
});

describe('pypi', () => {
  const oldEnv = { ...process.env };

  beforeEach(() => {
    process.env.TWINE_USERNAME = '__token__';
    process.env.TWINE_PASSWORD = 'getsentry/craft:bogus';
  });

  afterAll(() => {
    process.env = { ...oldEnv };
  });

  test('it uploads all artifacts in a single twine call', async () => {
    const target = new PypiTarget({ name: 'pypi' }, new NoneArtifactProvider());
    target.getArtifactsForRevision = vi.fn().mockResolvedValueOnce([
      { filename: 'pkg-1-py3-none-macos_11_0_arm64.whl' },
      { filename: 'pkg-1-py3-none-manylinux_2_17_x86_64.whl' },
      { filename: 'pkg-1.tar.gz' },
    ]);
    target.artifactProvider.downloadArtifact = vi.fn(
      async (
        artifact: RemoteArtifact,
        _downloadDirectory?: string | undefined
      ) => `downloaded/path/${artifact.filename}`
    );
    const upload = vi.fn();
    target.uploadAssets = upload;

    await target.publish('version', 'deadbeef');

    expect(upload.mock.lastCall![0]).toStrictEqual([
      'downloaded/path/pkg-1-py3-none-macos_11_0_arm64.whl',
      'downloaded/path/pkg-1-py3-none-manylinux_2_17_x86_64.whl',
      'downloaded/path/pkg-1.tar.gz',
    ]);
  });
});
