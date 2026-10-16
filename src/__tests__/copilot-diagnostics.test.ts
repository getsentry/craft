import { afterEach, expect, test, vi } from 'vitest';
import { describeCopilotRejection } from './helpers/copilot-diagnostics';

afterEach(() => vi.useRealTimers());

test('reports the rejection message and code without unrelated response fields', async () => {
  const result = await describeCopilotRejection(
    Response.json(
      {
        error: {
          code: 'policy_denied',
          message: 'Organization policy denied access.',
        },
        debug: 'private response data',
      },
      { status: 403 },
    ),
    'test-credential',
  );
  expect(result).toContain('policy_denied');
  expect(result).toContain('Organization policy denied access.');
  expect(result).not.toContain('private response data');
});

test('redacts credentials before truncating and escapes workflow log commands', async () => {
  const credential = 'custom-secret-without-github-prefix';
  const result = await describeCopilotRejection(
    Response.json(
      {
        message: `\n::warning::${credential} ghs_otherToken123 Bearer other-secret ${'x'.repeat(1900)}${credential}`,
      },
      { status: 403 },
    ),
    credential,
  );
  expect(result).toContain('[redacted]');
  expect(result).not.toContain(credential);
  expect(result).not.toContain('ghs_otherToken123');
  expect(result).not.toContain('other-secret');
  expect(result).not.toContain('\n');
  expect(result.length).toBeLessThanOrEqual(2100);
});

test('omits malformed responses rather than printing arbitrary server content', async () => {
  const result = await describeCopilotRejection(
    new Response('<html>private proxy response</html>', { status: 403 }),
    '',
  );
  expect(result).toContain('omitted');
  expect(result).not.toContain('private proxy response');
});

test('bounds response reads and cancels oversized streams without printing a partial secret', async () => {
  let cancelled = false;
  const result = await describeCopilotRejection(
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(
            new TextEncoder().encode('sensitive'.repeat(8192)),
          );
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 403 },
    ),
    'sensitive-sensitive',
  );
  expect(result).toContain('omitted');
  expect(result).not.toContain('sensitive');
  expect(cancelled).toBe(true);
});

test('times out stalled diagnostics without hiding the original HTTP status', async () => {
  vi.useFakeTimers();
  let cancelled = false;
  const result = describeCopilotRejection(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { status: 403 },
    ),
    '',
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toContain('403');
  expect(await result).toContain('omitted');
  expect(cancelled).toBe(true);
});

test('captures plain-text Copilot policy errors with credential redaction', async () => {
  const result = await describeCopilotRejection(
    new Response(
      'Organization policy denied access for Bearer test-credential',
      {
        status: 403,
      },
    ),
    'test-credential',
  );
  expect(result).toContain('Organization policy denied access');
  expect(result).not.toContain('test-credential');
  expect(result).toContain('[redacted]');
});
