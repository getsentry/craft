// Opt-in live check; ordinary unit tests never require credentials or inference.
import { expect, test, vi } from 'vitest';
import { AiSummaryConfigSchema } from '../schemas/project_config';
import { createSummaryProvider } from '../utils/ai-provider';

test.skipIf(process.env.CRAFT_TEST_LIVE_AI !== 'true')(
  'the workflow token and default model return a valid changelog digest',
  async () => {
    const originalFetch = globalThis.fetch;
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, options) => {
        const response = await originalFetch(input, options);
        if (!response.ok) {
          const token = process.env.GITHUB_TOKEN || '';
          const body = await response.clone().text();
          console.error(
            'Live Copilot rejection:',
            response.status,
            (token ? body.split(token).join('[redacted]') : body).slice(
              0,
              2000,
            ),
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
