import { parse, type ParseError } from 'jsonc-parser';
import upstreamTermsSource from 'textlint-rule-terminology/terms.jsonc?raw';

/**
 * A term in the textlint-rule-terminology format: either the correct spelling
 * of a word, such as "GitHub", or a `[pattern, replacement]` pair, such as
 * `["Mac ?OS", "macOS"]`. Patterns are case-insensitive regular expressions.
 */
type Term = string | [pattern: string, replacement: string];

/**
 * Terms that textlint-rule-terminology does not have, or that it spells in a
 * way that does not fit a scope header. They take precedence over its list.
 */
const CRAFT_TERMS: Term[] = [
  'AI',
  'AWS',
  'CI',
  'CLI',
  'DB',
  'GCP',
  'GH',
  // Upstream writes this rule as "\bHTTP(?!:)" in JSON, so its pattern starts
  // with a backspace character and never matches.
  'HTTP',
  'MCP',
  // Upstream only keeps "npm" lowercase in the middle of a sentence.
  'npm',
  'OAuth',
  'UI',
  'visionOS',
];

interface PatternRule {
  pattern: string;
  regExp: RegExp;
  replacement: string;
}

interface ScopeTerms {
  /** Correct spellings keyed by their lowercase form */
  words: Map<string, string>;
  /** Pattern rules that only change casing or separators */
  patterns: PatternRule[];
}

let scopeTerms: ScopeTerms | undefined;

function loadUpstreamTerms(): Term[] {
  const errors: ParseError[] = [];
  const terms = parse(upstreamTermsSource, errors) as unknown;
  if (errors.length > 0 || !Array.isArray(terms)) {
    throw new Error('Could not parse textlint-rule-terminology terms');
  }
  return terms as Term[];
}

/**
 * Wraps a pattern so it only matches whole words, unless it already has its
 * own lookarounds, the same way textlint-rule-terminology does.
 */
function toWordRegExp(pattern: string): RegExp {
  const hasLookaround =
    pattern.startsWith('(?<') ||
    pattern.includes('(?=') ||
    pattern.includes('(?!');
  return new RegExp(
    hasLookaround ? pattern : `(?<!\\w)(?:${pattern})(?!\\w)`,
    'gi',
  );
}

function buildScopeTerms(terms: Term[]): ScopeTerms {
  const words = new Map<string, string>();
  const patterns: PatternRule[] = [];
  for (const term of terms) {
    if (typeof term === 'string') {
      // The first spelling wins, so our terms override upstream ones.
      const key = term.toLowerCase();
      if (!words.has(key)) {
        words.set(key, term);
      }
    } else {
      const [pattern, replacement] = term;
      // An all-lowercase replacement, such as "readme" or "kebab-case", is a
      // rule for running text. A header capitalizes its words instead.
      if (/\p{Lu}/u.test(replacement)) {
        patterns.push({ pattern, regExp: toWordRegExp(pattern), replacement });
      }
    }
  }
  return { words, patterns };
}

function getScopeTerms(): ScopeTerms {
  scopeTerms ??= buildScopeTerms([...CRAFT_TERMS, ...loadUpstreamTerms()]);
  return scopeTerms;
}

/** Lowercases text and drops everything that is not a letter or a digit */
function letters(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Formats a scope name for display as a header.
 *
 * Splits the scope on dashes, underscores and whitespace, then writes each word
 * the way the terms list spells it, such as "iOS" or "API", or capitalizes its
 * first letter. Pattern rules then fix terms that span words, such as
 * "Node Js" → "Node.js". A pattern rule may only change casing and separators,
 * never the letters: "repo" stays "Repo" instead of becoming "Repository".
 *
 * For example: "my-component" becomes "My Component", "ios-sdk" becomes
 * "iOS SDK".
 */
export function formatScopeTitle(scope: string): string {
  const { words, patterns } = getScopeTerms();
  const title = scope
    .split(/[-_\s]+/)
    .map(
      word =>
        words.get(word.toLowerCase()) ??
        word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
  return patterns.reduce(
    (text, { pattern, regExp, replacement }) =>
      text.replace(regExp, matched => {
        const fixed = matched.replace(new RegExp(pattern, 'i'), replacement);
        return letters(fixed) === letters(matched) ? fixed : matched;
      }),
    title,
  );
}
