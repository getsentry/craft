/**
 * Tests for changelog extraction and parsing functions.
 * - extractScope: Extracts scope from conventional commit titles
 * - formatScopeTitle: Formats scope for display
 * - extractChangelogEntry: Extracts custom changelog entries from PR bodies
 */

import {
  extractScope,
  formatScopeTitle,
  extractChangelogEntry,
} from '../changelog';

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
    ['security(auth): patch login', 'auth'],
    ['security(auth)!: rotate keys', 'auth'],
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
      const prBody =
        '### Changelog Entry\r\n\r\n- Entry with CRLF\r\n- Another entry\r\n\r\n### Next';
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

describe('extractChangelogEntry code blocks', () => {
  it('preserves fenced code block inside a bullet item', () => {
    const prBody = `### Changelog Entry

- Added a new \`foo\` function:
  \`\`\`go
  func foo() {
    fmt.Println("Hello")
  }
  \`\`\`
- Another entry`;

    const result = extractChangelogEntry(prBody);
    expect(result).toHaveLength(2);
    expect(result![0].text).toBe('Added a new `foo` function:');
    expect(result![0].nestedContent).toContain('```go');
    expect(result![0].nestedContent).toContain('func foo()');
    expect(result![1].text).toBe('Another entry');
    expect(result![1].nestedContent).toBeUndefined();
  });

  it('preserves code block without language specifier', () => {
    const prBody = `### Changelog Entry

- Example code:
  \`\`\`
  some code here
  \`\`\``;

    const result = extractChangelogEntry(prBody);
    expect(result).toHaveLength(1);
    expect(result![0].text).toBe('Example code:');
    expect(result![0].nestedContent).toContain('```');
    expect(result![0].nestedContent).toContain('some code here');
    // Should not have a language tag after the opening fence
    expect(result![0].nestedContent).not.toMatch(/```\S/);
  });

  it('preserves standalone code block after paragraph', () => {
    const prBody = `### Changelog Entry

Here is a change with code:

\`\`\`go
func foo() {}
\`\`\``;

    const result = extractChangelogEntry(prBody);
    expect(result).toHaveLength(1);
    expect(result![0].text).toBe('Here is a change with code:');
    expect(result![0].nestedContent).toContain('```go');
    expect(result![0].nestedContent).toContain('func foo() {}');
    // Verify 2-space indentation for proper nesting under list items
    expect(result![0].nestedContent).toBe('  ```go\n  func foo() {}\n  ```');
  });

  it('preserves code block in loose list item', () => {
    const prBody = `### Changelog Entry

- First entry with code:

  \`\`\`go
  func foo() {}
  \`\`\`

- Second entry`;

    const result = extractChangelogEntry(prBody);
    expect(result).toHaveLength(2);
    expect(result![0].text).toBe('First entry with code:');
    expect(result![0].nestedContent).toContain('```go');
    expect(result![0].nestedContent).toContain('func foo() {}');
    expect(result![1].text).toBe('Second entry');
  });

  it('preserves nested list items alongside code blocks', () => {
    const prBody = `### Changelog Entry

- Main entry
  - Sub item
  \`\`\`js
  const x = 1;
  \`\`\``;

    const result = extractChangelogEntry(prBody);
    expect(result).toHaveLength(1);
    expect(result![0].text).toBe('Main entry');
    expect(result![0].nestedContent).toContain('- Sub item');
    expect(result![0].nestedContent).toContain('```js');
    expect(result![0].nestedContent).toContain('const x = 1;');
  });

  it('skips orphaned code block with no preceding entry', () => {
    const prBody = `### Changelog Entry

\`\`\`go
func foo() {}
\`\`\``;

    const result = extractChangelogEntry(prBody);
    // A bare code block without descriptive text is not a meaningful entry
    expect(result).toBeNull();
  });
});

describe('extractChangelogEntry HTML blocks', () => {
  it('preserves <img> tag after paragraph as nested content', () => {
    const prBody = `### Changelog Entry

Add a chart rendering engine for \`sentry dashboard view\`.

<img width="800" alt="screenshot" src="https://example.com/screenshot.png" />

### Next Section`;

    const result = extractChangelogEntry(prBody);
    expect(result).toHaveLength(1);
    expect(result![0].text).toBe(
      'Add a chart rendering engine for `sentry dashboard view`.',
    );
    expect(result![0].nestedContent).toContain('<img');
    expect(result![0].nestedContent).toContain(
      'src="https://example.com/screenshot.png"',
    );
  });

  it('preserves <img> tag after list item as nested content', () => {
    const prBody = `### Changelog Entry

- Added dashboard charts

<img src="https://example.com/chart.png" />`;

    const result = extractChangelogEntry(prBody);
    expect(result).toHaveLength(1);
    expect(result![0].text).toBe('Added dashboard charts');
    expect(result![0].nestedContent).toContain('<img');
    expect(result![0].nestedContent).toContain(
      'src="https://example.com/chart.png"',
    );
  });

  it('skips orphaned HTML block with no preceding entry', () => {
    const prBody = `### Changelog Entry

<img src="https://example.com/orphan.png" />

### Next Section`;

    const result = extractChangelogEntry(prBody);
    // A bare HTML block without descriptive text is not a meaningful entry
    expect(result).toBeNull();
  });

  it('preserves inline <img> within paragraph text', () => {
    const prBody = `### Changelog Entry

See the result: <img src="https://example.com/inline.png" /> pretty cool`;

    const result = extractChangelogEntry(prBody);
    expect(result).toHaveLength(1);
    // Inline HTML within a paragraph is preserved in the text itself
    expect(result![0].text).toContain('<img');
    expect(result![0].text).toContain('pretty cool');
  });

  it('appends HTML block to existing nested content', () => {
    const prBody = `### Changelog Entry

- Entry with code and image:
  \`\`\`go
  func foo() {}
  \`\`\`

<img src="https://example.com/result.png" />`;

    const result = extractChangelogEntry(prBody);
    expect(result).toHaveLength(1);
    expect(result![0].text).toBe('Entry with code and image:');
    expect(result![0].nestedContent).toContain('```go');
    expect(result![0].nestedContent).toContain('<img');
  });

  it('preserves GitHub-style image upload HTML', () => {
    // GitHub stores uploaded images as HTML img tags with width/height
    const prBody = `## Changelog Entry

Add a full chart rendering engine.

<img width="2512" height="1757" alt="image" src="https://github.com/user-attachments/assets/abc123" />

## Chart Types`;

    const result = extractChangelogEntry(prBody);
    expect(result).toHaveLength(1);
    expect(result![0].text).toBe('Add a full chart rendering engine.');
    expect(result![0].nestedContent).toContain('width="2512"');
    expect(result![0].nestedContent).toContain(
      'src="https://github.com/user-attachments/assets/abc123"',
    );
  });

  it('indents all lines of multi-line HTML blocks', () => {
    const prBody = `### Changelog Entry

Added collapsible details section.

<details>
<summary>Click to expand</summary>
Some hidden content here.
</details>`;

    const result = extractChangelogEntry(prBody);
    expect(result).toHaveLength(1);
    expect(result![0].text).toBe('Added collapsible details section.');
    // Every line should be indented with 2 spaces
    const lines = result![0].nestedContent!.split('\n');
    for (const line of lines) {
      expect(line).toMatch(/^ {2}/);
    }
    expect(result![0].nestedContent).toContain('  <details>');
    expect(result![0].nestedContent).toContain(
      '  <summary>Click to expand</summary>',
    );
    expect(result![0].nestedContent).toContain('  </details>');
  });
});
