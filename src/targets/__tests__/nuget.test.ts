import { vi, type MockInstance } from 'vitest';
import { resolve } from 'path';
import { NugetTarget } from '../nuget';
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

  it('propagates serverUrl to expanded targets', async () => {
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
    };
    const result = await NugetTarget.expand(config, '/root');

    expect(result).toHaveLength(1);
    expect(result[0].serverUrl).toBe(
      'https://custom.nuget.server/v3/index.json',
    );
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
