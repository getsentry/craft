import { afterEach, expect, test, vi } from 'vitest';
import yargs from 'yargs';
import * as Sentry from '@sentry/node';
import { withTracing } from '../tracing';
vi.mock('@sentry/node', () => ({
  startSpan: vi.fn((_options, callback) => callback()),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

test('environment-backed AI credentials never enter trace attributes, while handlers receive their original arguments', () => {
  vi.stubEnv('CRAFT_PROVIDER_TOKEN', 'fixture-private-token');
  const argv = yargs([]).env('CRAFT').parseSync();
  expect(argv.providerToken).toBe('fixture-private-token');
  const handler = vi.fn(args => args.providerToken);
  expect(
    withTracing(handler, { name: 'craft.prepare', op: 'craft.prepare' })(argv),
  ).toBe('fixture-private-token');
  expect(handler).toHaveBeenCalledWith(argv);
  const options = vi.mocked(Sentry.startSpan).mock.calls[0][0];
  expect(options.name).toBe('craft.prepare');
  expect(JSON.stringify(options)).not.toContain('fixture-private-token');
  expect(options.attributes).toBeUndefined();
});
