/* eslint-env jest */

import {
  findChangeset,
  removeChangeset /*, prependChangeset*/,
} from '../changes';

test.each([
  [
    'regular',
    (name: string, body: string) => `# Changelog\n## ${name}\n${body}\n`,
  ],
  [
    'ignore date in parentheses',
    (name: string, body: string) => `# Changelog
    ## 1.0.1
    newer

    ## ${name} (2019-02-02)
    ${body}

    ## 0.9.0
    older
    `,
  ],
  [
    'extracts a change between headings',
    (name: string, body: string) => `# Changelog
    ## 1.0.1
    newer

    ## ${name}
    ${body}

    ## 0.9.0
    older
    `,
  ],
  [
    'extracts changes from underlined headings',
    (name: string, body: string) => `Changelog\n====\n${name}\n----\n${body}\n`,
  ],
  [
    'extracts changes from alternating headings',
    (name: string, body: string) => `# Changelog
    ## 1.0.1
    newer

    ${name}
    -------
    ${body}

    ## 0.9.0
    older
    `,
  ],
])('findChangeset should extract %s', (_testName, markdown) => {
  const name = 'Version 1.0.0';
  const body = 'this is a test';
  expect(findChangeset(markdown(name, body), 'v1.0.0')).toEqual({ name, body });
});

test.each([
  ['changeset cannot be found', 'v1.0.0'],
  ['invalid version', 'not a version'],
])('findChangeset should return null on %s', (_testName, version) => {
  const markdown = `# Changelog
    ## 1.0.1
    newer

    ## 0.9.0
    older
    `;
  expect(findChangeset(markdown, version)).toEqual(null);
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
