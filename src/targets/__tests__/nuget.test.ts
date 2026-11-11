import { vi, type MockInstance } from 'vitest';
import { resolve } from 'path';
import { NugetTarget, NUGET_TOKEN_SERVICE_URL } from '../nuget';
import * as dotnetWorkspaces from '../../utils/dotnetWorkspaces';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { RemoteArtifact } from '../../artifact_providers/base';
import { spawnProcess } from '../../utils/system';
import { ConfigurationError } from '../../utils/errors';
import {
  getRemotePackageState,
  isSymbolPackagePublished,
} from '../../utils/nugetRegistry';

vi.mock('../../utils/system');
vi.mock('../../utils/nugetRegistry');

describe('NugetTarget.expand', () => {
  let discoverDotnetPackagesMock: MockInstance;

  afterEach(() => {
    discoverDotnetPackagesMock?.mockRestore();
  });

  it('returns config as-is when workspaces is not enabled', async () => {
    const config = { name: 'nuget', id: 'Sentry.Core' };
    const result = await NugetTarget.expand(config, '/root');

    expect(result).toEqual([config]);
  });

  it('throws when no packages are found', async () => {
    discoverDotnetPackagesMock = vi
      .spyOn(dotnetWorkspaces, 'discoverDotnetPackages')
      .mockResolvedValue(null);

    const config = { name: 'nuget', workspaces: true };

    await expect(NugetTarget.expand(config, '/root')).rejects.toThrow(
      ConfigurationError,
    );
  });

  it('throws when filters exclude every package', async () => {
    discoverDotnetPackagesMock = vi
      .spyOn(dotnetWorkspaces, 'discoverDotnetPackages')
      .mockResolvedValue({
        solutionPath: '/root/Sentry.slnx',
        packages: [
          {
            packageId: 'Sentry',
            projectPath: '/root/src/Sentry/Sentry.csproj',
            isPackable: true,
            projectDependencies: [],
          },
        ],
      });

    const config = {
      name: 'nuget',
      workspaces: true,
      includeWorkspaces: '/^Other/',
    };

    await expect(NugetTarget.expand(config, '/root')).rejects.toThrow(
      /no packages are left/,
    );
  });

  it('expands to individual targets for each package', async () => {
    discoverDotnetPackagesMock = vi
      .spyOn(dotnetWorkspaces, 'discoverDotnetPackages')
      .mockResolvedValue({
        solutionPath: '/root/Sentry.sln',
        packages: [
          {
            packageId: 'Sentry.Core',
            projectPath: '/root/src/Sentry.Core/Sentry.Core.csproj',
            isPackable: true,
            projectDependencies: [],
          },
          {
            packageId: 'Sentry.AspNetCore',
            projectPath: '/root/src/Sentry.AspNetCore/Sentry.AspNetCore.csproj',
            isPackable: true,
            projectDependencies: ['Sentry.Core'],
          },
        ],
      });

    const config = { name: 'nuget', workspaces: true };
    const result = await NugetTarget.expand(config, '/root');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('Sentry.Core');
    expect(result[0].includeNames).toBe('/^Sentry\\.Core\\.\\d.*\\.s?nupkg$/');
    expect(result[1].id).toBe('Sentry.AspNetCore');
    expect(result[1].includeNames).toBe(
      '/^Sentry\\.AspNetCore\\.\\d.*\\.s?nupkg$/',
    );
  });

  it('filters packages by includeWorkspaces pattern', async () => {
    discoverDotnetPackagesMock = vi
      .spyOn(dotnetWorkspaces, 'discoverDotnetPackages')
      .mockResolvedValue({
        solutionPath: '/root/Sentry.sln',
        packages: [
          {
            packageId: 'Sentry.Core',
            projectPath: '/root/src/Sentry.Core/Sentry.Core.csproj',
            isPackable: true,
            projectDependencies: [],
          },
          {
            packageId: 'Sentry.AspNetCore',
            projectPath: '/root/src/Sentry.AspNetCore/Sentry.AspNetCore.csproj',
            isPackable: true,
            projectDependencies: [],
          },
          {
            packageId: 'Other.Package',
            projectPath: '/root/src/Other/Other.Package.csproj',
            isPackable: true,
            projectDependencies: [],
          },
        ],
      });

    const config = {
      name: 'nuget',
      workspaces: true,
      includeWorkspaces: '/^Sentry\\./',
    };
    const result = await NugetTarget.expand(config, '/root');

    expect(result).toHaveLength(2);
    expect(result.map(r => r.id)).toEqual(['Sentry.Core', 'Sentry.AspNetCore']);
  });

  it('filters packages by excludeWorkspaces pattern', async () => {
    discoverDotnetPackagesMock = vi
      .spyOn(dotnetWorkspaces, 'discoverDotnetPackages')
      .mockResolvedValue({
        solutionPath: '/root/Sentry.sln',
        packages: [
          {
            packageId: 'Sentry.Core',
            projectPath: '/root/src/Sentry.Core/Sentry.Core.csproj',
            isPackable: true,
            projectDependencies: [],
          },
          {
            packageId: 'Sentry.Tests',
            projectPath: '/root/test/Sentry.Tests/Sentry.Tests.csproj',
            isPackable: true,
            projectDependencies: [],
          },
        ],
      });

    const config = {
      name: 'nuget',
      workspaces: true,
      excludeWorkspaces: '/\\.Tests$/',
    };
    const result = await NugetTarget.expand(config, '/root');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('Sentry.Core');
  });

  it('propagates serverUrl and trustedPublishingUser to expanded targets', async () => {
    discoverDotnetPackagesMock = vi
      .spyOn(dotnetWorkspaces, 'discoverDotnetPackages')
      .mockResolvedValue({
        solutionPath: '/root/Sentry.sln',
        packages: [
          {
            packageId: 'Sentry.Core',
            projectPath: '/root/src/Sentry.Core/Sentry.Core.csproj',
            isPackable: true,
            projectDependencies: [],
          },
        ],
      });

    const config = {
      name: 'nuget',
      workspaces: true,
      serverUrl: 'https://custom.nuget.server/v3/index.json',
      trustedPublishingUser: 'sentry-bot',
    };
    const result = await NugetTarget.expand(config, '/root');

    expect(result).toHaveLength(1);
    expect(result[0].serverUrl).toBe(
      'https://custom.nuget.server/v3/index.json',
    );
    expect(result[0].trustedPublishingUser).toBe('sentry-bot');
  });

  it('sorts packages topologically by dependencies', async () => {
    discoverDotnetPackagesMock = vi
      .spyOn(dotnetWorkspaces, 'discoverDotnetPackages')
      .mockResolvedValue({
        solutionPath: '/root/Sentry.sln',
        packages: [
          {
            packageId: 'Sentry.AspNetCore',
            projectPath: '/root/src/Sentry.AspNetCore/Sentry.AspNetCore.csproj',
            isPackable: true,
            projectDependencies: ['Sentry.Extensions.Logging'],
          },
          {
            packageId: 'Sentry',
            projectPath: '/root/src/Sentry/Sentry.csproj',
            isPackable: true,
            projectDependencies: [],
          },
          {
            packageId: 'Sentry.Extensions.Logging',
            projectPath:
              '/root/src/Sentry.Extensions.Logging/Sentry.Extensions.Logging.csproj',
            isPackable: true,
            projectDependencies: ['Sentry'],
          },
        ],
      });

    const config = { name: 'nuget', workspaces: true };
    const result = await NugetTarget.expand(config, '/root');

    expect(result).toHaveLength(3);
    // Order should be: Sentry -> Extensions.Logging -> AspNetCore
    expect(result.map(r => r.id)).toEqual([
      'Sentry',
      'Sentry.Extensions.Logging',
      'Sentry.AspNetCore',
    ]);
  });

  it('passes solutionPath to discoverDotnetPackages', async () => {
    discoverDotnetPackagesMock = vi
      .spyOn(dotnetWorkspaces, 'discoverDotnetPackages')
      .mockResolvedValue({
        solutionPath: '/root/src/Sentry.sln',
        packages: [
          {
            packageId: 'Sentry',
            projectPath: '/root/src/Sentry/Sentry.csproj',
            isPackable: true,
            projectDependencies: [],
          },
        ],
      });

    const config = {
      name: 'nuget',
      workspaces: true,
      solutionPath: 'src/Sentry.sln',
    };
    await NugetTarget.expand(config, '/root');

    expect(discoverDotnetPackagesMock).toHaveBeenCalledWith(
      '/root',
      'src/Sentry.sln',
    );
  });

  describe('with a selected release workspace', () => {
    // Mirrors getsentry/sentry-dotnet: one Sentry.slnx at the repository root
    // lists src/Sentry, src/Sentry.Maui, samples, and tests.
    const rootDir = resolve(
      __dirname,
      '../../utils/__fixtures__/dotnet-workspaces/msbuild-solution',
    );
    const config = {
      name: 'nuget',
      workspaces: true,
      solutionPath: 'Sentry.slnx',
    };

    it('keeps solutionPath at the repository root and only expands workspace projects', async () => {
      discoverDotnetPackagesMock = vi.spyOn(
        dotnetWorkspaces,
        'discoverDotnetPackages',
      );

      const result = await NugetTarget.expand(
        config,
        rootDir,
        resolve(rootDir, 'src/Sentry.Maui'),
      );

      expect(discoverDotnetPackagesMock).toHaveBeenCalledWith(
        rootDir,
        'Sentry.slnx',
      );
      expect(result.map(r => r.id)).toEqual(['Sentry.Maui']);
    });

    it('does not match sibling projects that share a path prefix', async () => {
      const result = await NugetTarget.expand(
        config,
        rootDir,
        resolve(rootDir, 'src/Sentry'),
      );

      expect(result.map(r => r.id)).toEqual(['Sentry']);
    });

    it('expands every project when the workspace is the repository root', async () => {
      const all = await NugetTarget.expand(config, rootDir);
      const scoped = await NugetTarget.expand(config, rootDir, rootDir);

      expect(scoped).toEqual(all);
      expect(all.length).toBeGreaterThan(1);
    });

    it('throws when no packable project is inside the workspace', async () => {
      await expect(
        NugetTarget.expand(config, rootDir, resolve(rootDir, 'test')),
      ).rejects.toThrow(/inside the selected workspace "test"/);
    });
  });
});

describe('NugetTarget.publish', () => {
  const oldEnv = process.env;
  const identity = { id: 'Sentry', version: '1.0.0' };

  beforeEach(() => {
    process.env = { ...oldEnv, NUGET_API_TOKEN: 'test-token' };
    vi.mocked(spawnProcess).mockReset();
    vi.mocked(getRemotePackageState)
      .mockReset()
      .mockResolvedValue({ status: 'missing' });
    vi.mocked(isSymbolPackagePublished).mockReset();
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  function setup(filenames = ['Sentry.1.0.0.nupkg', 'Sentry.1.0.0.snupkg']): {
    target: NugetTarget;
    downloadArtifact: MockInstance;
  } {
    const artifactProvider = new NoneArtifactProvider();
    const target = new NugetTarget(
      {
        name: 'nuget',
        // As generated by workspace expansion: matches .nupkg and .snupkg
        includeNames: '/^Sentry\\.\\d.*\\.s?nupkg$/',
      },
      artifactProvider,
    );
    const artifacts = filenames.map(filename => ({
      filename,
    })) as RemoteArtifact[];
    vi.spyOn(artifactProvider, 'filterArtifactsForRevision').mockImplementation(
      async (_revision, filterOptions) =>
        artifacts.filter(a => filterOptions?.includeNames?.test(a.filename)),
    );
    const downloadArtifact = vi
      .spyOn(artifactProvider, 'downloadArtifact')
      .mockImplementation(async (a: RemoteArtifact) => `/tmp/${a.filename}`);
    return { target, downloadArtifact };
  }

  function pushedPaths(): unknown[] {
    return vi
      .mocked(spawnProcess)
      .mock.calls.filter(([, args]) => args?.[1] === 'push')
      .map(([, args]) => args?.[2]);
  }

  it('pushes a new .nupkg with its .snupkg next to it', async () => {
    const { target, downloadArtifact } = setup();

    await target.publish('1.0.0', 'abc123');

    // The .snupkg is picked up by `dotnet nuget push` from next to the .nupkg
    expect(pushedPaths()).toEqual(['/tmp/Sentry.1.0.0.nupkg']);
    expect(downloadArtifact).toHaveBeenCalledTimes(2);
    expect(getRemotePackageState).toHaveBeenCalledWith(
      'https://api.nuget.org/v3/index.json',
      '/tmp/Sentry.1.0.0.nupkg',
    );
    expect(isSymbolPackagePublished).not.toHaveBeenCalled();
  });

  it('pushes the .nupkg when the server state is unknown', async () => {
    vi.mocked(getRemotePackageState).mockResolvedValue({
      status: 'unknown',
      reason: 'HTTP 503',
    });
    const { target } = setup();

    await target.publish('1.0.0', 'abc123');

    expect(pushedPaths()).toEqual(['/tmp/Sentry.1.0.0.nupkg']);
  });

  it('skips packages that are already published with both files', async () => {
    vi.mocked(getRemotePackageState).mockResolvedValue({
      status: 'identical',
      identity,
    });
    vi.mocked(isSymbolPackagePublished).mockResolvedValue(true);
    const { target } = setup();

    await target.publish('1.0.0', 'abc123');

    expect(pushedPaths()).toEqual([]);
    expect(isSymbolPackagePublished).toHaveBeenCalledWith(
      'https://api.nuget.org/v3/index.json',
      identity,
    );
  });

  it('skips an identical package that has no symbol package', async () => {
    vi.mocked(getRemotePackageState).mockResolvedValue({
      status: 'identical',
      identity,
    });
    const { target } = setup(['Sentry.1.0.0.nupkg']);

    await target.publish('1.0.0', 'abc123');

    expect(pushedPaths()).toEqual([]);
    expect(isSymbolPackagePublished).not.toHaveBeenCalled();
  });

  it('pushes only the missing .snupkg when the .nupkg is already published', async () => {
    vi.mocked(getRemotePackageState).mockResolvedValue({
      status: 'identical',
      identity,
    });
    vi.mocked(isSymbolPackagePublished).mockResolvedValue(false);
    const { target } = setup();

    await target.publish('1.0.0', 'abc123');

    expect(pushedPaths()).toEqual(['/tmp/Sentry.1.0.0.snupkg']);
  });

  it('pushes the .snupkg when its state is unknown', async () => {
    vi.mocked(getRemotePackageState).mockResolvedValue({
      status: 'identical',
      identity,
    });
    vi.mocked(isSymbolPackagePublished).mockResolvedValue(undefined);
    const { target } = setup();

    await target.publish('1.0.0', 'abc123');

    expect(pushedPaths()).toEqual(['/tmp/Sentry.1.0.0.snupkg']);
  });

  it('fails when a different package is published under the same version', async () => {
    vi.mocked(getRemotePackageState).mockResolvedValue({
      status: 'different',
      differences: ['lib/net8.0/Sentry.dll'],
    });
    const { target } = setup();

    await expect(target.publish('1.0.0', 'abc123')).rejects.toThrow(
      /already published .* with different contents \(differs in: lib\/net8\.0\/Sentry\.dll\)/,
    );
    expect(pushedPaths()).toEqual([]);
  });

  it('explains duplicate rejections from the server', async () => {
    vi.mocked(spawnProcess).mockImplementation(async (_cmd, args) => {
      if (args?.[1] === 'push') {
        throw new Error(
          'Response status code does not indicate success: 409 (Conflict - The feed already contains Sentry 1.0.0)',
        );
      }
      return Buffer.from('');
    });
    const { target } = setup();

    await expect(target.publish('1.0.0', 'abc123')).rejects.toThrow(
      /may still be validating/,
    );
  });

  it('passes other push errors through unchanged', async () => {
    const error = new Error('network down');
    vi.mocked(spawnProcess).mockImplementation(async (_cmd, args) => {
      if (args?.[1] === 'push') {
        throw error;
      }
      return Buffer.from('');
    });
    const { target } = setup();

    await expect(target.publish('1.0.0', 'abc123')).rejects.toBe(error);
  });
});

describe('NugetTarget authentication', () => {
  const oldEnv = process.env;
  const OIDC_REQUEST_URL =
    'https://token.actions.example/token?api-version=2.0';
  let fetchMock: MockInstance;

  beforeEach(() => {
    process.env = { ...oldEnv };
    delete process.env.NUGET_API_TOKEN;
    delete process.env.NUGET_USER;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    delete process.env.GITHUB_ACTIONS;
    vi.mocked(spawnProcess).mockReset();
    vi.mocked(getRemotePackageState)
      .mockReset()
      .mockResolvedValue({ status: 'missing' });
    fetchMock = vi.fn(async (url: string | URL) =>
      String(url).startsWith('https://token.actions.example/')
        ? Response.json({ value: 'github-oidc-token' })
        : Response.json({ apiKey: 'temporary-api-key' }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  function enableTrustedPublishing(): void {
    process.env.NUGET_USER = 'sentry-bot';
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = OIDC_REQUEST_URL;
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'actions-request-token';
  }

  function createTarget(
    filenames = ['Sentry.1.0.0.nupkg'],
    config: Record<string, unknown> = {},
  ): NugetTarget {
    const artifactProvider = new NoneArtifactProvider();
    const target = new NugetTarget(
      { name: 'nuget', ...config },
      artifactProvider,
    );
    const artifacts = filenames.map(filename => ({
      filename,
    })) as RemoteArtifact[];
    vi.spyOn(artifactProvider, 'filterArtifactsForRevision').mockImplementation(
      async (_revision, filterOptions) =>
        artifacts.filter(a => filterOptions?.includeNames?.test(a.filename)),
    );
    vi.spyOn(artifactProvider, 'downloadArtifact').mockImplementation(
      async (a: RemoteArtifact) => `/tmp/${a.filename}`,
    );
    return target;
  }

  function pushes(): { args: string[]; apiKey: unknown }[] {
    return vi
      .mocked(spawnProcess)
      .mock.calls.filter(([, args]) => args?.[1] === 'push')
      .map(([, args, options]) => ({
        args: args ?? [],
        apiKey: options?.env?.NUGET_API_KEY,
      }));
  }

  function exchanges(): Request[] {
    return fetchMock.mock.calls
      .filter(([url]) => String(url) === NUGET_TOKEN_SERVICE_URL)
      .map(([url, init]) => new Request(url, init));
  }

  it('fails without any credentials', () => {
    expect(() => createTarget()).toThrow(/NUGET_USER .* or NUGET_API_TOKEN/);
  });

  it('pushes with NUGET_API_TOKEN without putting it on the logged command line', async () => {
    process.env.NUGET_API_TOKEN = 'long-lived-token';
    const target = createTarget();

    await target.publish('1.0.0', 'abc123');

    expect(pushes()).toEqual([
      {
        args: expect.arrayContaining(['--api-key', '${NUGET_API_KEY}']),
        apiKey: 'long-lived-token',
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires GitHub Actions OIDC when NUGET_USER is set', () => {
    process.env.NUGET_USER = 'sentry-bot';
    process.env.NUGET_API_TOKEN = 'long-lived-token';

    expect(() => createTarget()).toThrow(/OIDC is not available/);
  });

  it('refuses trusted publishing to a feed other than nuget.org', () => {
    enableTrustedPublishing();

    expect(() =>
      createTarget(undefined, {
        serverUrl: 'https://nuget.example/v3/index.json',
      }),
    ).toThrow(/only works with https:\/\/api\.nuget\.org/);
  });

  it('pushes with a temporary key from trusted publishing, even if NUGET_API_TOKEN is set', async () => {
    enableTrustedPublishing();
    process.env.NUGET_API_TOKEN = 'long-lived-token';
    const target = createTarget();

    await target.publish('1.0.0', 'abc123');

    const [oidcUrl, oidcInit] = fetchMock.mock.calls[0];
    expect(new URL(oidcUrl).searchParams.get('audience')).toBe(
      'https://www.nuget.org',
    );
    expect(oidcInit.headers).toMatchObject({
      Authorization: 'Bearer actions-request-token',
    });

    const [exchange] = exchanges();
    expect(exchange.method).toBe('POST');
    expect(exchange.headers.get('Authorization')).toBe(
      'Bearer github-oidc-token',
    );
    expect(await exchange.json()).toEqual({
      username: 'sentry-bot',
      tokenType: 'ApiKey',
    });

    expect(pushes().map(p => p.apiKey)).toEqual(['temporary-api-key']);
  });

  it('enables trusted publishing from the target config', async () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = OIDC_REQUEST_URL;
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'actions-request-token';
    process.env.NUGET_USER = 'env-user';
    const target = createTarget(undefined, {
      trustedPublishingUser: 'config-user',
    });

    await target.publish('1.0.0', 'abc123');

    const [exchange] = exchanges();
    expect(await exchange.json()).toMatchObject({ username: 'config-user' });
    expect(pushes().map(p => p.apiKey)).toEqual(['temporary-api-key']);
  });

  it('shares one temporary key between the packages of a target', async () => {
    enableTrustedPublishing();
    const target = createTarget([
      'Sentry.1.0.0.nupkg',
      'Sentry.Maui.1.0.0.nupkg',
    ]);

    await target.publish('1.0.0', 'abc123');

    expect(pushes()).toHaveLength(2);
    expect(exchanges()).toHaveLength(1);
  });

  it('gets a new temporary key before the old one expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    enableTrustedPublishing();
    const target = createTarget();

    await target.publish('1.0.0', 'abc123');
    vi.setSystemTime(Date.now() + 30 * 60 * 1000);
    await target.publish('1.0.0', 'abc123');
    expect(exchanges()).toHaveLength(1);

    vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    await target.publish('1.0.0', 'abc123');
    expect(exchanges()).toHaveLength(2);
  });

  it('masks the temporary key in GitHub Actions logs', async () => {
    enableTrustedPublishing();
    process.env.GITHUB_ACTIONS = 'true';
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const target = createTarget();

    let writes: unknown[][];
    try {
      await target.publish('1.0.0', 'abc123');
    } finally {
      writes = [...write.mock.calls];
      write.mockRestore();
    }

    expect(writes).toContainEqual(['::add-mask::temporary-api-key\n']);
  });

  it('explains a rejected token exchange', async () => {
    enableTrustedPublishing();
    fetchMock.mockImplementation(async (url: string | URL) =>
      String(url).startsWith('https://token.actions.example/')
        ? Response.json({ value: 'github-oidc-token' })
        : Response.json({ error: 'No matching trust policy' }, { status: 401 }),
    );
    const target = createTarget();

    await expect(target.publish('1.0.0', 'abc123')).rejects.toThrow(
      /HTTP 401: \{"error":"No matching trust policy"\}[\s\S]*user who created the policy/,
    );
    expect(pushes()).toEqual([]);
  });
});
