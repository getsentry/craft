import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/system', () => ({
  checkExecutableIsPresent: vi.fn(),
  spawnProcess: vi.fn(),
}));

vi.mock('../../utils/async', async () => {
  const actual =
    await vi.importActual<typeof import('../../utils/async')>(
      '../../utils/async',
    );
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../utils/githubApi', () => ({
  getFile: vi.fn(),
  getGitHubClient: vi.fn().mockReturnValue({}),
}));

import { CocoapodsTarget } from '../cocoapods';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { spawnProcess } from '../../utils/system';
import { getFile } from '../../utils/githubApi';

const mockSpawnProcess = vi.mocked(spawnProcess);
const mockGetFile = vi.mocked(getFile);

describe('CocoapodsTarget', () => {
  const cleanEnv = { ...process.env };
  let target: CocoapodsTarget;

  beforeEach(() => {
    process.env = { ...cleanEnv, GITHUB_TOKEN: 'test-token' };
    vi.clearAllMocks();

    target = new CocoapodsTarget(
      { name: 'cocoapods', specPath: 'MyLib.podspec' },
      new NoneArtifactProvider(),
      { owner: 'testOwner', repo: 'testRepo' },
    );

    // Default: getFile returns a valid podspec
    mockGetFile.mockResolvedValue('Pod::Spec.new { |s| s.name = "MyLib" }');
  });

  afterEach(() => {
    process.env = cleanEnv;
  });

  describe('publish', () => {
    it('succeeds without retry on happy path', async () => {
      mockSpawnProcess.mockResolvedValue(undefined);

      await target.publish('1.0.0', 'abc123');

      // pod setup + pod trunk push = 2 calls
      expect(mockSpawnProcess).toHaveBeenCalledTimes(2);
      expect(mockSpawnProcess).toHaveBeenCalledWith('pod', ['setup']);
      expect(mockSpawnProcess).toHaveBeenCalledWith(
        'pod',
        ['trunk', 'push', 'MyLib.podspec', '--allow-warnings', '--synchronous'],
        expect.objectContaining({ cwd: expect.any(String) }),
      );
    });

    it('retries on transient CDN timeout error', async () => {
      mockSpawnProcess
        // pod setup
        .mockResolvedValueOnce(undefined)
        // first pod trunk push — transient failure
        .mockRejectedValueOnce(
          new Error(
            'Process "pod" errored with code 1\n\nSTDERR: CDN: trunk.cocoapods.org: timeout',
          ),
        )
        // second pod trunk push — success
        .mockResolvedValueOnce(undefined);

      await target.publish('1.0.0', 'abc123');

      // pod setup (1) + pod trunk push fail (1) + pod trunk push success (1)
      expect(mockSpawnProcess).toHaveBeenCalledTimes(3);
    });

    it('retries on transient ETIMEDOUT error', async () => {
      mockSpawnProcess
        .mockResolvedValueOnce(undefined) // pod setup
        .mockRejectedValueOnce(new Error('ETIMEDOUT connecting to trunk'))
        .mockResolvedValueOnce(undefined); // retry succeeds

      await target.publish('1.0.0', 'abc123');

      expect(mockSpawnProcess).toHaveBeenCalledTimes(3);
    });

    it('retries on 503 server error', async () => {
      mockSpawnProcess
        .mockResolvedValueOnce(undefined) // pod setup
        .mockRejectedValueOnce(
          new Error('503 Service Unavailable from trunk.cocoapods.org'),
        )
        .mockResolvedValueOnce(undefined); // retry succeeds

      await target.publish('1.0.0', 'abc123');

      expect(mockSpawnProcess).toHaveBeenCalledTimes(3);
    });

    it('treats "already published" as success during retry', async () => {
      mockSpawnProcess
        .mockResolvedValueOnce(undefined) // pod setup
        // first attempt: transient timeout (server may have succeeded)
        .mockRejectedValueOnce(new Error('CDN: trunk.cocoapods.org: timeout'))
        // retry: fails with "already published" because first attempt
        // actually succeeded on the server
        .mockRejectedValueOnce(
          new Error(
            'Process "pod" errored with code 1\n\nSTDERR: [!] MyLib (1.0.0) has already been pushed',
          ),
        );

      // Should succeed — "already published" is treated as success
      await target.publish('1.0.0', 'abc123');

      expect(mockSpawnProcess).toHaveBeenCalledTimes(3);
    });

    it('does not retry on permanent spec validation error', async () => {
      mockSpawnProcess
        .mockResolvedValueOnce(undefined) // pod setup
        .mockRejectedValueOnce(
          new Error(
            'Process "pod" errored with code 1\n\nSTDERR: [!] The spec did not pass validation',
          ),
        );

      await expect(target.publish('1.0.0', 'abc123')).rejects.toThrow(
        'Cancelled retry',
      );

      // pod setup (1) + pod trunk push fail (1) — no retry
      expect(mockSpawnProcess).toHaveBeenCalledTimes(2);
    });

    it('does not retry on authentication error', async () => {
      mockSpawnProcess
        .mockResolvedValueOnce(undefined) // pod setup
        .mockRejectedValueOnce(
          new Error('Authentication token is invalid or unverified'),
        );

      await expect(target.publish('1.0.0', 'abc123')).rejects.toThrow(
        'Cancelled retry',
      );

      expect(mockSpawnProcess).toHaveBeenCalledTimes(2);
    });

    it('exhausts retries and throws RetryError on persistent transient errors', async () => {
      mockSpawnProcess
        .mockResolvedValueOnce(undefined) // pod setup
        // All 5 retries fail with transient errors
        .mockRejectedValue(new Error('CDN: trunk.cocoapods.org: timeout'));

      await expect(target.publish('1.0.0', 'abc123')).rejects.toThrow(
        'Max retries reached: 5',
      );

      // pod setup (1) + 5 failed pod trunk push attempts
      expect(mockSpawnProcess).toHaveBeenCalledTimes(6);
    });
  });
});
