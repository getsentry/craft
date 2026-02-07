/**
 * Tests for changelog file operations: findChangeset, removeChangeset, prependChangeset.
 * These functions work with CHANGELOG.md file content.
 */

import { findChangeset, removeChangeset, prependChangeset } from '../changelog';
import {
  SAMPLE_CHANGESET,
  SAMPLE_CHANGESET_WITH_SUBHEADING,
  createFullChangelog,
} from './fixtures/changelog';

describe('findChangeset', () => {
  test.each([
    [
      'regular ATX heading',
      `# Changelog\n## ${SAMPLE_CHANGESET.name}\n${SAMPLE_CHANGESET.body}\n`,
    ],
    [
      'with date in parentheses',
      createFullChangelog('Changelog', [
        { version: '1.0.1', body: 'newer' },
        {
          version: `${SAMPLE_CHANGESET.name} (2019-02-02)`,
          body: SAMPLE_CHANGESET.body,
        },
        { version: '0.9.0', body: 'older' },
      ]),
    ],
    [
      'between other headings',
      createFullChangelog('Changelog', [
        { version: '1.0.1', body: 'newer' },
        { version: SAMPLE_CHANGESET.name, body: SAMPLE_CHANGESET.body },
        { version: '0.9.0', body: 'older' },
      ]),
    ],
    [
      'setext-style headings',
      `Changelog\n====\n${SAMPLE_CHANGESET.name}\n----\n${SAMPLE_CHANGESET.body}\n`,
    ],
  ])('extracts %s', (_testName, markdown) => {
    expect(findChangeset(markdown, 'v1.0.0')).toEqual(SAMPLE_CHANGESET);
  });

  test('supports sub-headings within version section', () => {
    const markdown = createFullChangelog('Changelog', [
      {
        version: SAMPLE_CHANGESET_WITH_SUBHEADING.name,
        body: SAMPLE_CHANGESET_WITH_SUBHEADING.body,
      },
    ]);
    expect(findChangeset(markdown, 'v1.0.0')).toEqual(
      SAMPLE_CHANGESET_WITH_SUBHEADING,
    );
  });

  test.each([
    ['changeset cannot be found', 'v1.0.0'],
    ['invalid version', 'not a version'],
  ])('returns null when %s', (_testName, version) => {
    const markdown = createFullChangelog('Changelog', [
      { version: '1.0.1', body: 'newer' },
      { version: '0.9.0', body: 'older' },
    ]);
    expect(findChangeset(markdown, version)).toEqual(null);
  });
});

describe('removeChangeset', () => {
  const fullChangelog = [
    '# Changelog',
    '',
    '## 1.0.1',
    '',
    'newer',
    '',
    '1.0.0',
    '-------',
    '',
    'this is a test',
    '',
    '## 0.9.1',
    '',
    'slightly older',
    '',
    '## 0.9.0',
    '',
    'older',
  ].join('\n');

  test('removes from the top', () => {
    const expected = [
      '# Changelog',
      '',
      '1.0.0',
      '-------',
      '',
      'this is a test',
      '',
      '## 0.9.1',
      '',
      'slightly older',
      '',
      '## 0.9.0',
      '',
      'older',
    ].join('\n');
    expect(removeChangeset(fullChangelog, '1.0.1')).toEqual(expected);
  });

  test('removes from the middle', () => {
    const expected = [
      '# Changelog',
      '',
      '## 1.0.1',
      '',
      'newer',
      '',
      '1.0.0',
      '-------',
      '',
      'this is a test',
      '',
      '## 0.9.0',
      '',
      'older',
    ].join('\n');
    expect(removeChangeset(fullChangelog, '0.9.1')).toEqual(expected);
  });

  test('removes setext-style heading', () => {
    const expected = [
      '# Changelog',
      '',
      '## 1.0.1',
      '',
      'newer',
      '',
      '## 0.9.1',
      '',
      'slightly older',
      '',
      '## 0.9.0',
      '',
      'older',
    ].join('\n');
    expect(removeChangeset(fullChangelog, '1.0.0')).toEqual(expected);
  });

  test('removes from the bottom', () => {
    const expected = [
      '# Changelog',
      '',
      '## 1.0.1',
      '',
      'newer',
      '',
      '1.0.0',
      '-------',
      '',
      'this is a test',
      '',
      '## 0.9.1',
      '',
      'slightly older',
      '',
      '',
    ].join('\n');
    expect(removeChangeset(fullChangelog, '0.9.0')).toEqual(expected);
  });

  test('returns unchanged when header not found', () => {
    expect(removeChangeset(fullChangelog, 'non-existent version')).toEqual(
      fullChangelog,
    );
  });

  test('returns unchanged when header is empty', () => {
    expect(removeChangeset(fullChangelog, '')).toEqual(fullChangelog);
  });
});

describe('prependChangeset', () => {
  const newChangeset = {
    body: '- rewrote everything from scratch\n- with multiple lines',
    name: '2.0.0',
  };

  test.each([
    [
      'to empty text',
      '',
      '## 2.0.0\n\n- rewrote everything from scratch\n- with multiple lines\n\n',
    ],
    [
      'without top-level header',
      '## 1.0.0\n\nthis is a test\n',
      '## 2.0.0\n\n- rewrote everything from scratch\n- with multiple lines\n\n## 1.0.0\n\nthis is a test\n',
    ],
    [
      'after top-level header (empty body)',
      '# Changelog\n',
      '# Changelog\n## 2.0.0\n\n- rewrote everything from scratch\n- with multiple lines\n\n',
    ],
    [
      'after top-level header',
      '# Changelog\n\n## 1.0.0\n\nthis is a test\n',
      '# Changelog\n\n## 2.0.0\n\n- rewrote everything from scratch\n- with multiple lines\n\n## 1.0.0\n\nthis is a test\n',
    ],
    [
      'matching setext style when detected',
      '# Changelog\n\n1.0.0\n-----\n\nthis is a test\n',
      '# Changelog\n\n2.0.0\n-----\n\n- rewrote everything from scratch\n- with multiple lines\n\n1.0.0\n-----\n\nthis is a test\n',
    ],
  ])('prepends %s', (_testName, markdown, expected) => {
    expect(prependChangeset(markdown, newChangeset)).toEqual(expected);
  });
});
