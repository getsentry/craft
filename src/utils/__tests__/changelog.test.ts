/* eslint-env jest */

jest.mock('../githubApi.ts');
import { getGitHubClient } from '../githubApi';
jest.mock('../git');
import { getChangesSince } from '../git';

import { SimpleGit } from 'simple-git';

import {
  findChangeset,
  removeChangeset,
  prependChangeset,
  generateChangesetFromGit,
  SKIP_CHANGELOG_MAGIC_WORD,
} from '../changelog';

describe('findChangeset', () => {
  const sampleChangeset = {
    body: '- this is a test',
    name: 'Version 1.0.0',
  };

  test.each([
    [
      'regular',
      `# Changelog\n## ${sampleChangeset.name}\n${sampleChangeset.body}\n`,
    ],
    [
      'ignore date in parentheses',
      `# Changelog
    ## 1.0.1
    newer

    ## ${sampleChangeset.name} (2019-02-02)
    ${sampleChangeset.body}

    ## 0.9.0
    older
    `,
    ],
    [
      'extracts a change between headings',
      `# Changelog
    ## 1.0.1
    newer

    ## ${sampleChangeset.name}
    ${sampleChangeset.body}

    ## 0.9.0
    older
    `,
    ],
    [
      'extracts changes from underlined headings',
      `Changelog\n====\n${sampleChangeset.name}\n----\n${sampleChangeset.body}\n`,
    ],
    [
      'extracts changes from alternating headings',
      `# Changelog
    ## 1.0.1
    newer

    ${sampleChangeset.name}
    -------
    ${sampleChangeset.body}

    ## 0.9.0
    older
    `,
    ],
  ])('should extract %s', (_testName, markdown) => {
    expect(findChangeset(markdown, 'v1.0.0')).toEqual(sampleChangeset);
  });

  test('supports sub-headings', () => {
    const changeset = {
      body: '### Features\nthis is a test',
      name: 'Version 1.0.0',
    };

    const markdown = `# Changelog
        ## ${changeset.name}
        ${changeset.body}
      `;

    expect(findChangeset(markdown, 'v1.0.0')).toEqual(changeset);
  });

  test.each([
    ['changeset cannot be found', 'v1.0.0'],
    ['invalid version', 'not a version'],
  ])('should return null on %s', (_testName, version) => {
    const markdown = `# Changelog
    ## 1.0.1
    newer

    ## 0.9.0
    older
    `;
    expect(findChangeset(markdown, version)).toEqual(null);
  });
});

test.each([
  [
    'remove from the top',
    '1.0.1',
    `# Changelog
    1.0.0
    -------
    this is a test

    ## 0.9.1
    slightly older

    ## 0.9.0
    older
    `,
  ],
  [
    'remove from the middle',
    '0.9.1',
    `# Changelog
    ## 1.0.1
    newer

    1.0.0
    -------
    this is a test

    ## 0.9.0
    older
    `,
  ],
  [
    'remove from underlined',
    '1.0.0',
    `# Changelog
    ## 1.0.1
    newer

    ## 0.9.1
    slightly older

    ## 0.9.0
    older
    `,
  ],
  [
    'remove from the bottom',
    '0.9.0',
    `# Changelog
    ## 1.0.1
    newer

    1.0.0
    -------
    this is a test

    ## 0.9.1
    slightly older

`,
  ],
  [
    'not remove missing',
    'non-existent version',
    `# Changelog
    ## 1.0.1
    newer

    1.0.0
    -------
    this is a test

    ## 0.9.1
    slightly older

    ## 0.9.0
    older
    `,
  ],
  [
    'not remove empty',
    '',
    `# Changelog
    ## 1.0.1
    newer

    1.0.0
    -------
    this is a test

    ## 0.9.1
    slightly older

    ## 0.9.0
    older
    `,
  ],
])('remove changeset should %s', (_testName, header, expected) => {
  const markdown = `# Changelog
    ## 1.0.1
    newer

    1.0.0
    -------
    this is a test

    ## 0.9.1
    slightly older

    ## 0.9.0
    older
    `;

  expect(removeChangeset(markdown, header)).toEqual(expected);
});

test.each([
  [
    'prepend to empty text',
    '',
    '## 2.0.0\n\n- rewrote everything from scratch\n- with multiple lines\n\n',
  ],
  [
    'prepend without top-level header',
    '## 1.0.0\n\nthis is a test\n',
    '## 2.0.0\n\n- rewrote everything from scratch\n- with multiple lines\n\n## 1.0.0\n\nthis is a test\n',
  ],
  [
    'prepend after top-level header (empty body)',
    '# Changelog\n',
    '# Changelog\n## 2.0.0\n\n- rewrote everything from scratch\n- with multiple lines\n\n',
  ],
  [
    'prepend after top-level header',
    '# Changelog\n\n## 1.0.0\n\nthis is a test\n',
    '# Changelog\n\n## 2.0.0\n\n- rewrote everything from scratch\n- with multiple lines\n\n## 1.0.0\n\nthis is a test\n',
  ],
  [
    'prepend with underlined when detected',
    '# Changelog\n\n1.0.0\n-----\n\nthis is a test\n',
    '# Changelog\n\n2.0.0\n-----\n\n- rewrote everything from scratch\n- with multiple lines\n\n1.0.0\n-----\n\nthis is a test\n',
  ],
  [
    'prepend with consistent padding with the rest',
    '# Changelog\n\n   ## 1.0.0\n\n   this is a test\n',
    '# Changelog\n\n   ## 2.0.0\n\n   - rewrote everything from scratch\n   - with multiple lines\n\n   ## 1.0.0\n\n   this is a test\n',
  ],
  [
    'prepend with consistent padding with the rest (underlined)',
    '# Changelog\n\n   1.0.0\n-----\n\n   this is a test\n',
    '# Changelog\n\n   2.0.0\n-----\n\n   - rewrote everything from scratch\n   - with multiple lines\n\n   1.0.0\n-----\n\n   this is a test\n',
  ],
])('prependChangeset should %s', (_testName, markdown, expected) => {
  expect(
    prependChangeset(markdown, {
      body: '- rewrote everything from scratch\n- with multiple lines',
      name: '2.0.0',
    })
  ).toEqual(expected);
});

describe('generateChangesetFromGit', () => {
  let mockClient: jest.Mock;
  const makeCommitResponse = (commits: Record<string, string>[]) =>
    mockClient.mockResolvedValueOnce({
      repository: Object.fromEntries(
        commits.map(
          ({ hash, pr, prBody, milestone }: Record<string, string>) => [
            `C${hash}`,
            {
              associatedPullRequests: {
                nodes: pr
                  ? [
                      {
                        number: pr,
                        body: prBody || '',
                        milestone: milestone ? { number: milestone } : null,
                      },
                    ]
                  : [],
              },
            },
          ]
        )
      ),
    });

  const mockGetChangesSince = getChangesSince as jest.MockedFunction<
    typeof getChangesSince
  >;
  const dummyGit = {} as SimpleGit;

  beforeEach(() => {
    jest.resetAllMocks();
    mockClient = jest.fn();
    (getGitHubClient as jest.MockedFunction<
      typeof getGitHubClient
      // @ts-ignore we only need to mock a subset
    >).mockReturnValue({ graphql: mockClient });
  });

  it('should not fail on empty changeset', async () => {
    mockGetChangesSince.mockResolvedValueOnce([]);
    const changes = await generateChangesetFromGit(dummyGit, '1.0.0');
    expect(changes).toBe('');
  });

  describe('standalone changes', () => {
    it('should use short commit SHA for local commits', async () => {
      mockGetChangesSince.mockResolvedValueOnce([
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
          pr: null,
        },
      ]);
      makeCommitResponse([]);
      const changes = await generateChangesetFromGit(dummyGit, '1.0.0');
      expect(changes).toMatchInlineSnapshot(`
        "### Various fixes & improvements

        - Upgraded the kernel (abcdef12)"
      `);
    });
    it('should use short commit SHA for local commits w/o pull requests', async () => {
      mockGetChangesSince.mockResolvedValueOnce([
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
          pr: null,
        },
      ]);
      // We do not have a PR number from the commit nor we get a PR number from
      // the GitHub API call, only a hash.
      makeCommitResponse([{ hash: 'abcdef1234567890' }]);
      const changes = await generateChangesetFromGit(dummyGit, '1.0.0');
      expect(changes).toMatchInlineSnapshot(`
        "### Various fixes & improvements

        - Upgraded the kernel (abcdef12)"
      `);
    });

    it('should use pull request number when available locally', async () => {
      mockGetChangesSince.mockResolvedValueOnce([
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel (#123)',
          body: '',
          pr: '123',
        },
      ]);
      makeCommitResponse([
        {
          hash: 'abcdef1234567890',
        },
      ]);
      const changes = await generateChangesetFromGit(dummyGit, '1.0.0');
      expect(changes).toMatchInlineSnapshot(`
        "### Various fixes & improvements

        - Upgraded the kernel (#123)"
      `);
    });

    it('should use pull request number when available remotely', async () => {
      mockGetChangesSince.mockResolvedValueOnce([
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
          pr: null,
        },
      ]);
      makeCommitResponse([{ hash: 'abcdef1234567890', pr: '123' }]);
      const changes = await generateChangesetFromGit(dummyGit, '1.0.0');
      expect(changes).toMatchInlineSnapshot(`
        "### Various fixes & improvements

        - Upgraded the kernel (#123)"
      `);
    });

    it('should handle multiple commits properly', async () => {
      mockGetChangesSince.mockResolvedValueOnce([
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
          pr: null,
        },
        {
          hash: 'bcdef1234567890a',
          title: 'Upgraded the manifold (#123)',
          body: '',
          pr: '123',
        },
        {
          hash: 'cdef1234567890ab',
          title: 'Refactored the crankshaft',
          body: '',
          pr: null,
        },
      ]);
      makeCommitResponse([
        {
          hash: 'bcdef1234567890a',
          pr: '123',
        },
        {
          hash: 'cdef1234567890ab',
          pr: '456',
        },
      ]);
      const changes = await generateChangesetFromGit(dummyGit, '1.0.0');
      expect(changes).toMatchInlineSnapshot(`
        "### Various fixes & improvements

        - Upgraded the kernel (abcdef12)
        - Upgraded the manifold (#123)
        - Refactored the crankshaft (#456)"
      `);
    });
  });
  it('should group prs under milestones', async () => {
    mockGetChangesSince.mockResolvedValueOnce([
      {
        hash: 'abcdef1234567890',
        title: 'Upgraded the kernel',
        body: '',
        pr: null,
      },
      {
        hash: 'bcdef1234567890a',
        title: 'Upgraded the manifold (#123)',
        body: '',
        pr: '123',
      },
      {
        hash: 'cdef1234567890ab',
        title: 'Refactored the crankshaft',
        body: '',
        pr: null,
      },
      {
        hash: 'def1234567890abc',
        title: 'Upgrade the HUD (#789)',
        body: '',
        pr: '789',
      },
      {
        hash: 'ef1234567890abcd',
        title: 'Upgrade the steering wheel (#900)',
        body: '',
        pr: '900',
      },
      {
        hash: 'f1234567890abcde',
        title: 'Fix the clacking sound on gear changes (#950)',
        body: '',
        pr: '950',
      },
    ]);
    makeCommitResponse([
      {
        hash: 'bcdef1234567890a',
        pr: '123',
        milestone: '1',
      },
      {
        hash: 'cdef1234567890ab',
        pr: '456',
        milestone: '1',
      },
      {
        hash: 'def1234567890abc',
        pr: '789',
        milestone: '5',
      },
      {
        hash: 'ef1234567890abcd',
        pr: '900',
        milestone: '5',
      },
      {
        hash: 'f1234567890abcde',
        pr: '950',
      },
    ]);
    mockClient.mockResolvedValueOnce({
      repository: {
        M1: {
          title: 'Better drivetrain',
          description:
            'We have upgraded the drivetrain for a smoother and more performant driving experience. Enjoy!',
          state: 'CLOSED',
        },
        M5: {
          title: 'Better driver experience',
          description: '',
          state: 'OPEN',
        },
      },
    });
    const changes = await generateChangesetFromGit(dummyGit, '1.0.0');
    expect(changes).toMatchInlineSnapshot(`
      "### Better drivetrain

      We have upgraded the drivetrain for a smoother and more performant driving experience. Enjoy!

      PRs: #123, #456

      ### Better driver experience (ongoing)

      PRs: #789, #900

      ### Various fixes & improvements

      - Upgraded the kernel (abcdef12)
      - Fix the clacking sound on gear changes (#950)"
    `);
  });

  it('should escape # signs on milestone titles', async () => {
    mockGetChangesSince.mockResolvedValueOnce([
      {
        hash: 'abcdef1234567890',
        title: 'Upgraded the kernel',
        body: '',
        pr: '123',
      },
    ]);
    makeCommitResponse([
      {
        hash: 'abcdef1234567890',
        pr: '123',
        milestone: '1',
      },
    ]);
    mockClient.mockResolvedValueOnce({
      repository: {
        M1: {
          title: 'Drivetrain #1 in town',
          description:
            'We have upgraded the drivetrain for a smoother and more performant driving experience. Enjoy!',
          state: 'CLOSED',
        },
      },
    });
    const changes = await generateChangesetFromGit(dummyGit, '1.0.0');
    expect(changes).toMatchInlineSnapshot(`
      "### Drivetrain &#35;1 in town

      We have upgraded the drivetrain for a smoother and more performant driving experience. Enjoy!

      PRs: #123"
    `);
  });
  it('should omit milestone body if it is empty', async () => {
    mockGetChangesSince.mockResolvedValueOnce([
      {
        hash: 'abcdef1234567890',
        title: 'Upgraded the kernel',
        body: '',
        pr: '123',
      },
    ]);
    makeCommitResponse([
      {
        hash: 'abcdef1234567890',
        pr: '123',
        milestone: '1',
      },
    ]);
    mockClient.mockResolvedValueOnce({
      repository: {
        M1: {
          title: 'Better drivetrain',
          state: 'CLOSED',
        },
      },
    });
    const changes = await generateChangesetFromGit(dummyGit, '1.0.0');
    expect(changes).toMatchInlineSnapshot(`
      "### Better drivetrain

      PRs: #123"
    `);
  });

  it(`should skip commits & prs with the magic ${SKIP_CHANGELOG_MAGIC_WORD}`, async () => {
    mockGetChangesSince.mockResolvedValueOnce([
      {
        hash: 'abcdef1234567890',
        title: 'Upgraded the kernel',
        body: SKIP_CHANGELOG_MAGIC_WORD,
        pr: null,
      },
      {
        hash: 'bcdef1234567890a',
        title: 'Upgraded the manifold (#123)',
        body: '',
        pr: '123',
      },
      {
        hash: 'cdef1234567890ab',
        title: 'Refactored the crankshaft',
        body: '',
        pr: null,
      },
      {
        hash: 'def1234567890abc',
        title: 'Upgrade the HUD (#789)',
        body: '',
        pr: '789',
      },
      {
        hash: 'ef1234567890abcd',
        title: 'Upgrade the steering wheel (#900)',
        body: `Some very important update but ${SKIP_CHANGELOG_MAGIC_WORD}`,
        pr: '900',
      },
      {
        hash: 'f1234567890abcde',
        title: 'Fix the clacking sound on gear changes (#950)',
        body: '',
        pr: '950',
      },
    ]);
    makeCommitResponse([
      {
        hash: 'bcdef1234567890a',
        pr: '123',
        milestone: '1',
      },
      {
        hash: 'cdef1234567890ab',
        pr: '456',
        prBody: `This is important but we'll ${SKIP_CHANGELOG_MAGIC_WORD} for internal.`,
        milestone: '1',
      },
      {
        hash: 'def1234567890abc',
        pr: '789',
        milestone: '5',
      },
      {
        hash: 'f1234567890abcde',
        pr: '950',
      },
    ]);
    mockClient.mockResolvedValueOnce({
      repository: {
        M1: {
          title: 'Better drivetrain',
          description:
            'We have upgraded the drivetrain for a smoother and more performant driving experience. Enjoy!',
          state: 'CLOSED',
        },
        M5: {
          title: 'Better driver experience',
          description:
            'We are working on making your driving experience more pleasant and safer.',
          state: 'OPEN',
        },
      },
    });
    const changes = await generateChangesetFromGit(dummyGit, '1.0.0');
    expect(changes).toMatchInlineSnapshot(`
      "### Better drivetrain

      We have upgraded the drivetrain for a smoother and more performant driving experience. Enjoy!

      PRs: #123

      ### Better driver experience (ongoing)

      We are working on making your driving experience more pleasant and safer.

      PRs: #789

      ### Various fixes & improvements

      - Fix the clacking sound on gear changes (#950)"
    `);
  });
});
