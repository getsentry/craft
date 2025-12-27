/**
 * Tests for changelog extraction and parsing functions.
 * - extractScope: Extracts scope from conventional commit titles
 * - formatScopeTitle: Formats scope for display
 * - extractChangelogEntry: Extracts custom changelog entries from PR bodies
 */

import { extractScope, formatScopeTitle, extractChangelogEntry } from '../changelog';

describe('extractScope', () => {
  it.each([
    ['feat(api): add endpoint', 'api'],
    ['fix(ui): fix button', 'ui'],
    ['feat(my-component): add feature', 'my-component'],
    ['feat(my_component): add feature', 'my-component'],
    ['feat(API): uppercase scope', 'api'],
    ['feat(MyComponent): mixed case', 'mycomponent'],
    ['feat(scope)!: breaking change', 'scope'],
    ['fix(core)!: another breaking', 'core'],
    ['docs(readme): update docs', 'readme'],
    ['chore(deps): update dependencies', 'deps'],
    ['feat(my-long_scope): mixed separators', 'my-long-scope'],
  ])('extracts scope from "%s" as "%s"', (title, expected) => {
    expect(extractScope(title)).toBe(expected);
  });

  it.each([
    ['feat: no scope', null],
    ['fix: simple fix', null],
    ['random commit message', null],
    ['feat!: breaking without scope', null],
    ['(scope): missing type', null],
    ['feat(): empty scope', null],
  ])('returns null for "%s"', (title, expected) => {
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
  ])('formats "%s" as "%s"', (scope, expected) => {
    expect(formatScopeTitle(scope)).toBe(expected);
  });
});

describe('extractChangelogEntry', () => {
  describe('basic extraction', () => {
    it('extracts from ### Changelog Entry section', () => {
      const prBody = `### Description

This PR adds a new feature.

### Changelog Entry

Add a new function called \`foo\` which prints "Hello, world!"

### Issues

Closes #123`;

      expect(extractChangelogEntry(prBody)).toMatchSnapshot();
    });

    it('extracts from ## Changelog Entry section', () => {
      const prBody = `## Description

This PR adds a new feature.

## Changelog Entry

Add a new function called \`foo\` which prints "Hello, world!"

## Issues

Closes #123`;

      expect(extractChangelogEntry(prBody)).toMatchSnapshot();
    });

    it('handles changelog entry at end of body', () => {
      const prBody = `### Description

This PR adds a new feature.

### Changelog Entry

This is the last section with no sections after it.`;

      expect(extractChangelogEntry(prBody)).toMatchSnapshot();
    });
  });

  describe('bullet point handling', () => {
    it('parses multiple bullets as separate entries', () => {
      const prBody = `### Changelog Entry

- First entry
- Second entry
- Third entry`;

      expect(extractChangelogEntry(prBody)).toMatchSnapshot();
    });

    it('handles nested bullets', () => {
      const prBody = `### Changelog Entry

- Main entry
  - Nested item 1
  - Nested item 2`;

      expect(extractChangelogEntry(prBody)).toMatchSnapshot();
    });

    it('handles multiple top-level bullets with nested content', () => {
      const prBody = `### Changelog Entry

- First feature
  - Detail A
  - Detail B
- Second feature
  - Detail C`;

      expect(extractChangelogEntry(prBody)).toMatchSnapshot();
    });
  });

  describe('edge cases', () => {
    it('returns null for null/undefined input', () => {
      expect(extractChangelogEntry(null)).toBeNull();
      expect(extractChangelogEntry(undefined)).toBeNull();
      expect(extractChangelogEntry('')).toBeNull();
    });

    it('returns null when no changelog entry section exists', () => {
      const prBody = `### Description

This PR has no changelog entry section.`;

      expect(extractChangelogEntry(prBody)).toBeNull();
    });

    it('returns null for empty changelog entry section', () => {
      const prBody = `### Changelog Entry

### Next Section`;

      expect(extractChangelogEntry(prBody)).toBeNull();
    });

    it('handles CRLF line endings', () => {
      const prBody = '### Changelog Entry\r\n\r\n- Entry with CRLF\r\n- Another entry\r\n\r\n### Next';
      expect(extractChangelogEntry(prBody)).toMatchSnapshot();
    });

    it('treats multi-line plain text as single entry', () => {
      const prBody = `### Changelog Entry

This is a multi-line
changelog entry that
spans several lines.`;

      expect(extractChangelogEntry(prBody)).toMatchSnapshot();
    });

    it('case-insensitive heading match', () => {
      const prBody = `### CHANGELOG ENTRY

This should still be extracted.`;

      expect(extractChangelogEntry(prBody)).toMatchSnapshot();
    });
  });

  describe('paragraph and list combinations', () => {
    it('handles paragraph followed by list with blank line', () => {
      const prBody = `### Changelog Entry

Intro paragraph:

- First item
- Second item`;

      expect(extractChangelogEntry(prBody)).toMatchSnapshot();
    });
  });
});

