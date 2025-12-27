/**
 * Common test fixtures and helpers for changelog tests.
 * Extracted to reduce test file size and improve maintainability.
 */

// ============================================================================
// Markdown Helpers - create markdown without template literal indentation issues
// ============================================================================

/**
 * Creates a changelog markdown string with proper formatting.
 * Avoids template literal indentation issues.
 */
export function createChangelog(
  sections: Array<{ version: string; body: string; style?: 'atx' | 'setext' }>
): string {
  return sections
    .map(({ version, body, style = 'atx' }) => {
      if (style === 'setext') {
        return `${version}\n${'-'.repeat(version.length)}\n\n${body}`;
      }
      return `## ${version}\n\n${body}`;
    })
    .join('\n\n');
}

/**
 * Creates a full changelog with title.
 */
export function createFullChangelog(
  title: string,
  sections: Array<{ version: string; body: string; style?: 'atx' | 'setext' }>
): string {
  return `# ${title}\n\n${createChangelog(sections)}`;
}

// ============================================================================
// Sample Changesets
// ============================================================================

export const SAMPLE_CHANGESET = {
  body: '- this is a test',
  name: 'Version 1.0.0',
};

export const SAMPLE_CHANGESET_WITH_SUBHEADING = {
  body: '### Features\nthis is a test',
  name: 'Version 1.0.0',
};

// ============================================================================
// Test Commit Types - reusable commit definitions
// ============================================================================

export interface TestCommit {
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

/**
 * Creates a simple local commit (no PR).
 */
export function localCommit(
  hash: string,
  title: string,
  body = ''
): TestCommit {
  return { hash, title, body };
}

/**
 * Creates a commit with a linked PR.
 */
export function prCommit(
  hash: string,
  title: string,
  prNumber: string,
  options: {
    author?: string;
    body?: string;
    labels?: string[];
    prTitle?: string;
    prBody?: string;
  } = {}
): TestCommit {
  return {
    hash,
    title,
    body: options.body ?? '',
    author: options.author,
    pr: {
      local: prNumber,
      remote: {
        author: options.author ? { login: options.author } : undefined,
        number: prNumber,
        title: options.prTitle ?? title,
        body: options.prBody ?? '',
        labels: options.labels ?? [],
      },
    },
  };
}

// ============================================================================
// Common Release Configs
// ============================================================================

export const BASIC_RELEASE_CONFIG = `
changelog:
  categories:
    - title: Features
      labels:
        - enhancement
    - title: Bug Fixes
      labels:
        - bug
`;

export const RELEASE_CONFIG_WITH_PATTERNS = `
changelog:
  categories:
    - title: Features
      labels:
        - enhancement
      commit_patterns:
        - "^feat(\\\\([^)]+\\\\))?:"
    - title: Bug Fixes
      labels:
        - bug
      commit_patterns:
        - "^fix(\\\\([^)]+\\\\))?:"
`;

export const RELEASE_CONFIG_WITH_EXCLUSIONS = `
changelog:
  exclude:
    labels:
      - skip-changelog
    authors:
      - dependabot
      - renovate
  categories:
    - title: Features
      labels:
        - enhancement
    - title: Bug Fixes
      labels:
        - bug
`;

export const RELEASE_CONFIG_WITH_WILDCARD = `
changelog:
  categories:
    - title: Changes
      labels:
        - "*"
`;

export const RELEASE_CONFIG_WITH_SCOPE_GROUPING = `
changelog:
  scopeGrouping: true
  categories:
    - title: Features
      labels:
        - enhancement
      commit_patterns:
        - "^feat(\\\\([^)]+\\\\))?:"
    - title: Bug Fixes
      labels:
        - bug
      commit_patterns:
        - "^fix(\\\\([^)]+\\\\))?:"
`;

// ============================================================================
// Expected Output Helpers
// ============================================================================

const BASE_URL = 'https://github.com/test-owner/test-repo';

/**
 * Creates an expected PR link.
 */
export function prLink(number: string): string {
  return `[#${number}](${BASE_URL}/pull/${number})`;
}

/**
 * Creates an expected commit link.
 */
export function commitLink(hash: string, shortHash?: string): string {
  const display = shortHash ?? hash.slice(0, 8);
  return `[${display}](${BASE_URL}/commit/${hash})`;
}

/**
 * Creates an expected changelog entry line.
 */
export function changelogEntry(
  title: string,
  options: { author?: string; prNumber?: string; hash?: string } = {}
): string {
  const parts = [title];

  if (options.author) {
    parts.push(`by @${options.author}`);
  }

  if (options.prNumber) {
    parts.push(`in ${prLink(options.prNumber)}`);
  } else if (options.hash) {
    parts.push(`in ${commitLink(options.hash)}`);
  }

  return `- ${parts.join(' ')}`;
}

/**
 * Creates a changelog section with title.
 */
export function changelogSection(
  title: string,
  emoji: string,
  entries: string[]
): string {
  return `### ${title} ${emoji}\n\n${entries.join('\n')}`;
}

