import { vi, type Mock, type MockInstance, type Mocked, type MockedFunction } from 'vitest';
vi.mock('../../utils/githubApi.ts');
import { getGitHubClient } from '../../utils/githubApi';
import {
  GitHubArtifactProvider,
  ArtifactItem,
  lazyRequest,
  lazyRequestCallback,
} from '../github';
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
}

vi.mock('../../utils/async');

describe('GitHub Artifact Provider', () => {
  let githubArtifactProvider: TestGitHubArtifactProvider;
  let mockClient: {
    actions: {
      listArtifactsForRepo: Mock;
    };
    git: {
      getCommit: Mock;
    };
  };
  let mockedSleep;

  beforeEach(() => {
    vi.resetAllMocks();

    mockClient = {
      actions: { listArtifactsForRepo: vi.fn() },
      git: { getCommit: vi.fn() },
    };
    (getGitHubClient as MockedFunction<
      typeof getGitHubClient
      // @ts-ignore we only need to mock a subset
    >).mockReturnValueOnce(mockClient);

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
              url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710',
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
              url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
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
        // TODO(sentry): Could not automatically migrate - see https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md#deprecate-hub
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
                url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
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
                url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710',
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
        // TODO(sentry): Could not automatically migrate - see https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md#deprecate-hub
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
              url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710',
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
              url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
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
        // TODO(sentry): Could not automatically migrate - see https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md#deprecate-hub
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
        // TODO(sentry): Could not automatically migrate - see https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md#deprecate-hub
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
              url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710',
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
              url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
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
        // TODO(sentry): Could not automatically migrate - see https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md#deprecate-hub
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
                url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
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
                url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60233710',
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
        // TODO(sentry): Could not automatically migrate - see https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md#deprecate-hub
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
                url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
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
                url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
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
                url:
                  'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
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
        // TODO(sentry): Could not automatically migrate - see https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md#deprecate-hub
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
              url:
                'https://api.github.com/repos/getsentry/craft/actions/artifacts/60232691',
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
        // TODO(sentry): Could not automatically migrate - see https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md#deprecate-hub
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
});
