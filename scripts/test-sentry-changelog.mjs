#!/usr/bin/env node
/**
 * Test AI summarization with Sentry 25.12.0 changelog
 * https://github.com/getsentry/sentry/releases/tag/25.12.0
 */

// Sample sections from Sentry 25.12.0 release
const sections = {
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

async function main() {
  console.log('🧪 Testing AI Summarization with Sentry 25.12.0 Changelog');
  console.log('   https://github.com/getsentry/sentry/releases/tag/25.12.0\n');

  // Dynamic import of the TypeScript module
  const { summarizeItems, DEFAULT_AI_MODEL } = await import(
    '../src/utils/ai-summary.ts'
  );

  const config = { enabled: true, kickInThreshold: 5 };
  console.log(`🤖 Model: ${config.model ?? DEFAULT_AI_MODEL}`);
  console.log(`⚙️  Config: threshold=${config.kickInThreshold}\n`);

  const results = {};

  for (const [name, items] of Object.entries(sections)) {
    console.log(`${'='.repeat(60)}`);
    console.log(`📋 ${name}`);
    console.log(`${'='.repeat(60)}`);

    console.log('\n📝 Original items:');
    items.forEach((item, i) => console.log(`  ${i + 1}. ${item}`));

    const inputWords = items.join(' ').split(/\s+/).length;
    console.log(`\n📊 Input: ${items.length} items, ${inputWords} words`);

    const result = await summarizeItems(items, config);

    if (result) {
      const outputWords = result.split(/\s+/).length;
      const compression = Math.round((1 - outputWords / inputWords) * 100);
      console.log(
        `\n✨ Summary (${outputWords} words, ${compression}% compression):`
      );
      console.log(`   "${result}"`);
    } else {
      console.log('\n⏭️  Skipped (below threshold or disabled)');
    }

    results[name] = { items, result };
    console.log('');
  }

  // Print summary table
  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY TABLE');
  console.log('='.repeat(70));
  console.log(
    'Section                     | Items | Words In | Words Out | Compression'
  );
  console.log('-'.repeat(70));

  for (const [name, { items, result }] of Object.entries(results)) {
    const inputWords = items.join(' ').split(/\s+/).length;
    if (result) {
      const outputWords = result.split(/\s+/).length;
      const compression = Math.round((1 - outputWords / inputWords) * 100);
      console.log(
        `${name.padEnd(28)}| ${String(items.length).padEnd(6)}| ${String(inputWords).padEnd(9)}| ${String(outputWords).padEnd(10)}| ${compression}%`
      );
    } else {
      console.log(
        `${name.padEnd(28)}| ${String(items.length).padEnd(6)}| ${String(inputWords).padEnd(9)}| SKIPPED   | -`
      );
    }
  }

  console.log('\n✅ Test complete!');
}

main().catch(console.error);
