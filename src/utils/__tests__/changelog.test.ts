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
  extractScope,
  formatScopeTitle,
  clearChangesetCache,
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
        title?: string;
        body?: string;
        labels?: string[];
      };
    };
  }

  function setup(
    commits: TestCommit[],
    releaseConfig?: string | null
  ): void {
    // Clear memoization cache to ensure fresh results
    clearChangesetCache();

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
        commits.map(({ hash, author, title, pr }: TestCommit) => [
          `C${hash}`,
          {
            author: { user: author },
            associatedPullRequests: {
              nodes: pr?.remote
                ? [
                    {
                      author: pr.remote.author,
                      number: pr.remote.number,
                      title: pr.remote.title ?? title,
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
      '- Upgraded the kernel in [abcdef12](https://github.com/test-owner/test-repo/commit/abcdef1234567890)',
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
      // Local PR: links to the PR (strips duplicate PR number from title)
      '- Upgraded the kernel in [#123](https://github.com/test-owner/test-repo/pull/123)',
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
      '- Upgraded the kernel by @sentry in [#123](https://github.com/test-owner/test-repo/pull/123)',
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
      '- Upgraded the kernel in [#123](https://github.com/test-owner/test-repo/pull/123)',
    ],
    [
      'use PR title from GitHub instead of commit message',
      [
        {
          hash: 'abcdef1234567890',
          title: 'fix: quick fix for issue', // commit message
          body: '',
          pr: {
            remote: {
              number: '123',
              title: 'feat: A much better PR title with more context', // actual PR title
              author: { login: 'sentry' },
            },
          },
        },
      ],
      null,
      // Default config matches "feat:" prefix, so it goes to "New Features" category
      '### New Features ✨\n\n- feat: A much better PR title with more context by @sentry in [#123](https://github.com/test-owner/test-repo/pull/123)',
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
        '- Upgraded the kernel in [abcdef12](https://github.com/test-owner/test-repo/commit/abcdef1234567890)',
        '- Upgraded the manifold by @alice in [#123](https://github.com/test-owner/test-repo/pull/123)',
        '- Refactored the crankshaft by @bob in [#456](https://github.com/test-owner/test-repo/pull/456)',
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
            remote: {
              number: '456',
              author: { login: 'bob' },
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
        '- Upgraded the manifold by @alice in [#123](https://github.com/test-owner/test-repo/pull/123)',
        '- Refactored the crankshaft by @bob in [#456](https://github.com/test-owner/test-repo/pull/456)',
        '',
        '### Better driver experience',
        '',
        '- Upgrade the HUD by @charlie in [#789](https://github.com/test-owner/test-repo/pull/789)',
        '- Upgrade the steering wheel by @charlie in [#900](https://github.com/test-owner/test-repo/pull/900)',
        '',
        '### Other',
        '',
        '- Fix the clacking sound on gear changes by @bob in [#950](https://github.com/test-owner/test-repo/pull/950)',
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
    - title: "Drivetrain #1 in town"
      labels:
        - drivetrain`,
      [
        '### Drivetrain &#35;1 in town',
        '',
        '- Upgraded the kernel by @sentry in [#123](https://github.com/test-owner/test-repo/pull/123)',
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
      // Local PR: links to the PR (strips duplicate PR number from title)
      '- Serialized \\_meta in [#123](https://github.com/test-owner/test-repo/pull/123)',
    ],
    // NOTE: #skip-changelog is now redundant as we can skip PRs with certain labels
    // via .github/release.yml configuration (changelog.exclude.labels)
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
        '- Upgraded the manifold by @alice in [#123](https://github.com/test-owner/test-repo/pull/123)',
        '',
        '### Better driver experience',
        '',
        '- Upgrade the HUD by @charlie in [#789](https://github.com/test-owner/test-repo/pull/789)',
        '',
        '### Other',
        '',
        '- Fix the clacking sound on gear changes by @alice in [#950](https://github.com/test-owner/test-repo/pull/950)',
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
        '- Upgraded the manifold by @alice in [#123](https://github.com/test-owner/test-repo/pull/123)',
        '- Refactored the crankshaft by @bob in [#456](https://github.com/test-owner/test-repo/pull/456)',
        "  This is important and we'll include the __body__ for attention.",
        '',
        '### Better driver experience',
        '',
        '- Upgrade the HUD by @charlie in [#789](https://github.com/test-owner/test-repo/pull/789)',
        '',
        '### Other',
        '',
        // Local PR: links to the PR (strips duplicate PR number from title)
        '- Upgrade the steering wheel in [#900](https://github.com/test-owner/test-repo/pull/900)',
        '  Some very important update',
        '- Fix the clacking sound on gear changes by @alice in [#950](https://github.com/test-owner/test-repo/pull/950)',
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
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;
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

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;

      // Verify getConfigFileDir was called
      expect(getConfigFileDirMock).toHaveBeenCalled();
      // Verify readFileSync was called to read the config
      expect(readFileSyncMock).toHaveBeenCalled();

      expect(changes).toContain('### Features');
      expect(changes).toContain('### Bug Fixes');
      expect(changes).toContain(
        'Feature PR by @alice in [#1](https://github.com/test-owner/test-repo/pull/1)'
      );
      expect(changes).toContain(
        'Bug fix PR by @bob in [#2](https://github.com/test-owner/test-repo/pull/2)'
      );
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

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;
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

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;
      // PR #1 is excluded from Features category but should appear in Other
      // (category-level exclusions only exclude from that specific category)
      expect(changes).toContain('#1');
      // PR #1 should NOT be in the Features section
      const featuresSection = changes.split('### Other')[0];
      expect(featuresSection).not.toContain('Feature PR by @alice');
      // But it should be in the Other section
      const otherSection = changes.split('### Other')[1];
      expect(otherSection).toContain('Feature PR by @alice in [#1]');
      expect(changes).toContain('#2');
      expect(changes).toContain('### Features');
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

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;
      expect(changes).toContain('### All Changes');
      expect(changes).toContain(
        'Any PR by @alice in [#1](https://github.com/test-owner/test-repo/pull/1)'
      );
    });

    it('should use default conventional commits config when no config exists', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat: Add new feature (#1)',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'fix: Bug fix (#2)',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
        ],
        null
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;
      // When no config exists, default conventional commits patterns are used
      expect(changes).toContain('### New Features');
      expect(changes).toContain('### Bug Fixes');
      expect(changes).toContain('#1');
      expect(changes).toContain('#2');
    });

    it('should categorize PRs without author in their designated category', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'Feature PR without author',
            body: '',
            pr: {
              remote: {
                number: '1',
                // No author - simulates deleted GitHub user
                labels: ['feature'],
              },
            },
          },
        ],
        `changelog:
  categories:
    - title: Features
      labels:
        - feature`
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;
      expect(changes).toContain('### Features');
      expect(changes).not.toContain('### Other');
      expect(changes).toContain(
        'Feature PR without author in [#1](https://github.com/test-owner/test-repo/pull/1)'
      );
    });

    it('should handle malformed release config gracefully (non-array categories)', async () => {
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
        `changelog:
  categories: "this is a string, not an array"`
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;
      // Should not crash, and PR should appear in output (no categories applied)
      expect(changes).toContain('#1');
    });
  });

  describe('commit_patterns matching', () => {
    it('should match PRs to categories based on commit_patterns', async () => {
      const releaseConfigYaml = `changelog:
  categories:
    - title: Features
      commit_patterns:
        - "^feat:"
    - title: Bug Fixes
      commit_patterns:
        - "^fix:"`;

      setup(
        [
          {
            hash: 'abc123',
            title: 'feat: add new feature',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'fix: resolve bug',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
        ],
        releaseConfigYaml
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;

      expect(changes).toContain('### Features');
      expect(changes).toContain('### Bug Fixes');
      expect(changes).toContain(
        'feat: add new feature by @alice in [#1](https://github.com/test-owner/test-repo/pull/1)'
      );
      expect(changes).toContain(
        'fix: resolve bug by @bob in [#2](https://github.com/test-owner/test-repo/pull/2)'
      );
    });

    it('should give labels precedence over commit_patterns', async () => {
      const releaseConfigYaml = `changelog:
  categories:
    - title: Labeled Features
      labels:
        - feature
    - title: Pattern Features
      commit_patterns:
        - "^feat:"`;

      setup(
        [
          {
            hash: 'abc123',
            title: 'feat: labeled feature',
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
            title: 'feat: unlabeled feature',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
        ],
        releaseConfigYaml
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;

      expect(changes).toContain('### Labeled Features');
      expect(changes).toContain('### Pattern Features');
      // PR with label should be in Labeled Features (labels take precedence)
      const labeledSection = changes.split('### Pattern Features')[0];
      expect(labeledSection).toContain('feat: labeled feature by @alice');
      // PR without label should be in Pattern Features
      const patternSection = changes.split('### Pattern Features')[1];
      expect(patternSection).toContain('feat: unlabeled feature by @bob');
    });

    it('should use default conventional commits config when no release.yml exists', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat: new feature',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'fix: bug fix',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'docs: update readme',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: [],
              },
            },
          },
          {
            hash: 'jkl012',
            title: 'chore: update deps',
            body: '',
            pr: {
              remote: {
                number: '4',
                author: { login: 'dave' },
                labels: [],
              },
            },
          },
          {
            hash: 'mno345',
            title: 'feat(scope)!: breaking change',
            body: '',
            pr: {
              remote: {
                number: '5',
                author: { login: 'eve' },
                labels: [],
              },
            },
          },
        ],
        null // No release.yml - should use default config
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      expect(changes).toContain('### New Features');
      expect(changes).toContain('### Bug Fixes');
      expect(changes).toContain('### Documentation');
      expect(changes).toContain('### Build / dependencies / internal');
      expect(changes).toContain('### Breaking Changes');
    });

    it('should handle invalid regex patterns gracefully', async () => {
      const releaseConfigYaml = `changelog:
  categories:
    - title: Features
      commit_patterns:
        - "^feat:"
        - "[invalid(regex"`;

      setup(
        [
          {
            hash: 'abc123',
            title: 'feat: new feature',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
        ],
        releaseConfigYaml
      );

      // Should not crash, and valid pattern should still work
      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;
      expect(changes).toContain('### Features');
      expect(changes).toContain('feat: new feature');
    });

    it('should support combined labels and commit_patterns in same category', async () => {
      const releaseConfigYaml = `changelog:
  categories:
    - title: Features
      labels:
        - enhancement
      commit_patterns:
        - "^feat:"`;

      setup(
        [
          {
            hash: 'abc123',
            title: 'add cool thing',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['enhancement'],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat: another cool thing',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
        ],
        releaseConfigYaml
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;

      expect(changes).toContain('### Features');
      expect(changes).not.toContain('### Other');
      // Both PRs should be in Features
      expect(changes).toContain('add cool thing by @alice');
      expect(changes).toContain('feat: another cool thing by @bob');
    });

    it('should apply category exclusions to pattern-matched PRs', async () => {
      const releaseConfigYaml = `changelog:
  categories:
    - title: Features
      commit_patterns:
        - "^feat:"
      exclude:
        labels:
          - skip-release`;

      setup(
        [
          {
            hash: 'abc123',
            title: 'feat: feature to skip',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['skip-release'],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat: normal feature',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
        ],
        releaseConfigYaml
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;

      expect(changes).toContain('### Features');
      // PR #1 should be excluded from Features (but appear in Other)
      expect(changes).toContain('### Other');
      const featuresSection = changes.split('### Other')[0];
      expect(featuresSection).not.toContain('feat: feature to skip');
      expect(featuresSection).toContain('feat: normal feature');
    });

    it('should match pattern case-insensitively', async () => {
      const releaseConfigYaml = `changelog:
  categories:
    - title: Features
      commit_patterns:
        - "^feat:"`;

      setup(
        [
          {
            hash: 'abc123',
            title: 'FEAT: uppercase feature',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'Feat: mixed case feature',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
        ],
        releaseConfigYaml
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;

      expect(changes).toContain('### Features');
      expect(changes).not.toContain('### Other');
      expect(changes).toContain('FEAT: uppercase feature');
      expect(changes).toContain('Feat: mixed case feature');
    });

    it('should match PR title from commit log pattern with scope', async () => {
      const releaseConfigYaml = `changelog:
  categories:
    - title: Features
      commit_patterns:
        - "^feat(\\\\(\\\\w+\\\\))?:"`;

      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(api): add endpoint',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat: no scope',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
        ],
        releaseConfigYaml
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;

      expect(changes).toContain('### Features');
      expect(changes).toContain('feat(api): add endpoint');
      expect(changes).toContain('feat: no scope');
    });

    it('should match conventional commit scopes with dashes', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'fix(my-component): resolve issue',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat(some-other-scope): add feature',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'docs(multi-part-scope): update docs',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: [],
              },
            },
          },
        ],
        null // Use default config
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      expect(changes).toContain('### Bug Fixes');
      expect(changes).toContain('### New Features');
      expect(changes).toContain('### Documentation');
      expect(changes).toContain('fix(my-component): resolve issue');
      expect(changes).toContain('feat(some-other-scope): add feature');
      expect(changes).toContain('docs(multi-part-scope): update docs');
      // Should NOT appear in Other section - all commits should be categorized
      expect(changes).not.toContain('### Other');
    });

    it('should match refactor and meta types in internal category', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'refactor: clean up code',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'meta: update project config',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'refactor(utils): restructure helpers',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: [],
              },
            },
          },
        ],
        null // Use default config
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      expect(changes).toContain('### Build / dependencies / internal');
      expect(changes).toContain('refactor: clean up code');
      expect(changes).toContain('meta: update project config');
      expect(changes).toContain('refactor(utils): restructure helpers');
      // Should NOT appear in Other section
      expect(changes).not.toContain('### Other');
    });

    it('should match breaking changes with scopes containing dashes', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(my-api)!: breaking api change',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'fix!: breaking fix',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
        ],
        null // Use default config
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      expect(changes).toContain('### Breaking Changes');
      expect(changes).toContain('feat(my-api)!: breaking api change');
      expect(changes).toContain('fix!: breaking fix');
    });

    it('should trim leading and trailing whitespace from PR titles before pattern matching', async () => {
      const releaseConfigYaml = `changelog:
  categories:
    - title: Features
      commit_patterns:
        - "^feat:"
    - title: Bug Fixes
      commit_patterns:
        - "^fix:"`;

      setup(
        [
          {
            hash: 'abc123',
            title: ' feat: feature with leading space',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
                title: ' feat: feature with leading space', // PR title from GitHub has leading space
              },
            },
          },
          {
            hash: 'def456',
            title: 'fix: bug fix with trailing space ',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
                title: 'fix: bug fix with trailing space ', // PR title from GitHub has trailing space
              },
            },
          },
        ],
        releaseConfigYaml
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 3);
      const changes = result.changelog;

      // Both should be properly categorized despite whitespace
      expect(changes).toContain('### Features');
      expect(changes).toContain('### Bug Fixes');
      // Titles should be trimmed in output (no leading/trailing spaces)
      expect(changes).toContain(
        'feat: feature with leading space by @alice in [#1](https://github.com/test-owner/test-repo/pull/1)'
      );
      expect(changes).toContain(
        'fix: bug fix with trailing space by @bob in [#2](https://github.com/test-owner/test-repo/pull/2)'
      );
      // Should NOT go to Other section
      expect(changes).not.toContain('### Other');
    });
  });

  describe('section ordering', () => {
    it('should sort sections by config order regardless of PR encounter order', async () => {
      // Config defines order: Features, Bug Fixes, Documentation
      // But PRs are encountered in order: Bug Fix, Documentation, Feature
      const releaseConfigYaml = `changelog:
  categories:
    - title: Features
      labels:
        - feature
    - title: Bug Fixes
      labels:
        - bug
    - title: Documentation
      labels:
        - docs`;

      setup(
        [
          // First PR encountered is a bug fix
          {
            hash: 'abc123',
            title: 'Fix critical bug',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['bug'],
              },
            },
          },
          // Second PR is documentation
          {
            hash: 'def456',
            title: 'Update README',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: ['docs'],
              },
            },
          },
          // Third PR is a feature
          {
            hash: 'ghi789',
            title: 'Add new feature',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: ['feature'],
              },
            },
          },
        ],
        releaseConfigYaml
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      // Sections should appear in config order, not encounter order
      const featuresIndex = changes.indexOf('### Features');
      const bugFixesIndex = changes.indexOf('### Bug Fixes');
      const docsIndex = changes.indexOf('### Documentation');

      expect(featuresIndex).toBeGreaterThan(-1);
      expect(bugFixesIndex).toBeGreaterThan(-1);
      expect(docsIndex).toBeGreaterThan(-1);

      // Features should come before Bug Fixes, which should come before Documentation
      expect(featuresIndex).toBeLessThan(bugFixesIndex);
      expect(bugFixesIndex).toBeLessThan(docsIndex);
    });

    it('should maintain stable ordering with multiple PRs per category', async () => {
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
          // Mix of bug fixes and features, bug fixes encountered first
          {
            hash: 'abc123',
            title: 'First bug fix',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['bug'],
              },
            },
          },
          {
            hash: 'def456',
            title: 'First feature',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: ['feature'],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'Second bug fix',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: ['bug'],
              },
            },
          },
          {
            hash: 'jkl012',
            title: 'Second feature',
            body: '',
            pr: {
              remote: {
                number: '4',
                author: { login: 'dave' },
                labels: ['feature'],
              },
            },
          },
        ],
        releaseConfigYaml
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      // Features should still come before Bug Fixes per config order
      const featuresIndex = changes.indexOf('### Features');
      const bugFixesIndex = changes.indexOf('### Bug Fixes');

      expect(featuresIndex).toBeGreaterThan(-1);
      expect(bugFixesIndex).toBeGreaterThan(-1);
      expect(featuresIndex).toBeLessThan(bugFixesIndex);

      // Both features should be in Features section
      expect(changes).toContain('First feature');
      expect(changes).toContain('Second feature');
      // Both bug fixes should be in Bug Fixes section
      expect(changes).toContain('First bug fix');
      expect(changes).toContain('Second bug fix');
    });

    it('should maintain default conventional commits order', async () => {
      // No config - uses default conventional commits categories
      // Order should be: Breaking Changes, Build/deps, Bug Fixes, Documentation, New Features
      setup(
        [
          // Encounter order: feat, fix, breaking, docs, chore
          {
            hash: 'abc123',
            title: 'feat: new feature',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'fix: bug fix',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'feat!: breaking change',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: [],
              },
            },
          },
          {
            hash: 'jkl012',
            title: 'docs: update docs',
            body: '',
            pr: {
              remote: {
                number: '4',
                author: { login: 'dave' },
                labels: [],
              },
            },
          },
          {
            hash: 'mno345',
            title: 'chore: update deps',
            body: '',
            pr: {
              remote: {
                number: '5',
                author: { login: 'eve' },
                labels: [],
              },
            },
          },
        ],
        null // No config - use defaults
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      // Default order from DEFAULT_RELEASE_CONFIG:
      // Breaking Changes, Build/deps, Bug Fixes, Documentation, New Features
      const breakingIndex = changes.indexOf('### Breaking Changes');
      const buildIndex = changes.indexOf('### Build / dependencies / internal');
      const bugFixesIndex = changes.indexOf('### Bug Fixes');
      const docsIndex = changes.indexOf('### Documentation');
      const featuresIndex = changes.indexOf('### New Features');

      expect(breakingIndex).toBeGreaterThan(-1);
      expect(buildIndex).toBeGreaterThan(-1);
      expect(bugFixesIndex).toBeGreaterThan(-1);
      expect(docsIndex).toBeGreaterThan(-1);
      expect(featuresIndex).toBeGreaterThan(-1);

      // Verify order matches default config order
      expect(breakingIndex).toBeLessThan(buildIndex);
      expect(featuresIndex).toBeLessThan(bugFixesIndex);
      expect(bugFixesIndex).toBeLessThan(docsIndex);
      expect(docsIndex).toBeLessThan(buildIndex);
    });
  });

  describe('scope grouping', () => {
    /**
     * Helper to extract content between two headers (or to end of string).
     * Returns the content after the start header and before the next header of same or higher level.
     */
    function getSectionContent(
      markdown: string,
      headerPattern: RegExp
    ): string | null {
      const match = markdown.match(headerPattern);
      if (!match) return null;

      const startIndex = match.index! + match[0].length;
      // Find the next header (### or ####)
      const restOfContent = markdown.slice(startIndex);
      const nextHeaderMatch = restOfContent.match(/^#{3,4} /m);
      const endIndex = nextHeaderMatch
        ? startIndex + nextHeaderMatch.index!
        : markdown.length;

      return markdown.slice(startIndex, endIndex).trim();
    }

    it('should group PRs by scope within categories when scope has multiple entries', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(api): add endpoint',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat(ui): add button 1',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'feat(api): add another endpoint',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: [],
              },
            },
          },
          {
            hash: 'jkl012',
            title: 'feat(ui): add button 2',
            body: '',
            pr: {
              remote: {
                number: '4',
                author: { login: 'dave' },
                labels: [],
              },
            },
          },
        ],
        null // Use default config
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      // Verify Api scope header exists (has 2 entries)
      const apiSection = getSectionContent(changes, /#### Api\n/);
      expect(apiSection).not.toBeNull();
      expect(apiSection).toContain('feat(api): add endpoint');
      expect(apiSection).toContain('feat(api): add another endpoint');
      expect(apiSection).not.toContain('feat(ui):');

      // Ui scope has 2 entries, so header should be shown
      const uiSection = getSectionContent(changes, /#### Ui\n/);
      expect(uiSection).not.toBeNull();
      expect(uiSection).toContain('feat(ui): add button 1');
      expect(uiSection).toContain('feat(ui): add button 2');
      expect(uiSection).not.toContain('feat(api):');
    });

    it('should place scopeless entries at the bottom under "Other" header when scoped entries exist', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(api): add endpoint',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat(api): add another endpoint',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'feat: add feature without scope',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: [],
              },
            },
          },
        ],
        null
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      // Should have Api scope header (has 2 entries)
      expect(changes).toContain('#### Api');

      // Should have an "Other" header for scopeless entries (since Api has a header)
      expect(changes).toContain('#### Other');

      // Scopeless entry should appear after the "Other" header
      const otherHeaderIndex = changes.indexOf('#### Other');
      const scopelessIndex = changes.indexOf('feat: add feature without scope');
      expect(scopelessIndex).toBeGreaterThan(otherHeaderIndex);

      // Verify Api scope entry comes before scopeless entry
      const apiEntryIndex = changes.indexOf('feat(api): add endpoint');
      expect(apiEntryIndex).toBeLessThan(scopelessIndex);
    });

    it('should not add "Other" header when no scoped entries have headers', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(api): single api feature',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat: feature without scope',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
        ],
        null
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      // Neither scope should have a header (both have only 1 entry)
      expect(changes).not.toContain('#### Api');
      // No "Other" header should be added since there are no other scope headers
      expect(changes).not.toContain('#### Other');

      // But both PRs should still appear in the output
      expect(changes).toContain('feat(api): single api feature');
      expect(changes).toContain('feat: feature without scope');
    });

    it('should not add extra newlines between entries without scope headers', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(docker): add docker feature',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat: add feature without scope 1',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'feat: add feature without scope 2',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: [],
              },
            },
          },
        ],
        null
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      // All three should appear without extra blank lines between them
      // (no scope headers since docker only has 1 entry and scopeless don't trigger headers)
      expect(changes).not.toContain('#### Docker');
      expect(changes).not.toContain('#### Other');

      // Verify no double newlines between entries (which would indicate separate sections)
      const featuresSection = getSectionContent(changes, /### New Features[^\n]*\n/);
      expect(featuresSection).not.toBeNull();
      // There should be no blank lines between the three entries
      expect(featuresSection).not.toMatch(/\n\n-/);
      // All entries should be present
      expect(featuresSection).toContain('feat(docker): add docker feature');
      expect(featuresSection).toContain('feat: add feature without scope 1');
      expect(featuresSection).toContain('feat: add feature without scope 2');
    });

    it('should skip scope header for scopes with only one entry', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(api): add endpoint',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat(ui): single ui feature',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
        ],
        null
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      // Neither scope should have a header (both have only 1 entry)
      expect(changes).not.toContain('#### Api');
      expect(changes).not.toContain('#### Ui');

      // But both PRs should still appear in the output
      expect(changes).toContain('feat(api): add endpoint');
      expect(changes).toContain('feat(ui): single ui feature');
    });

    it('should merge scopes with different casing', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(API): uppercase scope',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat(api): lowercase scope',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'feat(Api): mixed case scope',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: [],
              },
            },
          },
        ],
        null
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      // Should only have one Api header (all merged)
      const apiMatches = changes.match(/#### Api/gi);
      expect(apiMatches).toHaveLength(1);

      // All three PRs should be under the same Api scope section
      const apiSection = getSectionContent(changes, /#### Api\n/);
      expect(apiSection).not.toBeNull();
      expect(apiSection).toContain('feat(API): uppercase scope');
      expect(apiSection).toContain('feat(api): lowercase scope');
      expect(apiSection).toContain('feat(Api): mixed case scope');
    });

    it('should sort scope groups alphabetically', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(zulu): z feature 1',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat(zulu): z feature 2',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'feat(alpha): a feature 1',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: [],
              },
            },
          },
          {
            hash: 'jkl012',
            title: 'feat(alpha): a feature 2',
            body: '',
            pr: {
              remote: {
                number: '4',
                author: { login: 'dave' },
                labels: [],
              },
            },
          },
          {
            hash: 'mno345',
            title: 'feat(beta): b feature 1',
            body: '',
            pr: {
              remote: {
                number: '5',
                author: { login: 'eve' },
                labels: [],
              },
            },
          },
          {
            hash: 'pqr678',
            title: 'feat(beta): b feature 2',
            body: '',
            pr: {
              remote: {
                number: '6',
                author: { login: 'frank' },
                labels: [],
              },
            },
          },
        ],
        null
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      const alphaIndex = changes.indexOf('#### Alpha');
      const betaIndex = changes.indexOf('#### Beta');
      const zuluIndex = changes.indexOf('#### Zulu');

      expect(alphaIndex).toBeLessThan(betaIndex);
      expect(betaIndex).toBeLessThan(zuluIndex);

      // Also verify each section contains the correct PR
      const alphaSection = getSectionContent(changes, /#### Alpha\n/);
      expect(alphaSection).toContain('feat(alpha): a feature 1');
      expect(alphaSection).toContain('feat(alpha): a feature 2');
      expect(alphaSection).not.toContain('feat(beta)');
      expect(alphaSection).not.toContain('feat(zulu)');
    });

    it('should format scope with dashes and underscores as title case', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(my-component): feature with dashes 1',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat(my-component): feature with dashes 2',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'feat(another_component): feature with underscores 1',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: [],
              },
            },
          },
          {
            hash: 'jkl012',
            title: 'feat(another_component): feature with underscores 2',
            body: '',
            pr: {
              remote: {
                number: '4',
                author: { login: 'dave' },
                labels: [],
              },
            },
          },
        ],
        null
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      // Verify scope headers are formatted correctly (each has 2 entries)
      expect(changes).toContain('#### Another Component');
      expect(changes).toContain('#### My Component');

      // Verify PRs are under correct scope sections
      const myComponentSection = getSectionContent(
        changes,
        /#### My Component\n/
      );
      expect(myComponentSection).toContain('feat(my-component): feature with dashes 1');
      expect(myComponentSection).toContain('feat(my-component): feature with dashes 2');
      expect(myComponentSection).not.toContain('feat(another_component)');

      const anotherComponentSection = getSectionContent(
        changes,
        /#### Another Component\n/
      );
      expect(anotherComponentSection).toContain(
        'feat(another_component): feature with underscores 1'
      );
      expect(anotherComponentSection).toContain(
        'feat(another_component): feature with underscores 2'
      );
      expect(anotherComponentSection).not.toContain('feat(my-component)');
    });

    it('should apply scope grouping to label-categorized PRs', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(api): add endpoint',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: ['enhancement'],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat(api): add another endpoint',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: ['enhancement'],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'feat(ui): add button',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: ['enhancement'],
              },
            },
          },
          {
            hash: 'jkl012',
            title: 'feat(ui): add dialog',
            body: '',
            pr: {
              remote: {
                number: '4',
                author: { login: 'dave' },
                labels: ['enhancement'],
              },
            },
          },
        ],
        `changelog:
  categories:
    - title: Features
      labels:
        - enhancement`
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      expect(changes).toContain('### Features');

      // Verify PRs are grouped under correct scopes (each scope has 2 entries)
      const apiSection = getSectionContent(changes, /#### Api\n/);
      expect(apiSection).not.toBeNull();
      expect(apiSection).toContain('feat(api): add endpoint');
      expect(apiSection).toContain('feat(api): add another endpoint');
      expect(apiSection).not.toContain('feat(ui)');

      const uiSection = getSectionContent(changes, /#### Ui\n/);
      expect(uiSection).not.toBeNull();
      expect(uiSection).toContain('feat(ui): add button');
      expect(uiSection).toContain('feat(ui): add dialog');
      expect(uiSection).not.toContain('feat(api)');
    });

    it('should handle breaking changes with scopes', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(api)!: breaking api change',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat(api)!: another breaking api change',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
          {
            hash: 'ghi789',
            title: 'fix(core)!: breaking core fix',
            body: '',
            pr: {
              remote: {
                number: '3',
                author: { login: 'charlie' },
                labels: [],
              },
            },
          },
          {
            hash: 'jkl012',
            title: 'fix(core)!: another breaking core fix',
            body: '',
            pr: {
              remote: {
                number: '4',
                author: { login: 'dave' },
                labels: [],
              },
            },
          },
        ],
        null
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      expect(changes).toContain('### Breaking Changes');

      // Verify PRs are grouped under correct scopes (each scope has 2 entries)
      const apiSection = getSectionContent(changes, /#### Api\n/);
      expect(apiSection).not.toBeNull();
      expect(apiSection).toContain('feat(api)!: breaking api change');
      expect(apiSection).toContain('feat(api)!: another breaking api change');
      expect(apiSection).not.toContain('fix(core)');

      const coreSection = getSectionContent(changes, /#### Core\n/);
      expect(coreSection).not.toBeNull();
      expect(coreSection).toContain('fix(core)!: breaking core fix');
      expect(coreSection).toContain('fix(core)!: another breaking core fix');
      expect(coreSection).not.toContain('feat(api)');
    });

    it('should merge scopes with dashes and underscores as equivalent', async () => {
      setup(
        [
          {
            hash: 'abc123',
            title: 'feat(my-component): feature with dashes',
            body: '',
            pr: {
              remote: {
                number: '1',
                author: { login: 'alice' },
                labels: [],
              },
            },
          },
          {
            hash: 'def456',
            title: 'feat(my_component): feature with underscores',
            body: '',
            pr: {
              remote: {
                number: '2',
                author: { login: 'bob' },
                labels: [],
              },
            },
          },
        ],
        null
      );

      const result = await generateChangesetFromGit(dummyGit, '1.0.0', 10);
      const changes = result.changelog;

      // Should only have one "My Component" header (merged via normalization)
      const myComponentMatches = changes.match(/#### My Component/gi);
      expect(myComponentMatches).toHaveLength(1);

      // Both PRs should appear under the same scope section
      const myComponentSection = getSectionContent(changes, /#### My Component\n/);
      expect(myComponentSection).not.toBeNull();
      expect(myComponentSection).toContain('feat(my-component): feature with dashes');
      expect(myComponentSection).toContain('feat(my_component): feature with underscores');
    });
  });
});

describe('extractScope', () => {
  it.each([
    ['feat(api): add endpoint', 'api'],
    ['fix(ui): fix button', 'ui'],
    ['feat(my-component): add feature', 'my-component'],
    ['feat(my_component): add feature', 'my-component'], // underscores normalized to dashes
    ['feat(API): uppercase scope', 'api'],
    ['feat(MyComponent): mixed case', 'mycomponent'],
    ['feat(scope)!: breaking change', 'scope'],
    ['fix(core)!: another breaking', 'core'],
    ['docs(readme): update docs', 'readme'],
    ['chore(deps): update dependencies', 'deps'],
    ['feat(my-long_scope): mixed separators', 'my-long-scope'], // underscores normalized to dashes
  ])('should extract scope from "%s" as "%s"', (title, expected) => {
    expect(extractScope(title)).toBe(expected);
  });

  it.each([
    ['feat: no scope', null],
    ['fix: simple fix', null],
    ['random commit message', null],
    ['feat!: breaking without scope', null],
    ['(scope): missing type', null],
    ['feat(): empty scope', null],
  ])('should return null for "%s"', (title, expected) => {
    expect(extractScope(title)).toBe(expected);
  });
});

describe('formatScopeTitle', () => {
  it.each([
    ['api', 'Api'],
    ['ui', 'Ui'],
    ['my-component', 'My Component'],
    ['my_component', 'My Component'],
    ['multi-word-scope', 'Multi Word Scope'],
    ['multi_word_scope', 'Multi Word Scope'],
    ['API', 'API'],
    ['mycomponent', 'Mycomponent'],
  ])('should format "%s" as "%s"', (scope, expected) => {
    expect(formatScopeTitle(scope)).toBe(expected);
  });
});
