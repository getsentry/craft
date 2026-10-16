// Opt-in live check; ordinary unit tests never require credentials or inference.
import { expect, test, vi } from 'vitest';
import { AiSummaryConfigSchema } from '../schemas/project_config';
import { createSummaryProvider } from '../utils/ai-provider';
import { describeCopilotRejection } from './helpers/copilot-diagnostics';

test.skipIf(process.env.CRAFT_TEST_LIVE_AI !== 'true')(
  'the workflow token and default model return a valid changelog digest',
  async () => {
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
    const provider = createSummaryProvider(AiSummaryConfigSchema.parse({}));
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
