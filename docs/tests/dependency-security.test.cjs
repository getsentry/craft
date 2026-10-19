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

for (const headers of [
  { 'set-cookie': 'session=private', 'cache-control': 'max-age=60' },
  { 'cache-control': 'no-cache, max-age=60' },
  { 'cache-control': 'proxy-revalidate, max-age=60' },
  { 'cache-control': 'private, max-age=60' },
  { 'cache-control': 'no-store, max-age=60' },
  { vary: '*', 'cache-control': 'max-age=60' },
  { vary: ' * ', 'cache-control': 'max-age=60' },
  { vary: 'accept, *', 'cache-control': 'max-age=60' },
]) {
  test(`all stale paths respect reuse restrictions for ${JSON.stringify(headers)}`, () => {
    const cache = policy({
      ...headers,
      'cache-control': headers['cache-control'] + ', stale-if-error=600, stale-while-revalidate=600',
    });
    // Astro uses TTL directly without calling evaluateRequest().
    assert.equal(cache.timeToLive(), 0);
    assert.equal(cache.useStaleWhileRevalidate(), false);
    const result = cache.revalidatedPolicy(request, { status: 503, headers: {} });
    assert.equal(result.modified, true);
    assert.notEqual(result.policy, cache);
  });
}

test('retains stale fallback for ordinary public responses', () => {
  const cache = policy({ 'cache-control': 'public, max-age=0, stale-if-error=60, stale-while-revalidate=60' });
  assert.equal(cache.timeToLive(), 58000);
  assert.equal(cache.useStaleWhileRevalidate(), true);
  const result = cache.revalidatedPolicy(request, { status: 503, headers: {} });
  assert.equal(result.modified, false);
  assert.equal(result.policy, cache);
});

test('must-revalidate keeps the fresh lifetime without stale extensions', () => {
  const cache = policy({ 'cache-control': 'public, max-age=60, must-revalidate, stale-if-error=600, stale-while-revalidate=600' });
  assert.equal(cache.timeToLive(), 58000);
  cache.now = () => cache._responseTime + 61000;
  assert.equal(cache.timeToLive(), 0);
  assert.equal(cache.useStaleWhileRevalidate(), false);
  assert.equal(cache.revalidatedPolicy(request, { status: 503, headers: {} }).modified, true);
});

test('Astro remote images do not retain cookie responses via stale TTL extensions', async () => {
  const { dirname, join } = require('node:path');
  const { pathToFileURL } = require('node:url');
  const remote = pathToFileURL(join(dirname(require.resolve('astro/package.json')), 'dist/assets/build/remote.js'));
  const { loadRemoteImage } = await import(remote.href);
  const image = await loadRemoteImage('https://example.com/image.png', async () => new Response('image fixture', {
    headers: { 'set-cookie': 'session=fixture', 'cache-control': 'max-age=60, stale-if-error=600' },
  }));
  assert.ok(image.expires <= Date.now());
});

test('retains ordinary shared/private freshness precedence', () => {
  for (const [headers, shared, expected] of [
    [{ 'cache-control': 'public, max-age=60, s-maxage=40' }, true, 38000],
    [{ 'cache-control': 'public, max-age=60, s-maxage=40' }, false, 58000],
    [{ 'cache-control': 'proxy-revalidate, max-age=60' }, false, 58000],
    [{ date: 'Tue, 01 Jan 2030 00:00:00 GMT', expires: 'Tue, 01 Jan 2030 00:01:00 GMT' }, true, 58000],
  ]) {
    assert.equal(policy(headers, shared).timeToLive(), expected);
  }
});

for (const [name, next] of [
  ['URL', { url: 'https://example.com/other', headers: { host: 'example.com', cookie: 'user=a' } }],
  ['Vary cookie', { url: 'https://example.com/font', headers: { host: 'example.com', cookie: 'user=b' } }],
  ['method', { url: 'https://example.com/font', method: 'POST', headers: { host: 'example.com', cookie: 'user=a' } }],
  ['host', { url: 'https://example.com/font', headers: { host: 'other.example.com', cookie: 'user=a' } }],
]) {
  test(`stale-if-error never reuses a mismatched ${name}`, () => {
    const cache = new CachePolicy({ ...request, headers: { ...request.headers, cookie: 'user=a' } }, {
      status: 200, headers: { vary: 'cookie', 'cache-control': 'public, max-age=0, stale-if-error=60' },
    });
    cache.now = () => cache._responseTime + 2000;
    const result = cache.revalidatedPolicy(next, { status: 503, headers: {} });
    assert.equal(result.modified, true);
    assert.notEqual(result.policy, cache);
  });
}

test('stale-if-error retains matching Vary variants and valid HEAD reuse', () => {
  const same = { ...request, headers: { ...request.headers, cookie: 'user=a' } };
  const cache = new CachePolicy(same, {
    status: 200, headers: { vary: 'cookie', 'cache-control': 'public, max-age=0, stale-if-error=60' },
  });
  cache.now = () => cache._responseTime + 2000;
  for (const method of ['GET', 'HEAD']) {
    assert.equal(cache.revalidatedPolicy({ ...same, method }, { status: 503, headers: {} }).policy, cache);
  }
});
