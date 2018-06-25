import * as OctokitRest from '@octokit/rest';

import { getFile } from '../github';

const mockRepos = {
  getContent: jest.fn(),
};

// TODO rewrite with module mock, port github helpers from probot-release
jest.mock('@octokit/rest', () =>
  jest.fn().mockImplementation(() => ({ repos: mockRepos }))
);

describe('getFile', () => {
  const octokit = new OctokitRest();
  const owner = 'owner';
  const repo = 'repo';

  const getContent = octokit.repos.getContent as jest.Mock;

  test('loads and decodes the file', async () => {
    expect.assertions(2);
    const testContent = 'test content.';

    getContent.mockReturnValue({
      data: { content: Buffer.from(testContent).toString('base64') },
    });

    const content = await getFile(
      octokit,
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
      e.code = 404;
      throw e;
    });

    const content = await getFile(
      octokit,
      owner,
      repo,
      '/path/to/missing',
      'v1.0.0'
    );
    expect(content).toBe(undefined);
  });

  test('rejects all other errors', async () => {
    expect.assertions(1);

    const errorText = 'internal server error';
    getContent.mockImplementation(() => {
      const e = new Error(errorText) as any;
      e.code = 500;
      throw e;
    });

    try {
      await getFile(octokit, owner, repo, '/path/to/missing', 'v1.0.0');
    } catch (e) {
      expect(e.message).toMatch(errorText);
    }
  });
});
