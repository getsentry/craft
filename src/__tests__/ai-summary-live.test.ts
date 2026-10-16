// Opt-in live check; ordinary unit tests never require credentials or inference.
import { readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { expect, test, vi } from 'vitest';
import {
  AiSummaryConfigSchema,
  CraftProjectConfigSchema,
} from '../schemas/project_config';
import { createSummaryProvider } from '../utils/ai-provider';
import { describeCopilotRejection } from './helpers/copilot-diagnostics';

test
  .skipIf(process.env.CRAFT_TEST_LIVE_AI !== 'true')
  .each(['default', 'repository'])(
  'the workflow token and %s settings return a valid changelog digest',
  async settings => {
    let config = AiSummaryConfigSchema.parse({});
    if (settings === 'repository') {
      const project = CraftProjectConfigSchema.parse(
        load(readFileSync(join(__dirname, '../../.craft.yml'), 'utf8')),
      );
      const summary =
        typeof project.changelog === 'object' && project.changelog.aiSummary;
      if (!summary) throw new Error('Repository AI summaries must be enabled');
      config = summary;
    }
    const originalFetch = globalThis.fetch;
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, options) => {
        const response = await originalFetch(input, options);
        if (!response.ok) {
          const credential =
            new Headers(options?.headers)
              .get('Authorization')
              ?.replace(/^Bearer /i, '') || '';
          console.error(
            'Live Copilot rejection:',
            await describeCopilotRejection(response, credential),
          );
        }
        return response;
      });
    const provider = createSummaryProvider(config);
    try {
      const output = await provider.request({
        input: JSON.stringify({
          changes: [
            'Add standalone Craft executables for macOS, Linux, and Windows.',
            'Retain npm installation support.',
          ],
        }),
        system:
          'Summarize these public release facts in one short sentence. Return only JSON matching the supplied schema.',
        schema: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
          additionalProperties: false,
        },
        signal: AbortSignal.timeout(60000),
      });
      expect(output).toEqual({ summary: expect.any(String) });
      expect(
        (output as { summary: string }).summary.trim().length,
      ).toBeGreaterThan(0);
    } finally {
      request.mockRestore();
      await provider.close();
    }
  },
  65000,
);
