import { vi, type Mock, type MockInstance, type Mocked, type MockedFunction } from 'vitest';
import { Octokit } from '@octokit/rest';

import { getFile } from '../githubApi';

const mockRepos = {
  getContent: vi.fn(),
};

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({ repos: mockRepos })),
}));

describe('getFile', () => {
  const github = new Octokit();
  const owner = 'owner';
  const repo = 'repo';

  const getContent = (github.repos.getContent as unknown) as Mock;

  test('loads and decodes the file', async () => {
    expect.assertions(2);
    const testContent = 'test content.';

    getContent.mockReturnValue({
      data: { content: Buffer.from(testContent).toString('base64') },
    });

    const content = await getFile(
      github,
      owner,
      repo,
      '/path/to/file',
      'v1.0.0'
    );
    expect(getContent).toHaveBeenCalledWith({
      owner: 'owner',
      path: '/path/to/file',
      ref: 'v1.0.0',
      repo: 'repo',
    });

    expect(content).toBe(testContent);
  });

  test('returns null for missing files', async () => {
    expect.assertions(1);

    getContent.mockImplementation(() => {
      const e = new Error('file not found') as any;
      e.status = 404;
      throw e;
    });

    const content = await getFile(
      github,
      owner,
      repo,
      '/path/to/missing',
      'v1.0.0'
    );
    expect(content).toBe(undefined);
  });

  test('rejects all other errors', async () => {
    expect.assertions(3);

    const errorText = 'internal server error';
    getContent.mockImplementation(() => {
      const e = new Error(errorText) as any;
      e.status = 500;
      throw e;
    });

    try {
      await getFile(github, owner, repo, '/path/to/missing', 'v1.0.0');
    } catch (e: any) {
      expect(e.message).toMatch(errorText);
      expect(e.status).toBe(500);
      expect(e.code).toBe(undefined);
    }
  });
});
