import { parseCanonical } from '../../utils/canonical';

describe('parseCanonical', () => {
  test('parses valid cases properly', async () => {
    expect(parseCanonical('pypi:sentry-sdk')).toEqual(['pypi', 'sentry-sdk']);
    expect(parseCanonical('npm:@sentry/browser')).toEqual([
      'npm',
      '@sentry',
      'browser',
    ]);
    expect(parseCanonical('test-registry:a.1/b.2/c.3')).toEqual([
      'test-registry',
      'a.1',
      'b.2',
      'c.3',
    ]);
  });

  test('throws an error for invalid canonical names', async () => {
    function expectRaisesError(name: string): void {
      try {
        parseCanonical(name);
        throw new Error(`Should fail for canonical name: ${name}`);
      } catch (e) {
        expect(e.message).toMatch(/cannot parse/i);
      }
    }

    expectRaisesError('invalid');
    expectRaisesError('invalid:');
    expectRaisesError('a/b');
    expectRaisesError('registry:a/');
  });
});
