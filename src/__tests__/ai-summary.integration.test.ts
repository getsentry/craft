/**
 * Integration tests for AI summarization with real changelog data.
 * Uses Sentry 25.12.0 release notes as test data.
 * @see https://github.com/getsentry/sentry/releases/tag/25.12.0
 *
 * Run with: GITHUB_TOKEN=... yarn test ai-summary.integration
 */
import { describe, expect, test } from 'vitest';

import {
  DEFAULT_KICK_IN_THRESHOLD,
  summarizeItems,
  summarizeChangelog,
  shouldGenerateTopLevel,
  type AiSummariesConfig,
} from '../utils/ai-summary';

// Sample sections from Sentry 25.12.0 release
const SENTRY_25_12_SECTIONS = {
  'ACI (11 items)': [
    'feat(aci): Metric monitor form should default to number of errors',
    'feat(aci): add disabled alert to error/metric monitors and alerts',
    'feat(aci): show test notification errors in UI',
    'feat(aci): Always redirect from alerts when clicking from notification',
    "feat(aci): Add 'open in' button to issue details",
    'feat(aci): Add an open in explore button to metric detector charts',
    'feat(aci): Add contributing issues section to metric issue',
    'feat(aci): Add detector config to issues created by detectors',
    'feat(aci): Add option to send workflow evaluation logs directly to Sentry',
    'feat(aci): Add simpler UX for connecting alerts to a project',
    'feat(aci): Add metric issue event details',
  ],

  'Agents (8 items)': [
    'feat(agents): Render markdown and allow switching to raw values',
    'feat(agents): Preserve icon on spans with error',
    'feat(agents): Add browser js onboarding',
    'feat(ai-insights): move analytics event to event timeseries',
    'feat(analytics): Add Seer feature tracking to issue_details.seer_opened event',
    'feat(anomaly): add seer anomaly thresholds to metric monitor graph',
    'feat(attribute-distributions): parallelize stats query',
    'feat(auth): Bring back SPA auth page, remove deprecated props',
  ],

  'Autofix (4 items)': [
    'feat(autofix): Add backend check to disable autofix if repos are not connected',
    'feat(autofix): add UI for explorer-backed agent',
    'feat(autofix): migrate to explorer agent',
    'feat(autofix): Add email-based user mapping for Seer Autofix PR review requests',
  ],

  'Billing (5 items)': [
    'feat(billing): Migrate chart functions to use DATA_CATEGORY_INFO formatting',
    'feat(billing): Add-on product trials in _admin',
    'feat(billing): Add formatting configuration to DATA_CATEGORY_INFO formatting',
    'feat(billing): Add formatting configuration to DATA_CATEGORY_INFO',
    'feat(billing): Add hook for product billing access',
  ],

  'Seer & Triage (12 items)': [
    'chore(seer): Update check for support repo types by looking at repo.id',
    'chore(seer): Rename column to be more general for other agent types',
    'chore(seer): Tag method name for seer rpcs',
    'chore(seer): codeowner for tests',
    'chore(seer): Remove extra calls to invalidateQueries',
    'chore(seer onboarding): Set api owner of OrganizationSeerOnboardingCheck',
    'chore(seer rpc): Register search agent rpcs',
    'chore(seer rpc): Add missing endpoints',
    'chore(triage signals): Set org level default to medium too',
    'chore(triage signals): Log cleanup',
    'ref(seer): Tweak Seer org settings page',
    'ref(explorer): issues rpc revamp',
  ],

  'Replay (4 items)': [
    'chore(replay): add feature flag for granular replay permissions',
    'refactor(replay): update replay components to use linkQuery for navigation',
    'refactor(replay): remove unused components in platform icons',
    'refactor(replay): shrink top header buttons to xs',
  ],
};

const hasGitHubToken = !!process.env.GITHUB_TOKEN;

describe.skipIf(!hasGitHubToken)(
  'AI Summary Integration - Sentry 25.12.0',
  () => {
    const config: AiSummariesConfig = {
      enabled: true,
      kickInThreshold: DEFAULT_KICK_IN_THRESHOLD,
    };

    test.each(Object.entries(SENTRY_25_12_SECTIONS))(
      'summarizes %s',
      async (sectionName, items) => {
        const result = await summarizeItems(items, config);
        const inputWords = items.join(' ').split(/\s+/).length;

        if (items.length <= DEFAULT_KICK_IN_THRESHOLD) {
          // Sections with ≤5 items should be skipped
          expect(result).toBeNull();
        } else {
          // Sections with >5 items should be summarized
          expect(result).toBeTruthy();
          expect(typeof result).toBe('string');

          // Should achieve meaningful compression
          const outputWords = result!.split(/\s+/).length;
          const compressionRatio = outputWords / inputWords;

          console.log(`\n📋 ${sectionName}`);
          console.log(`   Input: ${items.length} items, ${inputWords} words`);
          console.log(
            `   Output: ${outputWords} words (${Math.round((1 - compressionRatio) * 100)}% compression)`
          );
          console.log(`   Summary: "${result}"`);

          // Expect at least 30% compression for large sections
          expect(compressionRatio).toBeLessThan(0.7);
        }
      },
      { timeout: 30000 }
    );

    test('respects threshold - skips small sections', async () => {
      const smallSection = SENTRY_25_12_SECTIONS['Autofix (4 items)'];
      expect(smallSection.length).toBeLessThanOrEqual(
        DEFAULT_KICK_IN_THRESHOLD
      );

      const result = await summarizeItems(smallSection, config);
      expect(result).toBeNull();
    });

    test('summarizes large sections', async () => {
      const largeSection = SENTRY_25_12_SECTIONS['ACI (11 items)'];
      expect(largeSection.length).toBeGreaterThan(DEFAULT_KICK_IN_THRESHOLD);

      const result = await summarizeItems(largeSection, config);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');

      // Should be prose, not bullet points
      expect(result).not.toContain('feat(aci)');
    });
  }
);

// Craft 2.16.0 sections for top-level summary testing
const CRAFT_2_16_SECTIONS = {
  'New Features': [
    'Strip commit patterns from changelog entries',
    'Add support for custom changelog entries from PR descriptions',
    'Support for multiple entries and nested items',
    'Add changelog preview action and CLI command',
    'Make release workflow reusable for external repos',
    'Add version templating for layer names',
  ],
};

// Sentry 25.12.0 sections without prefixes for top-level testing
const SENTRY_CLEAN_SECTIONS = {
  ACI: [
    'Metric monitor form should default to number of errors',
    'Add disabled alert to error/metric monitors and alerts',
    'Show test notification errors in UI',
    'Always redirect from alerts when clicking from notification',
    'Add open in button to issue details',
    'Add an open in explore button to metric detector charts',
    'Add contributing issues section to metric issue',
    'Add detector config to issues created by detectors',
    'Add option to send workflow evaluation logs directly to Sentry',
    'Add simpler UX for connecting alerts to a project',
    'Add metric issue event details',
  ],
  Agents: [
    'Render markdown and allow switching to raw values',
    'Preserve icon on spans with error',
    'Add browser js onboarding',
    'Move analytics event to event timeseries',
    'Add Seer feature tracking to issue_details.seer_opened event',
    'Add seer anomaly thresholds to metric monitor graph',
    'Parallelize stats query',
    'Bring back SPA auth page, remove deprecated props',
  ],
  'Seer & Triage': [
    'Update check for support repo types by looking at repo.id',
    'Rename column to be more general for other agent types',
    'Tag method name for seer rpcs',
    'Codeowner for tests',
    'Remove extra calls to invalidateQueries',
    'Set api owner of OrganizationSeerOnboardingCheck',
    'Register search agent rpcs',
    'Add missing endpoints',
    'Set org level default to medium too',
    'Log cleanup',
    'Tweak Seer org settings page',
    'Issues rpc revamp',
  ],
};

describe.skipIf(!hasGitHubToken)(
  'AI Summary Integration - Top-Level Summary',
  () => {
    describe('shouldGenerateTopLevel', () => {
      test('returns true for large releases with threshold mode', () => {
        const totalItems = Object.values(SENTRY_CLEAN_SECTIONS).flat().length;
        expect(totalItems).toBe(31);
        expect(shouldGenerateTopLevel(totalItems, { topLevel: 'threshold' })).toBe(true);
      });

      test('returns false for small releases with threshold mode', () => {
        expect(shouldGenerateTopLevel(5, { topLevel: 'threshold' })).toBe(false);
      });

      test('returns true with always mode regardless of size', () => {
        expect(shouldGenerateTopLevel(1, { topLevel: 'always' })).toBe(true);
        expect(shouldGenerateTopLevel(1, { topLevel: true })).toBe(true);
      });

      test('returns false with never mode regardless of size', () => {
        expect(shouldGenerateTopLevel(100, { topLevel: 'never' })).toBe(false);
        expect(shouldGenerateTopLevel(100, { topLevel: false })).toBe(false);
      });
    });

    describe('summarizeChangelog', () => {
      test(
        'generates top-level summary for Craft 2.16.0',
        async () => {
          const result = await summarizeChangelog(CRAFT_2_16_SECTIONS, {
            topLevel: 'always',
          });

          expect(result).toBeTruthy();
          expect(typeof result).toBe('string');

          // Should be a paragraph, not bullet points
          expect(result).not.toMatch(/^[-*•]/m);

          // Should be reasonably sized (1-5 sentences)
          const sentences = result!.split(/[.!?]+/).filter(s => s.trim());
          expect(sentences.length).toBeGreaterThanOrEqual(1);
          expect(sentences.length).toBeLessThanOrEqual(7);

          console.log('\n📋 Craft 2.16.0 Top-Level Summary');
          console.log(`   Items: ${Object.values(CRAFT_2_16_SECTIONS).flat().length}`);
          console.log(`   Summary: "${result}"`);
        },
        { timeout: 30000 }
      );

      test(
        'generates top-level summary for Sentry 25.12.0',
        async () => {
          const result = await summarizeChangelog(SENTRY_CLEAN_SECTIONS, {
            topLevel: 'always',
          });

          expect(result).toBeTruthy();
          expect(typeof result).toBe('string');

          // Should mention key themes
          const summary = result!.toLowerCase();
          const hasRelevantContent =
            summary.includes('aci') ||
            summary.includes('agent') ||
            summary.includes('seer') ||
            summary.includes('monitor') ||
            summary.includes('error') ||
            summary.includes('update') ||
            summary.includes('feature') ||
            summary.includes('enhance');
          expect(hasRelevantContent).toBe(true);

          // Should be a proper paragraph
          const wordCount = result!.split(/\s+/).length;
          expect(wordCount).toBeGreaterThan(20);
          expect(wordCount).toBeLessThan(150);

          console.log('\n📋 Sentry 25.12.0 Top-Level Summary');
          console.log(`   Items: ${Object.values(SENTRY_CLEAN_SECTIONS).flat().length}`);
          console.log(`   Words: ${wordCount}`);
          console.log(`   Summary: "${result}"`);
        },
        { timeout: 30000 }
      );

      test(
        'respects threshold mode - skips small releases',
        async () => {
          const smallSections = {
            'Bug Fixes': ['Fix A', 'Fix B', 'Fix C'],
          };

          const result = await summarizeChangelog(smallSections, {
            topLevel: 'threshold',
            kickInThreshold: 5,
          });

          expect(result).toBeNull();
        },
        { timeout: 30000 }
      );

      test(
        'respects never mode - skips even large releases',
        async () => {
          const result = await summarizeChangelog(SENTRY_CLEAN_SECTIONS, {
            topLevel: 'never',
          });

          expect(result).toBeNull();
        },
        { timeout: 30000 }
      );
    });
  }
);
