import { pushArchiveToGitRepository } from '../commitOnGitRepository';
import childProcess from 'child_process';

const execSyncSpy = jest.spyOn(childProcess, 'execSync');

execSyncSpy.mockImplementationOnce(() => {
  return Buffer.from('noop');
});

const mockClone = jest.fn();
const mockCheckout = jest.fn();
const mockRaw = jest.fn();
const mockCommit = jest.fn();
const mockAddTag = jest.fn();
const mockPushTags = jest.fn();

jest.mock('simple-git', () => () => ({
  clone: mockClone,
  checkout: mockCheckout,
  raw: mockRaw,
  commit: mockCommit,
  addTag: mockAddTag,
  pushTags: mockPushTags,
}));

test('Basic commit-on-git-repository functionality', async () => {
  await pushArchiveToGitRepository({
    archivePath: '/tmp/my-archive.tgz',
    branch: 'main',
    createTag: true,
    repositoryUrl: 'git@github.com:getsentry/craft-test-repo.git',
    stripComponents: 1,
    version: '1.2.3',
  });

  expect(mockClone).toHaveBeenCalledWith(
    'git@github.com:getsentry/craft-test-repo.git',
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
  expect(mockRaw).toHaveBeenCalledWith('push', '--force');
  expect(mockPushTags).toHaveBeenCalled();
});
