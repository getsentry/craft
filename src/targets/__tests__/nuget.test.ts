import { vi, type MockInstance } from 'vitest';
import { NugetTarget } from '../nuget';
import * as dotnetWorkspaces from '../../utils/dotnetWorkspaces';

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

  it('returns empty array when no packages found', async () => {
    discoverDotnetPackagesMock = vi
      .spyOn(dotnetWorkspaces, 'discoverDotnetPackages')
      .mockResolvedValue(null);

    const config = { name: 'nuget', workspaces: true };
    const result = await NugetTarget.expand(config, '/root');

    expect(result).toEqual([]);
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
      '/^Sentry\\.AspNetCore\\.\\d.*\\.s?nupkg$/'
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
      'https://custom.nuget.server/v3/index.json'
    );
  });

  it('uses artifactTemplate when provided', async () => {
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
      artifactTemplate: 'packages/{{packageId}}.{{version}}.nupkg',
    };
    const result = await NugetTarget.expand(config, '/root');

    expect(result).toHaveLength(1);
    expect(result[0].includeNames).toBe(
      '/^packages\\/Sentry\\.Core\\.\\d.*\\.nupkg$/'
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
      'src/Sentry.sln'
    );
  });
});
