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
