const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { test } = require('node:test');

// Exercise Astro's actual transitive dependency, not a separate test copy.
const astroRequire = createRequire(require.resolve('astro/package.json'));
const CachePolicy = astroRequire('http-cache-semantics');
const request = { url: 'https://example.com/font', headers: { host: 'example.com' } };

function policy(headers, shared = true) {
  const value = new CachePolicy(request, { status: 200, headers }, { shared });
  // Make expiry deterministic without timers or sleeps.
  value.now = () => value._responseTime + 2000;
  return value;
}

for (const directive of ['max-stale', 'max-stale=999999']) {
  for (const headers of [
    { 'set-cookie': 'session=private', 'cache-control': 'max-age=60' },
    { 'cache-control': 'proxy-revalidate, max-age=60' },
    { 'cache-control': 'no-cache, max-age=60' },
    { 'cache-control': 'private, max-age=60' },
    { 'cache-control': 'no-store, max-age=60' },
  ]) {
    test(`GHSA-ch52-4w7c-c8xp: ${directive} cannot reuse ${JSON.stringify(headers)}`, () => {
      const cache = policy(headers);
      const next = { ...request, headers: { ...request.headers, 'cache-control': directive } };
      assert.equal(cache.satisfiesWithoutRevalidation(next), false);
      assert.equal(cache.evaluateRequest(next).response, undefined);
    });
  }
}

test('permits max-stale for normally expired public responses, including max-age=0', () => {
  for (const age of [0, 1]) {
    const cache = policy({ 'cache-control': `public, max-age=${age}` });
    assert.equal(cache.satisfiesWithoutRevalidation({
      ...request, headers: { ...request.headers, 'cache-control': 'max-stale=60' },
    }), true);
  }
});

test('preserves explicitly public cookies and private-cache cookie reuse', () => {
  for (const [cc, shared] of [['public, max-age=60', true], ['max-age=60', false]]) {
    const cache = policy({ 'set-cookie': 'session=private', 'cache-control': cc }, shared);
    assert.equal(cache.satisfiesWithoutRevalidation(request), true);
  }
});

for (const headers of [
  { 'set-cookie': 'session=private', 'cache-control': 'max-age=0, stale-while-revalidate=60' },
  { 'cache-control': 'proxy-revalidate, max-age=0, stale-while-revalidate=60' },
  { 'cache-control': 'no-cache, stale-while-revalidate=60' },
]) {
  test(`stale-while-revalidate cannot bypass ${JSON.stringify(headers)}`, () => {
    const cache = CachePolicy.fromObject(policy(headers).toObject());
    cache.now = () => cache._responseTime + 2000;
    assert.equal(cache.evaluateRequest(request).response, undefined);
  });
}

test('preserves ordinary stale-while-revalidate for public responses', () => {
  const cache = policy({ 'cache-control': 'public, max-age=0, stale-while-revalidate=60' });
  const result = cache.evaluateRequest(request);
  assert.ok(result.response);
  assert.equal(result.revalidation.synchronous, false);
});
