/**
 * Eval tests for AI summary quality using vitest-evals.
 *
 * These tests use GitHub Models API to evaluate summarization quality.
 * Requires GITHUB_TOKEN or `gh auth login`.
 *
 * Run: yarn test:evals
 */

import { describeEval } from 'vitest-evals';
import { describe, afterAll } from 'vitest';
import { summarizeItems, resetPipeline } from '../utils/ai-summary';

// Test data - real changelog entries from various releases
const TEST_CASES = [
  {
    input: [
      'Strip commit patterns from changelog entries',
      'Add support for custom changelog entries from PR descriptions',
      'Support for multiple entries and nested items',
      'Add changelog preview action and CLI command',
      'Make release workflow reusable for external repos',
      'Add version templating for layer names',
    ],
    // Keywords that should appear in the summary
    expectedKeywords: ['changelog', 'preview', 'workflow'],
    description: 'Craft 2.16.0 New Features',
  },
  {
    input: [
      'Add dark mode toggle to settings',
      'Implement new dashboard widgets',
      'Add user preferences panel',
      'Create notification center',
      'Build analytics overview page',
      'Add keyboard shortcuts support',
    ],
    // Allow semantic equivalents
    expectedKeywords: ['dark mode', 'widget', 'notification'],
    description: 'UI Features',
  },
  {
    input: [
      'Fix memory leak in connection pool',
      'Handle null pointer in parser',
      'Correct timezone handling for DST',
      'Fix race condition in async handler',
      'Resolve deadlock in worker threads',
      'Fix buffer overflow in decoder',
    ],
    // Allow semantic equivalents: memory/leak, fix/address/resolve, concurrency/race
    expectedKeywords: ['memory', 'error', 'concurren'],
    description: 'Bug Fixes',
  },
];

/**
 * Custom scorer: checks if summary contains expected keywords
 */
const KeywordScorer = async ({
  output,
  expected,
}: {
  output: string;
  expected: string[];
}) => {
  if (!output || !expected) {
    return { score: 0, metadata: { reason: 'Missing output or expected' } };
  }

  const outputLower = output.toLowerCase();
  const found = expected.filter(kw => outputLower.includes(kw.toLowerCase()));
  const score = found.length / expected.length;

  return {
    score,
    metadata: {
      found,
      missing: expected.filter(kw => !outputLower.includes(kw.toLowerCase())),
      total: expected.length,
    },
  };
};

/**
 * Custom scorer: checks if output is a proper sentence
 */
const SentenceFormatScorer = async ({ output }: { output: string }) => {
  if (!output) {
    return { score: 0, metadata: { reason: 'Empty output' } };
  }

  const checks = {
    startsWithCapital: /^[A-Z]/.test(output),
    endsWithPunctuation: /[.!?]$/.test(output),
    notBulletList: !output.includes('\n-') && !output.includes('\n•'),
    notNumberedList: !/^\d+\.\s/.test(output),
    reasonableLength: output.length > 20 && output.length < 500,
  };

  const passed = Object.values(checks).filter(Boolean).length;
  const score = passed / Object.keys(checks).length;

  return {
    score,
    metadata: checks,
  };
};

/**
 * Custom scorer: checks if summary is more concise than input
 */
const ConcisenessScorer = async ({
  input,
  output,
}: {
  input: string[];
  output: string;
}) => {
  if (!output || !input) {
    return { score: 0, metadata: { reason: 'Missing data' } };
  }

  const inputWords = input.join(' ').split(/\s+/).length;
  const outputWords = output.split(/\s+/).length;

  const ratio = outputWords / inputWords;
  let score: number;

  // For true summarization, we expect significant compression
  if (ratio < 0.3) {
    score = 1.0; // Excellent compression
  } else if (ratio <= 0.5) {
    score = 0.9; // Good compression
  } else if (ratio <= 0.7) {
    score = 0.7; // Acceptable compression
  } else if (ratio <= 1.0) {
    score = 0.5; // Minimal compression
  } else {
    score = 0.2; // Expanded instead of summarized
  }

  return {
    score,
    metadata: {
      inputWords,
      outputWords,
      ratio: ratio.toFixed(2),
      compressionPercent: `${((1 - ratio) * 100).toFixed(0)}%`,
    },
  };
};

// Check token availability at module load time
const apiAvailable = !!process.env.GITHUB_TOKEN;

describe('AI Summary Evals', () => {
  afterAll(() => {
    resetPipeline();
  });

  describeEval('Keyword Coverage', {
    skipIf: () => !apiAvailable,

    data: async () =>
      TEST_CASES.map(tc => ({
        input: tc.input,
        expected: tc.expectedKeywords,
        metadata: { description: tc.description },
      })),

    task: async (input: string[]) => {
      const result = await summarizeItems(input, { kickInThreshold: 0 });
      return result || '';
    },

    scorers: [KeywordScorer],

    // At least 1 of 3 keywords should be present
    // LLM may use semantic equivalents, so we're lenient here
    threshold: 0.3,
  });

  describeEval('Sentence Format', {
    skipIf: () => !apiAvailable,

    data: async () =>
      TEST_CASES.map(tc => ({
        input: tc.input,
        metadata: { description: tc.description },
      })),

    task: async (input: string[]) => {
      const result = await summarizeItems(input, { kickInThreshold: 0 });
      return result || '';
    },

    scorers: [SentenceFormatScorer],

    // Output should pass most format checks
    threshold: 0.8,
  });

  describeEval('Conciseness', {
    skipIf: () => !apiAvailable,

    data: async () =>
      TEST_CASES.map(tc => ({
        input: tc.input,
        metadata: { description: tc.description },
      })),

    task: async (input: string[]) => {
      const result = await summarizeItems(input, { kickInThreshold: 0 });
      return result || '';
    },

    scorers: [ConcisenessScorer],

    // Should achieve good compression
    threshold: 0.7,
  });
});
