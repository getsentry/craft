import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { vi } from 'vitest';

import {
  DEFAULT_REGISTRY_URL,
  GITHUB_TOKEN_ENV_VAR,
  McpRegistryTarget,
} from '../mcpRegistry';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { getConfigFileDir } from '../../config';
import { sleep } from '../../utils/async';
import { ConfigurationError } from '../../utils/errors';
import { isDryRun } from '../../utils/helpers';

vi.mock('../../config', () => ({ getConfigFileDir: vi.fn() }));
vi.mock('../../utils/helpers');
vi.mock('../../utils/async', () => ({ sleep: vi.fn(async () => undefined) }));

const VERSION = '1.2.3';
const SERVER_NAME = 'io.github.getsentry/sentry-mcp';
const NPM_PACKAGE = '@sentry/mcp-server';
const LISTING_URL = `${DEFAULT_REGISTRY_URL}/v0.1/servers/io.github.getsentry%2Fsentry-mcp/versions/${VERSION}`;
const OIDC_ORIGIN = 'https://token.actions.example';
const OIDC_REQUEST_URL = `${OIDC_ORIGIN}/token?api-version=2.0`;

const MANIFEST = {
  $schema:
    'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
  name: SERVER_NAME,
  description: 'MCP server for Sentry',
  version: '0.0.0',
  packages: [
    {
      registryType: 'npm',
      identifier: NPM_PACKAGE,
      version: '0.0.0',
      transport: { type: 'stdio' },
    },
  ],
};

/** The manifest as the registry should see it for VERSION */
const EXPECTED_SERVER = {
  ...MANIFEST,
  version: VERSION,
  packages: [{ ...MANIFEST.packages[0], version: VERSION }],
};

function listing(server: Record<string, unknown> = EXPECTED_SERVER) {
  return {
    // The registry may omit $schema; it is not compared.
    server: { ...server, $schema: undefined },
    _meta: {
      'io.modelcontextprotocol.registry/official': { status: 'active' },
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Route = Response | (() => Response);

/**
 * Stubs fetch with a `METHOD url` → response map. A list of responses is
 * served in order, one per call. Requests to the GitHub OIDC endpoint use the
 * `GET oidc` route. Unknown requests fail the test.
 */
function mockFetch(routes: Record<string, Route | Route[]>) {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const key =
      new URL(url).origin === OIDC_ORIGIN
        ? 'GET oidc'
        : `${init?.method ?? 'GET'} ${url}`;
    const route = routes[key];
    const next = Array.isArray(route) ? route.shift() : route;
    if (!next) {
      throw new Error(`Unexpected request: ${key}`);
    }
    return typeof next === 'function' ? next() : next;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requests(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.map(([input, init]) => ({
    key: `${init?.method ?? 'GET'} ${String(input)}`,
    url: new URL(String(input)),
    init,
  }));
}

function findRequest(fetchMock: ReturnType<typeof mockFetch>, key: string) {
  return requests(fetchMock).find(request => request.key === key);
}

let rootDir: string;

function writeManifest(manifest: unknown, name = 'server.json'): void {
  writeFileSync(join(rootDir, name), JSON.stringify(manifest));
}

function createTarget(config: Record<string, unknown> = {}) {
  return new McpRegistryTarget(
    { name: 'mcp-registry', ...config },
    new NoneArtifactProvider(),
    { owner: 'getsentry', repo: 'toolkit' },
  );
}

/** Routes for a version that is not listed yet and publishes successfully */
function publishRoutes(): Record<string, Route | Route[]> {
  return {
    [`GET ${LISTING_URL}`]: [json({}, 404), json(listing())],
    [`POST ${DEFAULT_REGISTRY_URL}/v0/publish`]: json(
      { server: EXPECTED_SERVER },
      201,
    ),
  };
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'craft-mcp-registry-'));
  writeManifest(MANIFEST);
  vi.mocked(getConfigFileDir).mockReturnValue(rootDir);
  vi.mocked(isDryRun).mockReturnValue(false);
  vi.mocked(sleep).mockClear();
  delete process.env[GITHUB_TOKEN_ENV_VAR];
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = OIDC_REQUEST_URL;
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'actions-request-token';
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(rootDir, { recursive: true, force: true });
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  delete process.env[GITHUB_TOKEN_ENV_VAR];
});

describe('config', () => {
  test('defaults to server.json in the repository root and the official registry', () => {
    const target = createTarget();
    expect(target.mcpRegistryConfig).toEqual({
      manifestPath: join(rootDir, 'server.json'),
      registryUrl: DEFAULT_REGISTRY_URL,
    });
  });

  test('accepts a manifest path and registry URL', () => {
    const target = createTarget({
      manifest: 'packages/mcp/server.json',
      registryUrl: 'https://registry.example.com/',
    });
    expect(target.mcpRegistryConfig).toEqual({
      manifestPath: join(rootDir, 'packages/mcp/server.json'),
      registryUrl: 'https://registry.example.com',
    });
  });

  test('rejects an invalid registry URL', () => {
    expect(() => createTarget({ registryUrl: 'not a url' })).toThrow(
      ConfigurationError,
    );
    expect(() => createTarget({ registryUrl: 'ftp://example.com' })).toThrow(
      ConfigurationError,
    );
  });

  test('rejects a manifest without a name', async () => {
    writeManifest({ version: '0.0.0' });
    mockFetch({});
    await expect(createTarget().publish(VERSION, 'sha')).rejects.toThrow(
      /has no "name"/,
    );
  });
});

describe('publish', () => {
  test('publishes the manifest at the release version with GitHub OIDC', async () => {
    const fetchMock = mockFetch({
      ...publishRoutes(),
      'GET oidc': json({ value: 'github-oidc-token' }),
      [`POST ${DEFAULT_REGISTRY_URL}/v0/auth/github-oidc`]: json({
        registry_token: 'registry-token',
      }),
    });

    await createTarget().publish(VERSION, 'sha');

    // OIDC token is minted for the registry origin with the request token.
    const oidc = requests(fetchMock).find(
      request => request.url.origin === OIDC_ORIGIN,
    );
    expect(oidc?.url.searchParams.get('api-version')).toBe('2.0');
    expect(oidc?.url.searchParams.get('audience')).toBe(DEFAULT_REGISTRY_URL);
    expect(oidc?.init?.headers).toMatchObject({
      Authorization: 'Bearer actions-request-token',
    });

    const exchange = findRequest(
      fetchMock,
      `POST ${DEFAULT_REGISTRY_URL}/v0/auth/github-oidc`,
    );
    expect(JSON.parse(String(exchange?.init?.body))).toEqual({
      oidc_token: 'github-oidc-token',
    });

    const publish = findRequest(
      fetchMock,
      `POST ${DEFAULT_REGISTRY_URL}/v0/publish`,
    );
    expect(publish?.init?.headers).toMatchObject({
      Authorization: 'Bearer registry-token',
    });
    expect(JSON.parse(String(publish?.init?.body))).toEqual(EXPECTED_SERVER);

    // Order: existing listing, auth, publish, verification.
    expect(requests(fetchMock).map(request => request.key)).toEqual([
      `GET ${LISTING_URL}`,
      expect.stringMatching(new RegExp(`^GET ${OIDC_ORIGIN}/`)),
      `POST ${DEFAULT_REGISTRY_URL}/v0/auth/github-oidc`,
      `POST ${DEFAULT_REGISTRY_URL}/v0/publish`,
      `GET ${LISTING_URL}`,
    ]);
  });

  test('uses the custom registry origin as the OIDC audience', async () => {
    const registryUrl = 'https://registry.example.com';
    const listingUrl = `${registryUrl}/v0.1/servers/io.github.getsentry%2Fsentry-mcp/versions/${VERSION}`;
    const fetchMock = mockFetch({
      [`GET ${listingUrl}`]: [json({}, 404), json(listing())],
      'GET oidc': json({ value: 'github-oidc-token' }),
      [`POST ${registryUrl}/v0/auth/github-oidc`]: json({
        registry_token: 'registry-token',
      }),
      [`POST ${registryUrl}/v0/publish`]: json({}, 200),
    });

    await createTarget({ registryUrl: `${registryUrl}/` }).publish(
      VERSION,
      'sha',
    );

    const oidc = requests(fetchMock).find(
      request => request.url.origin === OIDC_ORIGIN,
    );
    expect(oidc?.url.searchParams.get('audience')).toBe(registryUrl);
  });

  test('falls back to MCP_GITHUB_TOKEN without OIDC', async () => {
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    process.env[GITHUB_TOKEN_ENV_VAR] = 'ghp_example';
    const fetchMock = mockFetch({
      ...publishRoutes(),
      [`POST ${DEFAULT_REGISTRY_URL}/v0/auth/github-at`]: json({
        registry_token: 'registry-token',
      }),
    });

    await createTarget().publish(VERSION, 'sha');

    const exchange = findRequest(
      fetchMock,
      `POST ${DEFAULT_REGISTRY_URL}/v0/auth/github-at`,
    );
    expect(JSON.parse(String(exchange?.init?.body))).toEqual({
      github_token: 'ghp_example',
    });
    expect(
      findRequest(fetchMock, `POST ${DEFAULT_REGISTRY_URL}/v0/publish`)?.init
        ?.headers,
    ).toMatchObject({ Authorization: 'Bearer registry-token' });
  });

  test('fails without OIDC or a token', async () => {
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    const fetchMock = mockFetch({
      [`GET ${LISTING_URL}`]: json({}, 404),
    });

    await expect(createTarget().publish(VERSION, 'sha')).rejects.toThrow(
      ConfigurationError,
    );
    expect(
      findRequest(fetchMock, `POST ${DEFAULT_REGISTRY_URL}/v0/publish`),
    ).toBeUndefined();
  });

  test('reports a failed token exchange', async () => {
    mockFetch({
      [`GET ${LISTING_URL}`]: json({}, 404),
      'GET oidc': json({ value: 'github-oidc-token' }),
      [`POST ${DEFAULT_REGISTRY_URL}/v0/auth/github-oidc`]: new Response(
        'invalid audience',
        { status: 401 },
      ),
    });

    await expect(createTarget().publish(VERSION, 'sha')).rejects.toThrow(
      /github-oidc token exchange failed: HTTP 401: invalid audience/,
    );
  });

  test('waits for the published listing to appear', async () => {
    mockFetch({
      ...publishRoutes(),
      [`GET ${LISTING_URL}`]: [json({}, 404), json({}, 404), json(listing())],
      'GET oidc': json({ value: 'github-oidc-token' }),
      [`POST ${DEFAULT_REGISTRY_URL}/v0/auth/github-oidc`]: json({
        registry_token: 'registry-token',
      }),
    });

    await createTarget().publish(VERSION, 'sha');

    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test('reports a rejected publish', async () => {
    mockFetch({
      [`GET ${LISTING_URL}`]: json({}, 404),
      'GET oidc': json({ value: 'github-oidc-token' }),
      [`POST ${DEFAULT_REGISTRY_URL}/v0/auth/github-oidc`]: json({
        registry_token: 'registry-token',
      }),
      // The registry checks npm packages itself and explains failures.
      [`POST ${DEFAULT_REGISTRY_URL}/v0/publish`]: new Response(
        "NPM package '@sentry/mcp-server' exists, but version '1.2.3' was not found",
        { status: 400 },
      ),
    });

    await expect(createTarget().publish(VERSION, 'sha')).rejects.toThrow(
      /publish failed: HTTP 400: NPM package '@sentry\/mcp-server' exists, but version '1\.2\.3' was not found/,
    );
  });

  test('fails when the published listing is not active', async () => {
    const inactive = listing();
    inactive._meta['io.modelcontextprotocol.registry/official'].status =
      'deprecated';
    mockFetch({
      ...publishRoutes(),
      [`GET ${LISTING_URL}`]: [json({}, 404), json(inactive)],
      'GET oidc': json({ value: 'github-oidc-token' }),
      [`POST ${DEFAULT_REGISTRY_URL}/v0/auth/github-oidc`]: json({
        registry_token: 'registry-token',
      }),
    });

    await expect(createTarget().publish(VERSION, 'sha')).rejects.toThrow(
      /status "deprecated", expected "active"/,
    );
  });
});

describe('existing listing', () => {
  test('skips publishing when the listed version matches', async () => {
    const fetchMock = mockFetch({
      [`GET ${LISTING_URL}`]: json(listing()),
    });

    await createTarget().publish(VERSION, 'sha');

    expect(requests(fetchMock).map(request => request.key)).toEqual([
      `GET ${LISTING_URL}`,
    ]);
  });

  test('fails when the listed version differs from the manifest', async () => {
    const fetchMock = mockFetch({
      [`GET ${LISTING_URL}`]: json(
        listing({ ...EXPECTED_SERVER, description: 'Something else' }),
      ),
    });

    await expect(createTarget().publish(VERSION, 'sha')).rejects.toThrow(
      /already lists io\.github\.getsentry\/sentry-mcp@1\.2\.3, but the listing differs/,
    );
    expect(requests(fetchMock)).toHaveLength(1);
  });

  test('fails on an unexpected registry lookup response', async () => {
    mockFetch({
      [`GET ${LISTING_URL}`]: json({}, 500),
    });

    await expect(createTarget().publish(VERSION, 'sha')).rejects.toThrow(
      /lookup for .* failed: HTTP 500/,
    );
  });
});

describe('dry run', () => {
  beforeEach(() => {
    vi.mocked(isDryRun).mockReturnValue(true);
  });

  test('checks the listing without authenticating or publishing', async () => {
    const fetchMock = mockFetch({
      [`GET ${LISTING_URL}`]: json({}, 404),
    });

    await createTarget().publish(VERSION, 'sha');

    expect(requests(fetchMock).map(request => request.key)).toEqual([
      `GET ${LISTING_URL}`,
    ]);
  });

  test('still reports a mismatched existing listing', async () => {
    mockFetch({
      [`GET ${LISTING_URL}`]: json(
        listing({ ...EXPECTED_SERVER, description: 'Something else' }),
      ),
    });

    await expect(createTarget().publish(VERSION, 'sha')).rejects.toThrow(
      /listing differs/,
    );
  });
});
