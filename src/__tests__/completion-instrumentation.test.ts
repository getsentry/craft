import { afterEach, expect, test, vi } from 'vitest';
import { init, getCurrentScope } from '@sentry/node';
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  getCurrentScope: vi.fn(() => ({ setTag: vi.fn(), setExtra: vi.fn() })),
  close: vi.fn(),
}));
vi.mock('../utils/version', () => ({ getPackageVersion: () => '9.1.0' }));
const argv = process.argv;
afterEach(() => {
  process.argv = argv;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});
test('internal completion queries do not initialize release telemetry', async () => {
  process.argv = [
    'node',
    'craft',
    '--get-yargs-completions',
    'craft',
    'setup',
    '--sh',
  ];
  vi.spyOn(process, 'on').mockReturnValue(process);
  await import('../instrument');
  expect(init).not.toHaveBeenCalled();
  expect(getCurrentScope).not.toHaveBeenCalled();
});
test('ordinary command instrumentation is retained', async () => {
  process.argv = ['node', 'craft', 'prepare', '9.1.0'];
  vi.spyOn(process, 'on').mockReturnValue(process);
  await import('../instrument');
  expect(init).toHaveBeenCalledOnce();
  expect(getCurrentScope).toHaveBeenCalledOnce();
});

test('v11 retains transaction scrubbing and restrictive data collection', async () => {
  process.argv = ['node', 'craft', 'prepare', '9.1.0'];
  vi.spyOn(process, 'on').mockReturnValue(process);
  await import('../instrument');
  expect(init).toHaveBeenCalledWith(
    expect.objectContaining({
      traceLifecycle: 'static',
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: {
          request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
          response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
        },
        httpBodies: [],
        urlQueryParams: {
          deny: ['forwarded', '-ip', 'remote-', 'via', '-user'],
        },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        queues: false,
        graphQL: { document: false, variables: false },
        frameContextLines: 7,
      },
    }),
  );
  const options = vi.mocked(init).mock.calls[0][0];
  const event = { type: 'transaction' as const, server_name: 'private-host' };
  expect(options?.beforeSendTransaction?.(event, {})).toEqual({
    type: 'transaction',
    server_name: undefined,
  });
});
