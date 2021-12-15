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

  interface TestCommit {
    author?: string;
    hash: string;
    title: string;
    body: string;
    pr?: {
      local?: string;
      remote?: {
        author: { login: string };
        number: string;
        body?: string;
        milestone?: string;
      };
    };
  }

  interface TestMilestone {
    title: string;
    description: string | null;
  }

  function setup(
    commits: TestCommit[],
    milestones: Record<string, TestMilestone> = {}
  ): void {
    mockGetChangesSince.mockResolvedValueOnce(
      commits.map(commit => ({
        hash: commit.hash,
        title: commit.title,
        body: commit.body,
        pr: commit.pr?.local || null,
      }))
    );

    mockClient.mockResolvedValueOnce({
      repository: Object.fromEntries(
        commits.map(({ hash, author, pr }: TestCommit) => [
          `C${hash}`,
          {
            author: { user: author },
            associatedPullRequests: {
              nodes: pr?.remote
                ? [
                    {
                      author: pr.remote.author,
                      number: pr.remote.number,
                      body: pr.remote.body || '',
                      milestone: pr.remote.milestone
                        ? { number: pr.remote.milestone }
                        : null,
                    },
                  ]
                : [],
            },
          },
        ])
      ),
    });

    mockClient.mockResolvedValueOnce({
      repository: Object.keys(milestones).reduce((obj, key) => {
        obj[`M${key}`] = milestones[key];
        return obj;
      }, {} as Record<string, TestMilestone>),
    });
  }

  it.each([
    ['empty changeset', [], {}, ''],
    [
      'short commit SHA for local commits w/o pull requests',
      [
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
        },
      ],
      {},
      '### Various fixes & improvements\n\n- Upgraded the kernel (abcdef12)',
    ],
    [
      'use pull request number when available locally',
      [
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel (#123)',
          body: '',
          pr: { local: '123' },
        },
      ],
      {},
      '### Various fixes & improvements\n\n- Upgraded the kernel (#123)',
    ],
    [
      'use pull request number when available remotely',
      [
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
          pr: { remote: { number: '123', author: { login: 'sentry' } } },
        },
      ],
      {},
      '### Various fixes & improvements\n\n- Upgraded the kernel (#123) by @sentry',
    ],
    [
      'handle multiple commits properly',
      [
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
        },
        {
          hash: 'bcdef1234567890a',
          title: 'Upgraded the manifold (#123)',
          body: '',
          pr: {
            local: '123',
            remote: { number: '123', author: { login: 'alice' } },
          },
        },
        {
          hash: 'cdef1234567890ab',
          title: 'Refactored the crankshaft',
          body: '',
          pr: { remote: { number: '456', author: { login: 'bob' } } },
        },
        {
          hash: 'cdef1234567890ad',
          title: 'Refactored the crankshaft again',
          body: '',
          pr: { remote: { number: '458', author: { login: 'bob' } } },
        },
      ],
      {},
      [
        '### Various fixes & improvements',
        '',
        '_Listing 3 out of 4_',
        '',
        '- Upgraded the kernel (abcdef12)',
        '- Upgraded the manifold (#123) by @alice',
        '- Refactored the crankshaft (#456) by @bob',
      ].join('\n'),
    ],
    [
      'group prs under milestones',
      [
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
        },
        {
          hash: 'bcdef1234567890a',
          title: 'Upgraded the manifold (#123)',
          body: '',
          pr: {
            local: '123',
            remote: {
              number: '123',
              author: { login: 'alice' },
              milestone: '1',
            },
          },
        },
        {
          hash: 'cdef1234567890ab',
          title: 'Refactored the crankshaft',
          body: '',
          pr: {
            remote: { number: '456', author: { login: 'bob' }, milestone: '1' },
          },
        },
        {
          hash: 'def1234567890abc',
          title: 'Upgrade the HUD (#789)',
          body: '',
          pr: {
            local: '789',
            remote: {
              number: '789',
              author: { login: 'charlie' },
              milestone: '5',
            },
          },
        },
        {
          hash: 'ef1234567890abcd',
          title: 'Upgrade the steering wheel (#900)',
          body: '',
          pr: {
            local: '900',
            remote: {
              number: '900',
              author: { login: 'charlie' },
              milestone: '5',
            },
          },
        },
        {
          hash: 'f1234567890abcde',
          title: 'Fix the clacking sound on gear changes (#950)',
          body: '',
          pr: {
            local: '950',
            remote: { number: '950', author: { login: 'bob' } },
          },
        },
      ],
      {
        '1': {
          title: 'Better drivetrain',
          description:
            'We have upgraded the drivetrain for a smoother and more performant driving experience. Enjoy!',
          state: 'CLOSED',
        },
        '5': {
          title: 'Better driver experience',
          description: '',
          state: 'OPEN',
        },
      },
      [
        '### Better drivetrain',
        '',
        'We have upgraded the drivetrain for a smoother and more performant driving experience. Enjoy!',
        '',
        'By: @alice (#123), @bob (#456)',
        '',
        '### Better driver experience (ongoing)',
        '',
        'By: @charlie (#789, #900)',
        '',
        '### Various fixes & improvements',
        '',
        '- Upgraded the kernel (abcdef12)',
        '- Fix the clacking sound on gear changes (#950) by @bob',
      ].join('\n'),
    ],
    [
      'should escape # signs on milestone titles',
      [
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
          pr: {
            local: '123',
            remote: {
              number: '123',
              author: { login: 'sentry' },
              milestone: '1',
            },
          },
        },
      ],
      {
        '1': {
          title: 'Drivetrain #1 in town',
          description:
            'We have upgraded the drivetrain for a smoother and more performant driving experience. Enjoy!',
          state: 'CLOSED',
        },
      },
      [
        '### Drivetrain &#35;1 in town',
        '',
        'We have upgraded the drivetrain for a smoother and more performant driving experience. Enjoy!',
        '',
        'By: @sentry (#123)',
      ].join('\n'),
    ],
    [
      'should omit milestone body if it is empty or null',
      [
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
          pr: {
            local: '123',
            remote: {
              number: '123',
              author: { login: 'sentry' },
              milestone: '1',
            },
          },
        },

        {
          hash: 'bcdef123456789a',
          title: 'Upgraded the manifold (#456)',
          body: '',
          pr: {
            local: '456',
            remote: {
              number: '456',
              author: { login: 'alice' },
              milestone: '2',
            },
          },
        },
      ],
      {
        '1': {
          title: 'Better drivetrain',
          description: '',
          state: 'CLOSED',
        },
        '2': {
          title: 'Better Engine',
          description: null,
          state: 'CLOSED',
        },
      },
      [
        '### Better drivetrain',
        '',
        'By: @sentry (#123)',
        '',
        '### Better Engine',
        '',
        'By: @alice (#456)',
      ].join('\n'),
    ],
    [
      `should skip commits & prs with the magic ${SKIP_CHANGELOG_MAGIC_WORD}`,
      [
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: SKIP_CHANGELOG_MAGIC_WORD,
        },
        {
          hash: 'bcdef1234567890a',
          title: 'Upgraded the manifold (#123)',
          body: '',
          pr: {
            local: '123',
            remote: {
              number: '123',
              author: { login: 'alice' },
              milestone: '1',
            },
          },
        },
        {
          hash: 'cdef1234567890ab',
          title: 'Refactored the crankshaft',
          body: '',
          pr: {
            remote: {
              number: '456',
              author: { login: 'bob' },
              body: `This is important but we'll ${SKIP_CHANGELOG_MAGIC_WORD} for internal.`,
              milestone: '1',
            },
          },
        },
        {
          hash: 'def1234567890abc',
          title: 'Upgrade the HUD (#789)',
          body: '',
          pr: {
            local: '789',
            remote: {
              number: '789',
              author: { login: 'charlie' },
              milestone: '5',
            },
          },
        },
        {
          hash: 'ef1234567890abcd',
          title: 'Upgrade the steering wheel (#900)',
          body: `Some very important update but ${SKIP_CHANGELOG_MAGIC_WORD}`,
          pr: { local: '900' },
        },
        {
          hash: 'f1234567890abcde',
          title: 'Fix the clacking sound on gear changes (#950)',
          body: '',
          pr: {
            local: '950',
            remote: { number: '950', author: { login: 'alice' } },
          },
        },
      ],
      {
        '1': {
          title: 'Better drivetrain',
          description:
            'We have upgraded the drivetrain for a smoother and more performant driving experience. Enjoy!',
          state: 'CLOSED',
        },
        '5': {
          title: 'Better driver experience',
          description:
            'We are working on making your driving experience more pleasant and safer.',
          state: 'OPEN',
        },
      },
      [
        '### Better drivetrain',
        '',
        'We have upgraded the drivetrain for a smoother and more performant driving experience. Enjoy!',
        '',
        'By: @alice (#123)',
        '',
        '### Better driver experience (ongoing)',
        '',
        'We are working on making your driving experience more pleasant and safer.',
        '',
        'By: @charlie (#789)',
        '',
        '### Various fixes & improvements',
        '',
        '- Fix the clacking sound on gear changes (#950) by @alice',
      ].join('\n'),
    ],
  ])(
    '%s',
    async (
      _name: string,
      commits: TestCommit[],
      milestones: Record<string, TestMilestone>,
      output: string
    ) => {
      setup(commits, milestones);
      const changes = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(changes).toBe(output);
    }
  );
});
