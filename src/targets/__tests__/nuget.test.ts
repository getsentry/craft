import { vi, type Mock } from 'vitest';
import { spawnProcess } from '../../utils/system';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { ConfigurationError } from '../../utils/errors';
import {
  DEFAULT_NUGET_PUSH_TIMEOUT_SECONDS,
  DEFAULT_NUGET_SERVER_URL,
  NUGET_DOTNET_BIN,
  NugetTarget,
} from '../nuget';

vi.mock('../../utils/system');

function getNugetTarget(options: Record<string, unknown> = {}): NugetTarget {
  return new NugetTarget(
    { name: 'nuget', ...options },
    new NoneArtifactProvider(),
  );
}

describe('NugetTarget', () => {
  const oldEnv = process.env;

  beforeEach(() => {
    process.env = { ...oldEnv, NUGET_API_TOKEN: 'test-token' };
    (spawnProcess as Mock).mockReset();
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  test('defaults the push timeout', () => {
    const target = getNugetTarget();
    expect(target.nugetConfig.timeout).toBe(DEFAULT_NUGET_PUSH_TIMEOUT_SECONDS);
    expect(DEFAULT_NUGET_PUSH_TIMEOUT_SECONDS).toBe(1800);
  });

  test('uses the configured push timeout', () => {
    const target = getNugetTarget({ timeout: 3600 });
    expect(target.nugetConfig.timeout).toBe(3600);
  });

  test.each([0, -1, 1.5, '600'])('rejects invalid timeout %j', timeout => {
    expect(() => getNugetTarget({ timeout })).toThrow(ConfigurationError);
  });

  test('passes --timeout to dotnet nuget push', async () => {
    const target = getNugetTarget({ timeout: 900 });
    await target.uploadAsset('/tmp/Sentry.1.2.3.nupkg');

    expect(spawnProcess).toHaveBeenCalledWith(
      NUGET_DOTNET_BIN,
      [
        'nuget',
        'push',
        '/tmp/Sentry.1.2.3.nupkg',
        '--api-key',
        '${NUGET_API_TOKEN}',
        '--skip-duplicate',
        '--source',
        DEFAULT_NUGET_SERVER_URL,
        '--timeout',
        '900',
      ],
      { cwd: '/' },
    );
  });
});
