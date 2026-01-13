import {
  vi,
  type Mock,
  type MockedFunction,
  describe,
  test,
  expect,
  beforeEach,
} from 'vitest';
vi.mock('../../utils/githubApi.ts');
import { getGitHubClient } from '../../utils/githubApi';
import {
  GitHubArtifactProvider,
  ArtifactItem,
  WorkflowRun,
  lazyRequest,
  lazyRequestCallback,
  normalizeArtifactsConfig,
  NormalizedArtifactFilter,
} from '../github';
import { patternToRegexp } from '../../utils/filters';
import { sleep } from '../../utils/async';

class TestGitHubArtifactProvider extends GitHubArtifactProvider {
  public testGetRevisionArtifact(revision: string): Promise<ArtifactItem> {
    return this.getRevisionArtifact(revision);
  }
  public testSearchForRevisionArtifact(
    revision: string,
    getRevisionDate: lazyRequestCallback<string>
  ): Promise<ArtifactItem | null> {
    return this.searchForRevisionArtifact(revision, getRevisionDate);
  }
  public testGetWorkflowRunsForCommit(revision: string): Promise<WorkflowRun[]> {
    return this.getWorkflowRunsForCommit(revision);
  }
  public testFilterWorkflowRuns(
    runs: WorkflowRun[],
    filters: NormalizedArtifactFilter[]
  ): WorkflowRun[] {
    return this.filterWorkflowRuns(runs, filters);
  }
  public testGetArtifactsFromWorkflowRuns(
    runs: WorkflowRun[],
    filters: NormalizedArtifactFilter[]
  ): Promise<ArtifactItem[]> {
    return this.getArtifactsFromWorkflowRuns(runs, filters);
  }
}

vi.mock('../../utils/async');

describe('GitHub Artifact Provider', () => {
  let githubArtifactProvider: TestGitHubArtifactProvider;
  let mockClient: {
    actions: {
      listArtifactsForRepo: Mock;
      listWorkflowRunsForRepo: Mock;
      listWorkflowRunArtifacts: Mock;
    };
    git: {
      getCommit: Mock;
    };
  };
  let mockedSleep: Mock;

  beforeEach(() => {
    vi.resetAllMocks();

    mockClient = {
      actions: {
        listArtifactsForRepo: vi.fn(),
        listWorkflowRunsForRepo: vi.fn(),
        listWorkflowRunArtifacts: vi.fn(),
      },
      git: { getCommit: vi.fn() },
    };
    (
      getGitHubClient as MockedFunction<typeof getGitHubClient>
      // @ts-ignore we only need to mock a subset
    ).mockReturnValueOnce(mockClient);

    githubArtifactProvider = new TestGitHubArtifactProvider({
      name: 'github-test',
      repoOwner: 'getsentry',
      repoName: 'craft',
    });

    mockedSleep = sleep as Mock;
    mockedSleep.mockImplementation(() => {
      return new Promise(resolve => setTimeout(resolve, 10));
    });
  });

  describe('patternToRegexp', () => {
    test('converts regex string to RegExp', () => {
      const result = patternToRegexp('/^build-.*$/');
      expect(result).toBeInstanceOf(RegExp);
      expect(result.test('build-linux')).toBe(true);
      expect(result.test('build-macos')).toBe(true);
      expect(result.test('test-linux')).toBe(false);
    });

    test('converts regex string with modifiers', () => {
      const result = patternToRegexp('/BUILD/i');
      expect(result.test('build')).toBe(true);
      expect(result.test('BUILD')).toBe(true);
    });

    test('converts exact string to exact match RegExp', () => {
      const result = patternToRegexp('build');
      expect(result.test('build')).toBe(true);
      expect(result.test('build-linux')).toBe(false);
      expect(result.test('test')).toBe(false);
    });

    test('escapes special characters in exact match', () => {
      const result = patternToRegexp('output.tar.gz');
      expect(result.test('output.tar.gz')).toBe(true);
      expect(result.test('outputXtarXgz')).toBe(false);
    });
  });

  describe('normalizeArtifactsConfig', () => {
    test('returns empty array for undefined config', () => {
      expect(normalizeArtifactsConfig(undefined)).toEqual([]);
    });

    test('normalizes string config to array with single filter', () => {
      const result = normalizeArtifactsConfig('/^sentry-.*\\.tgz$/');
      expect(result).toHaveLength(1);
      expect(result[0].workflow).toBeUndefined();
      expect(result[0].artifacts).toHaveLength(1);
      expect(result[0].artifacts[0].test('sentry-browser-7.0.0.tgz')).toBe(true);
    });

    test('normalizes array config to single filter with multiple patterns', () => {
      const result = normalizeArtifactsConfig([
        '/^sentry-.*\\.tgz$/',
        'release-bundle',
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].workflow).toBeUndefined();
      expect(result[0].artifacts).toHaveLength(2);
      expect(result[0].artifacts[0].test('sentry-browser-7.0.0.tgz')).toBe(true);
      expect(result[0].artifacts[1].test('release-bundle')).toBe(true);
      expect(result[0].artifacts[1].test('release-bundle-extra')).toBe(false);
    });

    test('normalizes object config with exact workflow names', () => {
      const result = normalizeArtifactsConfig({
        build: 'release-artifacts',
        ci: ['output', 'bundle'],
      });
      expect(result).toHaveLength(2);

      // First filter: build -> release-artifacts
      expect(result[0].workflow?.test('build')).toBe(true);
      expect(result[0].workflow?.test('build-linux')).toBe(false);
      expect(result[0].artifacts).toHaveLength(1);
      expect(result[0].artifacts[0].test('release-artifacts')).toBe(true);

      // Second filter: ci -> [output, bundle]
      expect(result[1].workflow?.test('ci')).toBe(true);
      expect(result[1].artifacts).toHaveLength(2);
      expect(result[1].artifacts[0].test('output')).toBe(true);
      expect(result[1].artifacts[1].test('bundle')).toBe(true);
    });

    test('normalizes object config with workflow patterns', () => {
      const result = normalizeArtifactsConfig({
        '/^build-.*$/': '/^output-.*$/',
        '/^release-.*$/': ['/^dist-.*$/', 'checksums'],
      });
      expect(result).toHaveLength(2);

      // First filter: /^build-.*$/ -> /^output-.*$/
      expect(result[0].workflow?.test('build-linux')).toBe(true);
      expect(result[0].workflow?.test('build-macos')).toBe(true);
      expect(result[0].workflow?.test('test-linux')).toBe(false);
      expect(result[0].artifacts[0].test('output-x86')).toBe(true);
      expect(result[0].artifacts[0].test('output-arm')).toBe(true);

      // Second filter: /^release-.*$/ -> [/^dist-.*$/, checksums]
      expect(result[1].workflow?.test('release-production')).toBe(true);
      expect(result[1].artifacts).toHaveLength(2);
      expect(result[1].artifacts[0].test('dist-linux')).toBe(true);
      expect(result[1].artifacts[1].test('checksums')).toBe(true);
    });
  });

  describe('getRevisionArtifact', () => {
    test('it should get the artifact with the revision name from the first page', async () => {
      mockClient.actions.listArtifactsForRepo.mockResolvedValueOnce({
        status: 200,
        data: {
          total_count: 2,
          artifacts: [
            {
              id: 60233710,
              node_id: 'MDg6QXJ0aWZhY3Q2MDIzMzcxMA==',
              name: '1b843f2cbb20fdda99ef749e29e75e43e6e43b38',
              size_in_bytes: 6511029,
              url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710',
              archive_download_url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710/zip',
              expired: false,
              created_at: '2021-05-12T21:50:35Z',
              updated_at: '2021-05-12T21:50:38Z',
              expires_at: '2021-08-10T21:50:31Z',
            },
            {
              id: 60232691,
              node_id: 'MDg6QXJ0aWZhY3Q2MDIzMjY5MQ==',
              name: 'e4bcfe450e0460ec5f20b20868664171effef6f9',
              size_in_bytes: 6511029,
              url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
              archive_download_url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691/zip',
              expired: false,
              created_at: '2021-05-12T21:45:04Z',
              updated_at: '2021-05-12T21:45:07Z',
              expires_at: '2021-08-10T21:45:00Z',
            },
          ],
        },
      });
      await expect(
        githubArtifactProvider.testGetRevisionArtifact(
          '1b843f2cbb20fdda99ef749e29e75e43e6e43b38'
        )
      ).resolves.toMatchInlineSnapshot(`
              {
                "archive_download_url": "https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710/zip",
                "created_at": "2021-05-12T21:50:35Z",
                "expired": false,
                "expires_at": "2021-08-10T21:50:31Z",
                "id": 60233710,
                "name": "1b843f2cbb20fdda99ef749e29e75e43e6e43b38",
                "node_id": "MDg6QXJ0aWZhY3Q2MDIzMzcxMA==",
                "size_in_bytes": 6511029,
                "updated_at": "2021-05-12T21:50:38Z",
                "url": "https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710",
              }
            `);
    });

    test('it should get the artifact with the revision name from the second page', async () => {
      mockClient.git.getCommit.mockResolvedValueOnce({
        status: 200,
        data: {
          committer: {
            date: '2021-05-12T21:45:04Z',
          },
        },
      });
      mockClient.actions.listArtifactsForRepo
        .mockResolvedValueOnce({
          status: 200,
          data: {
            // NOTE: 101 here will force pagination to be handled.
            total_count: 101,
            artifacts: [
              {
                id: 60232691,
                node_id: 'MDg6QXJ0aWZhY3Q2MDIzMjY5MQ==',
                name: 'e4bcfe450e0460ec5f20b20868664171effef6f9',
                size_in_bytes: 6511029,
                url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
                archive_download_url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691/zip',
                expired: false,
                created_at: '2021-05-12T21:45:04Z',
                updated_at: '2021-05-12T21:45:07Z',
                expires_at: '2021-08-10T21:45:00Z',
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            total_count: 101,
            artifacts: [
              {
                id: 60233710,
                node_id: 'MDg6QXJ0aWZhY3Q2MDIzMzcxMA==',
                name: '1b843f2cbb20fdda99ef749e29e75e43e6e43b38',
                size_in_bytes: 6511029,
                url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710',
                archive_download_url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710/zip',
                expired: false,
                created_at: '2021-05-12T21:50:35Z',
                updated_at: '2021-05-12T21:50:38Z',
                expires_at: '2021-08-10T21:50:31Z',
              },
            ],
          },
        });
      await expect(
        githubArtifactProvider.testGetRevisionArtifact(
          '1b843f2cbb20fdda99ef749e29e75e43e6e43b38'
        )
      ).resolves.toMatchInlineSnapshot(`
              {
                "archive_download_url": "https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710/zip",
                "created_at": "2021-05-12T21:50:35Z",
                "expired": false,
                "expires_at": "2021-08-10T21:50:31Z",
                "id": 60233710,
                "name": "1b843f2cbb20fdda99ef749e29e75e43e6e43b38",
                "node_id": "MDg6QXJ0aWZhY3Q2MDIzMzcxMA==",
                "size_in_bytes": 6511029,
                "updated_at": "2021-05-12T21:50:38Z",
                "url": "https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710",
              }
            `);
      expect(mockClient.git.getCommit).toBeCalledTimes(1);
    });

    test('it should get the latest artifact with the same name ', async () => {
      mockClient.actions.listArtifactsForRepo.mockResolvedValueOnce({
        status: 200,
        data: {
          total_count: 2,
          artifacts: [
            {
              id: 60233710,
              node_id: 'MDg6QXJ0aWZhY3Q2MDIzMzcxMA==',
              name: '1b843f2cbb20fdda99ef749e29e75e43e6e43b38',
              size_in_bytes: 6511029,
              url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710',
              archive_download_url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710/zip',
              expired: false,
              created_at: '2021-05-12T21:50:35Z',
              updated_at: '2021-05-12T21:50:38Z',
              expires_at: '2021-08-10T21:50:31Z',
            },
            {
              id: 60232691,
              node_id: 'MDg6QXJ0aWZhY3Q2MDIzMjY5MQ==',
              name: '1b843f2cbb20fdda99ef749e29e75e43e6e43b38',
              size_in_bytes: 6511029,
              url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
              archive_download_url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691/zip',
              expired: false,
              created_at: '2021-05-12T21:45:04Z',
              updated_at: '2021-05-12T21:45:07Z',
              expires_at: '2021-08-10T21:45:00Z',
            },
          ],
        },
      });
      await expect(
        githubArtifactProvider.testGetRevisionArtifact(
          '1b843f2cbb20fdda99ef749e29e75e43e6e43b38'
        )
      ).resolves.toMatchInlineSnapshot(`
              {
                "archive_download_url": "https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710/zip",
                "created_at": "2021-05-12T21:50:35Z",
                "expired": false,
                "expires_at": "2021-08-10T21:50:31Z",
                "id": 60233710,
                "name": "1b843f2cbb20fdda99ef749e29e75e43e6e43b38",
                "node_id": "MDg6QXJ0aWZhY3Q2MDIzMzcxMA==",
                "size_in_bytes": 6511029,
                "updated_at": "2021-05-12T21:50:38Z",
                "url": "https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710",
              }
            `);
    });

    test('it should throw when no artifacts are found after 3 retries', async () => {
      mockClient.actions.listArtifactsForRepo.mockResolvedValue({
        status: 200,
        data: {
          total_count: 0,
          artifacts: [],
        },
      });

      await expect(
        githubArtifactProvider.testGetRevisionArtifact(
          '1b843f2cbb20fdda99ef749e29e75e43e6e43b38'
        )
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: Can't find any artifacts for revision "1b843f2cbb20fdda99ef749e29e75e43e6e43b38" (tries: 3)]`
      );

      expect(mockClient.actions.listArtifactsForRepo).toBeCalledTimes(3);
      expect(sleep).toBeCalledTimes(2);
    });

    test('it should throw when no artifacts with the name can be found', async () => {
      mockClient.actions.listArtifactsForRepo.mockResolvedValue({
        status: 200,
        data: {
          total_count: 2,
          artifacts: [
            {
              id: 60233710,
              node_id: 'MDg6QXJ0aWZhY3Q2MDIzMzcxMA==',
              name: '1b843f2cbb20fdda99ef749e29e75e43e6e43b38',
              size_in_bytes: 6511029,
              url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710',
              archive_download_url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710/zip',
              expired: false,
              created_at: '2021-05-12T21:50:35Z',
              updated_at: '2021-05-12T21:50:38Z',
              expires_at: '2021-08-10T21:50:31Z',
            },
            {
              id: 60232691,
              node_id: 'MDg6QXJ0aWZhY3Q2MDIzMjY5MQ==',
              name: '1b843f2cbb20fdda99ef749e29e75e43e6e43b38',
              size_in_bytes: 6511029,
              url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
              archive_download_url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691/zip',
              expired: false,
              created_at: '2021-05-12T21:45:04Z',
              updated_at: '2021-05-12T21:45:07Z',
              expires_at: '2021-08-10T21:45:00Z',
            },
          ],
        },
      });
      await expect(
        githubArtifactProvider.testGetRevisionArtifact(
          '3c2e87573d3bd16f61cf08fece0638cc47a4fc22'
        )
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: Can't find any artifacts for revision "3c2e87573d3bd16f61cf08fece0638cc47a4fc22" (tries: 3)]`
      );
      expect(sleep).toBeCalledTimes(2);
    });
  });

  describe('searchForRevisionArtifact', () => {
    test('it should get the artifact from second page', async () => {
      mockClient.actions.listArtifactsForRepo
        .mockResolvedValueOnce({
          status: 200,
          data: {
            // NOTE: 101 here will force pagination to be handled.
            total_count: 101,
            artifacts: [
              {
                id: 60232691,
                node_id: 'MDg6QXJ0aWZhY3Q2MDIzMjY5MQ==',
                name: 'e4bcfe450e0460ec5f20b20868664171effef6f9',
                size_in_bytes: 6511029,
                url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
                archive_download_url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691/zip',
                expired: false,
                created_at: '2021-05-12T21:45:04Z',
                updated_at: '2021-05-12T21:45:07Z',
                expires_at: '2021-08-10T21:45:00Z',
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            total_count: 101,
            artifacts: [
              {
                id: 60233710,
                node_id: 'MDg6QXJ0aWZhY3Q2MDIzMzcxMA==',
                name: '1b843f2cbb20fdda99ef749e29e75e43e6e43b38',
                size_in_bytes: 6511029,
                url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710',
                archive_download_url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710/zip',
                expired: false,
                created_at: '2021-05-12T21:50:35Z',
                updated_at: '2021-05-12T21:50:38Z',
                expires_at: '2021-08-10T21:50:31Z',
              },
            ],
          },
        });

      const getRevisionDateCallback = vi
        .fn()
        .mockResolvedValueOnce('2020-05-12T21:45:04Z');

      await expect(
        githubArtifactProvider.testSearchForRevisionArtifact(
          '1b843f2cbb20fdda99ef749e29e75e43e6e43b38',
          lazyRequest<string>(() => {
            return getRevisionDateCallback();
          })
        )
      ).resolves.toMatchInlineSnapshot(`
        {
          "archive_download_url": "https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710/zip",
          "created_at": "2021-05-12T21:50:35Z",
          "expired": false,
          "expires_at": "2021-08-10T21:50:31Z",
          "id": 60233710,
          "name": "1b843f2cbb20fdda99ef749e29e75e43e6e43b38",
          "node_id": "MDg6QXJ0aWZhY3Q2MDIzMzcxMA==",
          "size_in_bytes": 6511029,
          "updated_at": "2021-05-12T21:50:38Z",
          "url": "https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710",
        }
      `);
      expect(mockClient.actions.listArtifactsForRepo).toBeCalledTimes(2);
      expect(getRevisionDateCallback).toBeCalledTimes(1);
    });

    test('it should return null if all pages are processed', async () => {
      mockClient.actions.listArtifactsForRepo
        .mockResolvedValueOnce({
          status: 200,
          data: {
            // NOTE: 201 here will force pagination to be handled.
            total_count: 201,
            artifacts: [
              {
                id: 60232691,
                node_id: 'MDg6QXJ0aWZhY3Q2MDIzMjY5MQ==',
                name: 'e4bcfe450e0460ec5f20b20868664171effef6f9',
                size_in_bytes: 6511029,
                url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
                archive_download_url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691/zip',
                expired: false,
                created_at: '2021-05-12T21:45:04Z',
                updated_at: '2021-05-12T21:45:07Z',
                expires_at: '2021-08-10T21:45:00Z',
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            total_count: 201,
            artifacts: [
              {
                id: 60232691,
                node_id: 'MDg6QXJ0aWZhY3Q2MDIzMjY5MQ==',
                name: 'e4bcfe450e0460ec5f20b20868664171effef6f9',
                size_in_bytes: 6511029,
                url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
                archive_download_url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691/zip',
                expired: false,
                created_at: '2021-05-12T21:45:04Z',
                updated_at: '2021-05-12T21:45:07Z',
                expires_at: '2021-08-10T21:45:00Z',
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            total_count: 201,
            artifacts: [
              {
                id: 60232691,
                node_id: 'MDg6QXJ0aWZhY3Q2MDIzMjY5MQ==',
                name: 'e4bcfe450e0460ec5f20b20868664171effef6f9',
                size_in_bytes: 6511029,
                url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
                archive_download_url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691/zip',
                expired: false,
                created_at: '2021-05-12T21:45:04Z',
                updated_at: '2021-05-12T21:45:07Z',
                expires_at: '2021-08-10T21:45:00Z',
              },
            ],
          },
        });

      const getRevisionDateCallback = vi
        .fn()
        .mockResolvedValueOnce('2020-05-12T21:45:04Z');

      await expect(
        githubArtifactProvider.testSearchForRevisionArtifact(
          '1b843f2cbb20fdda99ef749e29e75e43e6e43b38',
          lazyRequest<string>(getRevisionDateCallback)
        )
      ).resolves.toMatchInlineSnapshot(`null`);
      expect(mockClient.actions.listArtifactsForRepo).toBeCalledTimes(3);
      expect(getRevisionDateCallback).toBeCalledTimes(1);
    });

    test('it should stop paging results if commit is after last artifact', async () => {
      mockClient.actions.listArtifactsForRepo.mockResolvedValueOnce({
        status: 200,
        data: {
          // NOTE: 101 here will force pagination to be handled.
          total_count: 101,
          artifacts: [
            {
              id: 60232691,
              node_id: 'MDg6QXJ0aWZhY3Q2MDIzMjY5MQ==',
              name: 'e4bcfe450e0460ec5f20b20868664171effef6f9',
              size_in_bytes: 6511029,
              url: 'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
              archive_download_url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691/zip',
              expired: false,
              created_at: '2020-06-12T21:45:04Z',
              updated_at: '2020-06-12T21:45:07Z',
              expires_at: '2020-08-10T21:45:00Z',
            },
          ],
        },
      });

      const getRevisionDateCallback = vi
        .fn()
        .mockResolvedValueOnce('2021-05-12T21:45:04Z');

      await expect(
        githubArtifactProvider.testSearchForRevisionArtifact(
          '1b843f2cbb20fdda99ef749e29e75e43e6e43b38',
          lazyRequest<string>(() => {
            return getRevisionDateCallback();
          })
        )
      ).resolves.toMatchInlineSnapshot(`null`);
      expect(mockClient.actions.listArtifactsForRepo).toBeCalledTimes(1);
      expect(getRevisionDateCallback).toBeCalledTimes(1);
    });
  });

  describe('getWorkflowRunsForCommit', () => {
    test('fetches workflow runs for a commit', async () => {
      mockClient.actions.listWorkflowRunsForRepo.mockResolvedValueOnce({
        status: 200,
        data: {
          total_count: 2,
          workflow_runs: [
            { id: 1, name: 'Build & Test' },
            { id: 2, name: 'Lint' },
          ],
        },
      });

      const runs = await githubArtifactProvider.testGetWorkflowRunsForCommit(
        'abc123'
      );

      expect(runs).toHaveLength(2);
      expect(runs[0].name).toBe('Build & Test');
      expect(runs[1].name).toBe('Lint');
      expect(mockClient.actions.listWorkflowRunsForRepo).toBeCalledWith({
        owner: 'getsentry',
        repo: 'craft',
        head_sha: 'abc123',
        per_page: 100,
        page: 1,
      });
    });

    test('handles pagination for workflow runs', async () => {
      // Create array of 100 runs for first page
      const firstPageRuns = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Workflow ${i + 1}`,
      }));

      mockClient.actions.listWorkflowRunsForRepo
        .mockResolvedValueOnce({
          status: 200,
          data: {
            total_count: 105,
            workflow_runs: firstPageRuns,
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            total_count: 105,
            workflow_runs: [
              { id: 101, name: 'Workflow 101' },
              { id: 102, name: 'Workflow 102' },
              { id: 103, name: 'Workflow 103' },
              { id: 104, name: 'Workflow 104' },
              { id: 105, name: 'Workflow 105' },
            ],
          },
        });

      const runs = await githubArtifactProvider.testGetWorkflowRunsForCommit(
        'abc123'
      );

      expect(runs).toHaveLength(105);
      expect(mockClient.actions.listWorkflowRunsForRepo).toBeCalledTimes(2);
    });
  });

  describe('filterWorkflowRuns', () => {
    const mockRuns = [
      { id: 1, name: 'Build & Test' },
      { id: 2, name: 'build-linux' },
      { id: 3, name: 'build-macos' },
      { id: 4, name: 'Lint' },
    ] as WorkflowRun[];

    test('returns all runs when no workflow filters are specified', () => {
      const filters: NormalizedArtifactFilter[] = [
        { workflow: undefined, artifacts: [/^output$/] },
      ];

      const result = githubArtifactProvider.testFilterWorkflowRuns(
        mockRuns,
        filters
      );
      expect(result).toHaveLength(4);
    });

    test('filters runs by exact workflow name', () => {
      const filters: NormalizedArtifactFilter[] = [
        { workflow: /^Build & Test$/, artifacts: [/^output$/] },
      ];

      const result = githubArtifactProvider.testFilterWorkflowRuns(
        mockRuns,
        filters
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Build & Test');
    });

    test('filters runs by workflow pattern', () => {
      const filters: NormalizedArtifactFilter[] = [
        { workflow: /^build-.*$/, artifacts: [/^output$/] },
      ];

      const result = githubArtifactProvider.testFilterWorkflowRuns(
        mockRuns,
        filters
      );
      expect(result).toHaveLength(2);
      expect(result.map(r => r.name)).toEqual(['build-linux', 'build-macos']);
    });

    test('combines multiple workflow filters', () => {
      const filters: NormalizedArtifactFilter[] = [
        { workflow: /^Build & Test$/, artifacts: [/^output$/] },
        { workflow: /^Lint$/, artifacts: [/^report$/] },
      ];

      const result = githubArtifactProvider.testFilterWorkflowRuns(
        mockRuns,
        filters
      );
      expect(result).toHaveLength(2);
      expect(result.map(r => r.name)).toEqual(['Build & Test', 'Lint']);
    });
  });

  describe('getArtifactsFromWorkflowRuns', () => {
    test('fetches and filters artifacts from workflow runs', async () => {
      const mockRuns = [
        { id: 1, name: 'Build & Test' },
        { id: 2, name: 'Lint' },
      ] as WorkflowRun[];

      mockClient.actions.listWorkflowRunArtifacts
        .mockResolvedValueOnce({
          status: 200,
          data: {
            total_count: 2,
            artifacts: [
              { id: 101, name: 'craft-binary' },
              { id: 102, name: 'craft-docs' },
            ],
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            total_count: 1,
            artifacts: [{ id: 201, name: 'lint-report' }],
          },
        });

      const filters: NormalizedArtifactFilter[] = [
        { workflow: /^Build & Test$/, artifacts: [/^craft-/] },
      ];

      const artifacts =
        await githubArtifactProvider.testGetArtifactsFromWorkflowRuns(
          mockRuns,
          filters
        );

      expect(artifacts).toHaveLength(2);
      expect(artifacts.map(a => a.name)).toEqual(['craft-binary', 'craft-docs']);
    });

    test('matches artifacts without workflow filter (all workflows)', async () => {
      const mockRuns = [
        { id: 1, name: 'Build & Test' },
        { id: 2, name: 'Lint' },
      ] as WorkflowRun[];

      mockClient.actions.listWorkflowRunArtifacts
        .mockResolvedValueOnce({
          status: 200,
          data: {
            total_count: 1,
            artifacts: [{ id: 101, name: 'craft-binary' }],
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            total_count: 1,
            artifacts: [{ id: 201, name: 'craft-report' }],
          },
        });

      const filters: NormalizedArtifactFilter[] = [
        { workflow: undefined, artifacts: [/^craft-/] },
      ];

      const artifacts =
        await githubArtifactProvider.testGetArtifactsFromWorkflowRuns(
          mockRuns,
          filters
        );

      expect(artifacts).toHaveLength(2);
      expect(artifacts.map(a => a.name)).toEqual([
        'craft-binary',
        'craft-report',
      ]);
    });

    test('does not add duplicate artifacts', async () => {
      const mockRuns = [{ id: 1, name: 'Build & Test' }] as WorkflowRun[];

      mockClient.actions.listWorkflowRunArtifacts.mockResolvedValueOnce({
        status: 200,
        data: {
          total_count: 1,
          artifacts: [{ id: 101, name: 'craft-binary' }],
        },
      });

      // Two filters that both match the same artifact
      const filters: NormalizedArtifactFilter[] = [
        { workflow: /^Build/, artifacts: [/^craft-/] },
        { workflow: undefined, artifacts: [/binary$/] },
      ];

      const artifacts =
        await githubArtifactProvider.testGetArtifactsFromWorkflowRuns(
          mockRuns,
          filters
        );

      expect(artifacts).toHaveLength(1);
    });
  });
});
