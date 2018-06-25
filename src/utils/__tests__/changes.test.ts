/* eslint-env jest */

import { findChangeset } from '../changes';

test('extracts a single change', () => {
  const name = 'Version 1.0.0';
  const body = 'this is a test';
  const markdown = `# Changelog\n## ${name}\n${body}\n`;
  const changes = findChangeset(markdown, 'v1.0.0');
  expect(changes).toEqual({ name, body });
});

test('extracts a change between headings', () => {
  const name = 'Version 1.0.0';
  const body = 'this is a test';

  const markdown = `# Changelog
  ## 1.0.1
  newer

  ## ${name}
  ${body}

  ## 0.9.0
  older
  `;

  const changes = findChangeset(markdown, 'v1.0.0');
  expect(changes).toEqual({ name, body });
});

test('extracts changes from underlined headings', () => {
  const name = 'Version 1.0.0';
  const body = 'this is a test';
  const markdown = `Changelog\n====\n${name}\n----\n${body}\n`;
  const changes = findChangeset(markdown, 'v1.0.0');
  expect(changes).toEqual({ name, body });
});

test('extracts changes from alternating headings', () => {
  const name = 'Version 1.0.0';
  const body = 'this is a test';

  const markdown = `# Changelog
  ## 1.0.1
  newer

  ${name}
  -------
  ${body}

  ## 0.9.0
  older
  `;

  const changes = findChangeset(markdown, 'v1.0.0');
  expect(changes).toEqual({ name, body });
});

test('returns undefined if the tag is no valid version', () => {
  const changes = findChangeset('', 'not a version');
  expect(changes).toBe(undefined);
});

test('returns undefined if no changeset is found', () => {
  const markdown = `# Changelog
  ## 1.0.1
  newer

  ## 0.9.0
  older
  `;

  const changes = findChangeset(markdown, 'v1.0.0');
  expect(changes).toBe(undefined);
});
