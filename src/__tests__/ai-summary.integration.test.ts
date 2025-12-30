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
