import { resolve } from 'path';

import {
  discoverDotnetPackages,
  parseSolutionFile,
  parseSlnxFile,
  parseCsprojFile,
  sortDotnetPackages,
  packageIdToNugetArtifactPattern,
  packageIdToNugetArtifactFromTemplate,
  DotnetPackage,
} from '../dotnetWorkspaces';

const fixturesDir = resolve(__dirname, '../__fixtures__/dotnet-workspaces');

describe('parseSolutionFile', () => {
  test('parses solution file and extracts project paths', () => {
    const solutionPath = resolve(fixturesDir, 'simple-solution/Sentry.sln');
    const projectPaths = parseSolutionFile(solutionPath);

    expect(projectPaths).toHaveLength(2);

    // Paths should be absolute and normalized
    expect(projectPaths).toContain(
      resolve(fixturesDir, 'simple-solution/src/Sentry.Core/Sentry.Core.csproj')
    );
    expect(projectPaths).toContain(
      resolve(
        fixturesDir,
        'simple-solution/src/Sentry.AspNetCore/Sentry.AspNetCore.csproj'
      )
    );
  });

  test('returns empty array for non-existent solution file', () => {
    const solutionPath = resolve(fixturesDir, 'does-not-exist.sln');
    const projectPaths = parseSolutionFile(solutionPath);

    expect(projectPaths).toHaveLength(0);
  });
});

describe('parseSlnxFile', () => {
  test('parses slnx file and extracts project paths', () => {
    const solutionPath = resolve(fixturesDir, 'slnx-solution/Sentry.slnx');
    const projectPaths = parseSlnxFile(solutionPath);

    expect(projectPaths).toHaveLength(2);
    expect(projectPaths).toContain(
      resolve(fixturesDir, 'slnx-solution/src/Sentry.Core/Sentry.Core.csproj')
    );
    expect(projectPaths).toContain(
      resolve(
        fixturesDir,
        'slnx-solution/src/Sentry.AspNetCore/Sentry.AspNetCore.csproj'
      )
    );
  });

  test('returns empty array for non-existent slnx file', () => {
    const solutionPath = resolve(fixturesDir, 'does-not-exist.slnx');
    const projectPaths = parseSlnxFile(solutionPath);

    expect(projectPaths).toHaveLength(0);
  });
});

describe('parseCsprojFile', () => {
  test('parses csproj file and extracts package info', () => {
    const projectPath = resolve(
      fixturesDir,
      'simple-solution/src/Sentry.Core/Sentry.Core.csproj'
    );
    const pkg = parseCsprojFile(projectPath);

    expect(pkg).not.toBeNull();
    expect(pkg?.packageId).toBe('Sentry.Core');
    expect(pkg?.isPackable).toBe(true);
    expect(pkg?.projectDependencies).toHaveLength(0);
  });

  test('extracts project references from csproj', () => {
    const projectPath = resolve(
      fixturesDir,
      'simple-solution/src/Sentry.AspNetCore/Sentry.AspNetCore.csproj'
    );
    const pkg = parseCsprojFile(projectPath);

    expect(pkg).not.toBeNull();
    expect(pkg?.packageId).toBe('Sentry.AspNetCore');
    expect(pkg?.projectDependencies).toContain('Sentry.Core');
  });

  test('returns null for non-existent csproj file', () => {
    const projectPath = resolve(fixturesDir, 'does-not-exist.csproj');
    const pkg = parseCsprojFile(projectPath);

    expect(pkg).toBeNull();
  });
});

describe('discoverDotnetPackages', () => {
  test('discovers packages from solution file', async () => {
    const result = await discoverDotnetPackages(
      resolve(fixturesDir, 'simple-solution')
    );

    expect(result).not.toBeNull();
    expect(result?.packages).toHaveLength(2);

    const packageIds = result?.packages.map(p => p.packageId).sort();
    expect(packageIds).toEqual(['Sentry.AspNetCore', 'Sentry.Core']);
  });

  test('discovers packages with explicit solution path', async () => {
    const result = await discoverDotnetPackages(
      fixturesDir,
      'simple-solution/Sentry.sln'
    );

    expect(result).not.toBeNull();
    expect(result?.packages).toHaveLength(2);
  });

  test('returns null when no solution file found', async () => {
    const result = await discoverDotnetPackages(
      resolve(fixturesDir, 'no-solution')
    );

    expect(result).toBeNull();
  });

  test('returns null for non-existent directory', async () => {
    const result = await discoverDotnetPackages(
      resolve(fixturesDir, 'does-not-exist')
    );

    expect(result).toBeNull();
  });

  test('filters dependencies to only include workspace packages', async () => {
    const result = await discoverDotnetPackages(
      resolve(fixturesDir, 'simple-solution')
    );

    const aspNetCore = result?.packages.find(
      p => p.packageId === 'Sentry.AspNetCore'
    );

    // Sentry.AspNetCore depends on Sentry.Core (which is in the workspace)
    expect(aspNetCore?.projectDependencies).toContain('Sentry.Core');
  });
});

describe('sortDotnetPackages', () => {
  test('sorts packages in dependency order', () => {
    const packages: DotnetPackage[] = [
      {
        packageId: 'Sentry.AspNetCore',
        projectPath: '/path/AspNetCore.csproj',
        isPackable: true,
        projectDependencies: ['Sentry.Core'],
      },
      {
        packageId: 'Sentry.Core',
        projectPath: '/path/Core.csproj',
        isPackable: true,
        projectDependencies: [],
      },
    ];

    const sorted = sortDotnetPackages(packages);

    expect(sorted.map(p => p.packageId)).toEqual([
      'Sentry.Core', // no dependencies, comes first
      'Sentry.AspNetCore', // depends on Core
    ]);
  });

  test('sorts complex dependency graph', async () => {
    const result = await discoverDotnetPackages(
      resolve(fixturesDir, 'complex-solution')
    );

    expect(result).not.toBeNull();

    const sorted = sortDotnetPackages(result!.packages);
    const packageIds = sorted.map(p => p.packageId);

    // Sentry has no dependencies, should come first
    expect(packageIds[0]).toBe('Sentry');

    // Extensions.Logging and Serilog depend on Sentry
    const extLoggingIdx = packageIds.indexOf('Sentry.Extensions.Logging');
    const serilogIdx = packageIds.indexOf('Sentry.Serilog');
    expect(extLoggingIdx).toBeGreaterThan(0);
    expect(serilogIdx).toBeGreaterThan(0);

    // AspNetCore depends on Extensions.Logging, should come after it
    const aspNetCoreIdx = packageIds.indexOf('Sentry.AspNetCore');
    expect(aspNetCoreIdx).toBeGreaterThan(extLoggingIdx);
  });
});

describe('packageIdToNugetArtifactPattern', () => {
  test('converts package ID to pattern matching both .nupkg and .snupkg', () => {
    const pattern = packageIdToNugetArtifactPattern('Sentry.AspNetCore');
    expect(pattern).toBe('/^Sentry\\.AspNetCore\\.\\d.*\\.s?nupkg$/');

    // Verify the pattern matches both .nupkg and .snupkg
    const regex = new RegExp(pattern.slice(1, -1));
    expect(regex.test('Sentry.AspNetCore.1.0.0.nupkg')).toBe(true);
    expect(regex.test('Sentry.AspNetCore.1.0.0.snupkg')).toBe(true);
    expect(regex.test('Other.Package.1.0.0.nupkg')).toBe(false);
  });

  test('escapes dots in package ID', () => {
    expect(packageIdToNugetArtifactPattern('Sentry')).toBe(
      '/^Sentry\\.\\d.*\\.s?nupkg$/'
    );
    expect(packageIdToNugetArtifactPattern('Sentry.Extensions.Logging')).toBe(
      '/^Sentry\\.Extensions\\.Logging\\.\\d.*\\.s?nupkg$/'
    );
  });
});

describe('packageIdToNugetArtifactFromTemplate', () => {
  test('replaces placeholders and escapes special characters', () => {
    // Basic packageId replacement
    expect(
      packageIdToNugetArtifactFromTemplate('Sentry.Core', '{{packageId}}.nupkg')
    ).toBe('/^Sentry\\.Core\\.nupkg$/');

    // Version with regex pattern
    expect(
      packageIdToNugetArtifactFromTemplate(
        'Sentry.Core',
        '{{packageId}}.{{version}}.nupkg'
      )
    ).toBe('/^Sentry\\.Core\\.\\d.*\\.nupkg$/');

    // Version with specific value
    expect(
      packageIdToNugetArtifactFromTemplate(
        'Sentry.Core',
        '{{packageId}}.{{version}}.nupkg',
        '1.0.0'
      )
    ).toBe('/^Sentry\\.Core\\.1\\.0\\.0\\.nupkg$/');

    // Complex template with paths
    expect(
      packageIdToNugetArtifactFromTemplate(
        'Sentry.Core',
        'packages/{{packageId}}/{{packageId}}.{{version}}.nupkg'
      )
    ).toBe('/^packages\\/Sentry\\.Core\\/Sentry\\.Core\\.\\d.*\\.nupkg$/');
  });
});
