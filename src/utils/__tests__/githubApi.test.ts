import Github from '@octokit/rest';

import { getFile } from '../githubApi';

const mockRepos = {
  getContents: jest.fn(),
};

jest.mock('@octokit/rest', () =>
  jest.fn().mockImplementation(() => ({ repos: mockRepos }))
);

describe('getFile', () => {
  const github = new Github();
  const owner = 'owner';
  const repo = 'repo';

  const getContents = (github.repos.getContents as unknown) as jest.Mock;

  test('loads and decodes the file', async () => {
    expect.assertions(2);
    const testContent = 'test content.';

    getContents.mockReturnValue({
      data: { content: Buffer.from(testContent).toString('base64') },
    });

    const content = await getFile(
      github,
      owner,
      repo,
      '/path/to/file',
      'v1.0.0'
    );
    expect(getContents).toHaveBeenCalledWith({
      owner: 'owner',
      path: '/path/to/file',
      ref: 'v1.0.0',
      repo: 'repo',
    });

    expect(content).toBe(testContent);
  });

  test('returns null for missing files', async () => {
    expect.assertions(1);

    getContents.mockImplementation(() => {
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
    getContents.mockImplementation(() => {
      const e = new Error(errorText) as any;
      e.status = 500;
      throw e;
    });

    try {
      await getFile(github, owner, repo, '/path/to/missing', 'v1.0.0');
    } catch (e) {
      expect(e.message).toMatch(errorText);
      expect(e.status).toBe(500);
      expect(e.code).toBe(undefined);
    }
  });
});
