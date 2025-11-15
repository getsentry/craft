/* eslint-env jest */

jest.mock('../githubApi.ts');
import { getGitHubClient } from '../githubApi';
jest.mock('../git');
import { getChangesSince } from '../git';
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(),
}));
jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  getConfigFileDir: jest.fn(),
  getGlobalGitHubConfig: jest.fn(),
}));
import * as config from '../../config';

import { readFileSync } from 'fs';
import type { SimpleGit } from 'simple-git';

import {
  findChangeset,
  removeChangeset,
  prependChangeset,
  generateChangesetFromGit,
  SKIP_CHANGELOG_MAGIC_WORD,
  BODY_IN_CHANGELOG_MAGIC_WORD,
} from '../changelog';

const getConfigFileDirMock = config.getConfigFileDir as jest.MockedFunction<typeof config.getConfigFileDir>;
const getGlobalGitHubConfigMock = config.getGlobalGitHubConfig as jest.MockedFunction<typeof config.getGlobalGitHubConfig>;
const readFileSyncMock = readFileSync as jest.MockedFunction<typeof readFileSync>;

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
    // Default: no config file
    getConfigFileDirMock.mockReturnValue(undefined);
    getGlobalGitHubConfigMock.mockResolvedValue({
      repo: 'test-repo',
      owner: 'test-owner',
    });
    readFileSyncMock.mockImplementation(() => {
      const error: any = new Error('ENOENT');
      error.code = 'ENOENT';
      throw error;
    });
  });

  interface TestCommit {
    author?: string;
    hash: string;
    title: string;
    body: string;
    pr?: {
      local?: string;
      remote?: {
        author?: { login: string };
        number: string;
        body?: string;
        labels?: string[];
      };
    };
  }

  function setup(
    commits: TestCommit[],
    releaseConfig?: string | null
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
                      labels: {
                        nodes: (pr.remote.labels || []).map(label => ({
                          name: label,
                        })),
                      },
                    },
                  ]
                : [],
            },
          },
        ])
      ),
    });

    // Mock release config file reading
    if (releaseConfig !== undefined) {
      if (releaseConfig === null) {
        getConfigFileDirMock.mockReturnValue(undefined);
        readFileSyncMock.mockImplementation(() => {
          const error: any = new Error('ENOENT');
          error.code = 'ENOENT';
          throw error;
        });
      } else {
        getConfigFileDirMock.mockReturnValue('/workspace');
        readFileSyncMock.mockImplementation((path: any) => {
          if (typeof path === 'string' && path.includes('.github/release.yml')) {
            return releaseConfig;
          }
          const error: any = new Error('ENOENT');
          error.code = 'ENOENT';
          throw error;
        });
      }
    }
  }

  it.each([
    ['empty changeset', [], null, ''],
    [
      'short commit SHA for local commits w/o pull requests',
      [
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
        },
      ],
      null,
      '### Other\n\n- Upgraded the kernel (abcdef12)',
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
      null,
      '### Other\n\n- Upgraded the kernel (#123)',
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
      null,
      '### Other\n\n- Upgraded the kernel (#123) by @sentry',
    ],
    [
      'Does not error when PR author is null',
      [
        {
          hash: 'abcdef1234567890',
          title: 'Upgraded the kernel',
          body: '',
          pr: { remote: { number: '123' } },
        },
      ],
      null,
      '### Other\n\n- Upgraded the kernel (#123)',
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
      null,
      [
        '### Other',
        '',
        '- Upgraded the kernel (abcdef12)',
        '- Upgraded the manifold (#123) by @alice',
        '- Refactored the crankshaft (#456) by @bob',
        '',
        '_Plus 1 more_',
      ].join('\n'),
    ],
    [
      'group prs under categories',
      [
        {
          hash: 'bcdef1234567890a',
          title: 'Upgraded the manifold (#123)',
          body: '',
          pr: {
            local: '123',
            remote: {
              number: '123',
              author: { login: 'alice' },
              labels: ['drivetrain'],
            },
          },
        },
        {
          hash: 'cdef1234567890ab',
          title: 'Refactored the crankshaft',
          body: '',
          pr: {
            remote: { number: '456', author: { login: 'bob' }, labels: ['drivetrain'] },
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
              labels: ['driver-experience'],
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
              labels: ['driver-experience'],
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
      `changelog:
  categories:
    - title: Better drivetrain
      labels:
        - drivetrain
    - title: Better driver experience
      labels:
        - driver-experience`,
      [
        '### Better drivetrain',
        '',
        'By: @alice (#123), @bob (#456)',
        '',
        '### Better driver experience',
        '',
        'By: @charlie (#789, #900)',
        '',
        '### Other',
        '',
        '- Fix the clacking sound on gear changes (#950) by @bob',
      ].join('\n'),
    ],
    [
      'should escape # signs on category titles',
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
              labels: ['drivetrain'],
            },
          },
        },
      ],
      `changelog:
  categories:
    - title: Drivetrain #1 in town
      labels:
        - drivetrain`,
      [
        '### Drivetrain &#35;1 in town',
        '',
        'By: @sentry (#123)',
      ].join('\n'),
    ],
    [
      'should escape leading underscores in changelog entries',
      [
        {
          hash: 'abcdef1234567890',
          title: 'Serialized _meta (#123)',
          body: '',
          pr: { local: '123' },
        },
      ],
      null,
      '### Other\n\n- Serialized \\_meta (#123)',
    ],
    [
      `should skip commits & prs with the magic ${SKIP_CHANGELOG_MAGIC_WORD}`,
      [
        {
          hash: 'bcdef1234567890a',
          title: 'Upgraded the manifold (#123)',
          body: '',
          pr: {
            local: '123',
            remote: {
              number: '123',
              author: { login: 'alice' },
              labels: ['drivetrain'],
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
              labels: ['drivetrain'],
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
              labels: ['driver-experience'],
            },
          },
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
      `changelog:
  categories:
    - title: Better drivetrain
      labels:
        - drivetrain
    - title: Better driver experience
      labels:
        - driver-experience`,
      [
        '### Better drivetrain',
        '',
        'By: @alice (#123)',
        '',
        '### Better driver experience',
        '',
        'By: @charlie (#789)',
        '',
        '### Other',
        '',
        '- Fix the clacking sound on gear changes (#950) by @alice',
      ].join('\n'),
    ],
    [
      `should expand commits & prs with the magic ${BODY_IN_CHANGELOG_MAGIC_WORD}`,
      [
        {
          hash: 'bcdef1234567890a',
          title: 'Upgraded the manifold (#123)',
          body: '',
          pr: {
            local: '123',
            remote: {
              number: '123',
              author: { login: 'alice' },
              labels: ['drivetrain'],
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
              body: `This is important and we'll include the __body__ for attention. ${BODY_IN_CHANGELOG_MAGIC_WORD}`,
              labels: ['drivetrain'],
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
              labels: ['driver-experience'],
            },
          },
        },
        {
          hash: 'ef1234567890abcd',
          title: 'Upgrade the steering wheel (#900)',
          body: `Some very important update ${BODY_IN_CHANGELOG_MAGIC_WORD}`,
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
      `changelog:
  categories:
    - title: Better drivetrain
      labels:
        - drivetrain
    - title: Better driver experience
      labels:
        - driver-experience`,
      [
        '### Better drivetrain',
        '',
        'By: @alice (#123), @bob (#456)',
        '',
        '### Better driver experience',
        '',
        'By: @charlie (#789)',
        '',
        '### Other',
        '',
        '- Upgrade the steering wheel (#900)',
        '  Some very important update ',
        '- Fix the clacking sound on gear changes (#950) by @alice',
      ].join('\n'),
    ],
  ])(
    '%s',
    async (
      _name: string,
      commits: TestCommit[],
      releaseConfig: string | null,
      output: string
    ) => {
      setup(commits, releaseConfig);
      const changes = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(changes).toBe(output);
    }
  );

  describe('category matching', () => {
    it('should match PRs to categories based on labels', async () => {
      const releaseConfigYaml = `changelog:
  categories:
    - title: Features
      labels:
        - feature
    - title: Bug Fixes
      labels:
        - bug`;
      
      setup(
        [
          {
            hash: 'abc123',
            title: 'Feature PR',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['feature'],
              },
            },
          },
          {
            hash: 'def456',
            title: 'Bug fix PR',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: ['bug'],
              },
            },
          },
        ],
        releaseConfigYaml
      );

      // Verify mocks are set up before calling generateChangesetFromGit
      expect(getConfigFileDirMock).toBeDefined();
      expect(readFileSyncMock).toBeDefined();
      
      const changes = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      
      // Verify getConfigFileDir was called
      expect(getConfigFileDirMock).toHaveBeenCalled();
      // Verify readFileSync was called to read the config
      expect(readFileSyncMock).toHaveBeenCalled();
      
      expect(changes).toContain('### Features');
      expect(changes).toContain('### Bug Fixes');
      expect(changes).toContain('@alice (#1)');
      expect(changes).toContain('@bob (#2)');
    });

    it('should apply global exclusions', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'Internal PR (#1)',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['internal'],
              },
            },
          },
          {
            hash: 'def456',
            title: 'Public PR (#2)',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: ['feature'],
              },
            },
          },
        ],
        `changelog:
  exclude:
    labels:
      - internal
  categories:
    - title: Features
      labels:
        - feature`
      );

      const changes = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(changes).not.toContain('#1');
      expect(changes).toContain('#2');
    });

    it('should apply category-level exclusions', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'Feature PR (#1)',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['feature', 'skip-release'],
              },
            },
          },
          {
            hash: 'def456',
            title: 'Another Feature PR (#2)',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: ['feature'],
              },
            },
          },
        ],
        `changelog:
  categories:
    - title: Features
      labels:
        - feature
      exclude:
        labels:
          - skip-release`
      );

      const changes = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(changes).not.toContain('#1');
      expect(changes).toContain('#2');
    });

    it('should support wildcard category matching', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'Any PR (#1)',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['random-label'],
              },
            },
          },
        ],
        `changelog:
  categories:
    - title: All Changes
      labels:
        - '*'`
      );

      const changes = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(changes).toContain('### All Changes');
      expect(changes).toContain('@alice (#1)');
    });

    it('should fallback to Other when no config exists', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'Some PR (#1)',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['feature'],
              },
            },
          },
        ],
        null
      );

      const changes = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      expect(changes).toContain('### Other');
      expect(changes).toContain('#1');
    });
  });
});
