import { vi, type MockInstance } from 'vitest';
import { NugetTarget } from '../nuget';
import * as dotnetWorkspaces from '../../utils/dotnetWorkspaces';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { RemoteArtifact } from '../../artifact_providers/base';
import { spawnProcess } from '../../utils/system';
import { ConfigurationError } from '../../utils/errors';

vi.mock('../../utils/system');

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
});

describe('NugetTarget.publish', () => {
  const oldEnv = process.env;

  beforeEach(() => {
    process.env = { ...oldEnv, NUGET_API_TOKEN: 'test-token' };
    vi.mocked(spawnProcess).mockReset();
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  it('never pushes .snupkg files on their own', async () => {
    const artifactProvider = new NoneArtifactProvider();
    const target = new NugetTarget(
      {
        name: 'nuget',
        // As generated by workspace expansion: matches .nupkg and .snupkg
        includeNames: '/^Sentry\\.\\d.*\\.s?nupkg$/',
      },
      artifactProvider,
    );
    const artifacts = [
      { filename: 'Sentry.1.0.0.nupkg' },
      { filename: 'Sentry.1.0.0.snupkg' },
    ] as RemoteArtifact[];
    vi.spyOn(artifactProvider, 'filterArtifactsForRevision').mockImplementation(
      async (_revision, filterOptions) =>
        artifacts.filter(a => filterOptions?.includeNames?.test(a.filename)),
    );
    const downloadArtifact = vi
      .spyOn(artifactProvider, 'downloadArtifact')
      .mockImplementation(async (a: RemoteArtifact) => `/tmp/${a.filename}`);

    await target.publish('1.0.0', 'abc123');

    const pushedPaths = vi
      .mocked(spawnProcess)
      .mock.calls.filter(([, args]) => args?.[1] === 'push')
      .map(([, args]) => args?.[2]);
    expect(pushedPaths).toEqual(['/tmp/Sentry.1.0.0.nupkg']);
    // The symbol package is still downloaded next to the .nupkg
    expect(downloadArtifact).toHaveBeenCalledTimes(2);
  });
});
