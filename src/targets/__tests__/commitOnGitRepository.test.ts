import { vi, type Mock, type MockInstance, type Mocked, type MockedFunction } from 'vitest';
import { pushArchiveToGitRepository } from '../commitOnGitRepository';
import childProcess from 'child_process';

const execSyncSpy = vi.spyOn(childProcess, 'execSync');

const mockClone = vi.fn();
const mockCheckout = vi.fn();
const mockRaw = vi.fn();
const mockCommit = vi.fn();
const mockAddTag = vi.fn();

vi.mock('simple-git', () => () => ({
  clone: mockClone,
  checkout: mockCheckout,
  raw: mockRaw,
  commit: mockCommit,
  addTag: mockAddTag,
}));

test('Basic commit-on-git-repository functionality', async () => {
  execSyncSpy.mockImplementationOnce(() => {
    return Buffer.from('noop');
  });

  await pushArchiveToGitRepository({
    archivePath: '/tmp/my-archive.tgz',
    branch: 'main',
    createTag: true,
    repositoryUrl: 'https://github.com/getsentry/sentry-deno',
    stripComponents: 1,
    version: '1.2.3',
  });

  expect(mockClone).toHaveBeenCalledWith(
    'https://github.com/getsentry/sentry-deno',
    expect.any(String)
  );
  expect(mockCheckout).toHaveBeenCalledWith('main');
  expect(mockRaw).toHaveBeenCalledWith('rm', '-r', '.');
  expect(execSyncSpy).toHaveBeenCalledWith(
    'tar -zxvf /tmp/my-archive.tgz --strip-components 1',
    expect.objectContaining({ cwd: expect.any(String) })
  );
  expect(mockRaw).toHaveBeenCalledWith('add', '--all');
  expect(mockCommit).toHaveBeenCalledWith('release: 1.2.3');
  expect(mockAddTag).toHaveBeenCalledWith('1.2.3');
  expect(mockRaw).toHaveBeenCalledWith(
    'push',
    'https://github.com/getsentry/sentry-deno',
    '--force'
  );
  expect(mockRaw).toHaveBeenCalledWith(
    'push',
    'https://github.com/getsentry/sentry-deno',
    '--tags'
  );
});

describe('With authentication', () => {
  let oldToken: string | undefined;

  beforeEach(() => {
    oldToken = process.env['GITHUB_API_TOKEN'];
  });

  afterEach(() => {
    process.env['GITHUB_API_TOKEN'] = oldToken;
  });

  test('adds GitHub pat to repository url', async () => {
    execSyncSpy.mockImplementationOnce(() => {
      return Buffer.from('noop');
    });

    process.env['GITHUB_API_TOKEN'] = 'test-token';

    await pushArchiveToGitRepository({
      archivePath: '/tmp/my-archive.tgz',
      branch: 'main',
      createTag: true,
      repositoryUrl: 'https://github.com/getsentry/sentry-deno',
      stripComponents: 1,
      version: '1.2.3',
    });

    expect(mockClone).toHaveBeenCalledWith(
      'https://test-token@github.com/getsentry/sentry-deno',
      expect.any(String)
    );

    expect(mockRaw).toHaveBeenCalledWith(
      'push',
      'https://test-token@github.com/getsentry/sentry-deno',
      '--force'
    );

    expect(mockRaw).toHaveBeenCalledWith(
      'push',
      'https://test-token@github.com/getsentry/sentry-deno',
      '--tags'
    );
  });
});
