import { resolve } from 'path';

import {
  discoverWorkspaces,
  filterWorkspacePackages,
  packageNameToArtifactPattern,
  packageNameToArtifactFromTemplate,
  topologicalSortPackages,
  WorkspacePackage,
} from '../workspaces';

const fixturesDir = resolve(__dirname, '../__fixtures__/workspaces');

describe('discoverWorkspaces', () => {
  test('discovers npm workspaces', async () => {
    const result = await discoverWorkspaces(resolve(fixturesDir, 'npm-workspace'));

    expect(result.type).toBe('npm');
    expect(result.packages).toHaveLength(2);

    const packageNames = result.packages.map(p => p.name).sort();
    expect(packageNames).toEqual(['@test/pkg-a', '@test/pkg-b']);

    // Check that pkg-b is marked as private
    const pkgB = result.packages.find(p => p.name === '@test/pkg-b');
    expect(pkgB?.private).toBe(true);
    // Check that pkg-b has pkg-a as a workspace dependency
    expect(pkgB?.workspaceDependencies).toEqual(['@test/pkg-a']);

    const pkgA = result.packages.find(p => p.name === '@test/pkg-a');
    expect(pkgA?.private).toBe(false);
    expect(pkgA?.workspaceDependencies).toEqual([]);
  });

  test('discovers pnpm workspaces', async () => {
    const result = await discoverWorkspaces(resolve(fixturesDir, 'pnpm-workspace'));

    expect(result.type).toBe('pnpm');
    expect(result.packages).toHaveLength(2);

    const packageNames = result.packages.map(p => p.name).sort();
    expect(packageNames).toEqual(['@pnpm/pkg-a', '@pnpm/pkg-b']);
  });

  test('returns none type when no workspaces found', async () => {
    const result = await discoverWorkspaces(resolve(fixturesDir, 'no-workspace'));

    expect(result.type).toBe('none');
    expect(result.packages).toHaveLength(0);
  });

  test('returns none type for non-existent directory', async () => {
    const result = await discoverWorkspaces(resolve(fixturesDir, 'does-not-exist'));

    expect(result.type).toBe('none');
    expect(result.packages).toHaveLength(0);
  });
});

describe('filterWorkspacePackages', () => {
  const testPackages: WorkspacePackage[] = [
    { name: '@sentry/browser', location: '/path/browser', private: false, workspaceDependencies: [] },
    { name: '@sentry/node', location: '/path/node', private: false, workspaceDependencies: [] },
    { name: '@sentry-internal/utils', location: '/path/utils', private: false, workspaceDependencies: [] },
    { name: '@other/package', location: '/path/other', private: false, workspaceDependencies: [] },
  ];

  test('returns all packages when no filters provided', () => {
    const result = filterWorkspacePackages(testPackages);
    expect(result).toHaveLength(4);
  });

  test('filters packages by include pattern', () => {
    const result = filterWorkspacePackages(
      testPackages,
      /^@sentry\//
    );

    expect(result).toHaveLength(2);
    expect(result.map(p => p.name)).toEqual(['@sentry/browser', '@sentry/node']);
  });

  test('filters packages by exclude pattern', () => {
    const result = filterWorkspacePackages(
      testPackages,
      undefined,
      /^@sentry-internal\//
    );

    expect(result).toHaveLength(3);
    expect(result.map(p => p.name)).toEqual([
      '@sentry/browser',
      '@sentry/node',
      '@other/package',
    ]);
  });

  test('applies both include and exclude patterns', () => {
    const result = filterWorkspacePackages(
      testPackages,
      /^@sentry/,
      /^@sentry-internal\//
    );

    expect(result).toHaveLength(2);
    expect(result.map(p => p.name)).toEqual(['@sentry/browser', '@sentry/node']);
  });
});

describe('packageNameToArtifactPattern', () => {
  test('converts scoped package name to pattern', () => {
    const pattern = packageNameToArtifactPattern('@sentry/browser');
    expect(pattern).toBe('/^sentry-browser-\\d.*\\.tgz$/');
  });

  test('converts nested scoped package name to pattern', () => {
    const pattern = packageNameToArtifactPattern('@sentry-internal/browser-utils');
    expect(pattern).toBe('/^sentry-internal-browser-utils-\\d.*\\.tgz$/');
  });

  test('converts unscoped package name to pattern', () => {
    const pattern = packageNameToArtifactPattern('my-package');
    expect(pattern).toBe('/^my-package-\\d.*\\.tgz$/');
  });
});

describe('packageNameToArtifactFromTemplate', () => {
  test('replaces {{name}} with full package name', () => {
    const result = packageNameToArtifactFromTemplate(
      '@sentry/browser',
      '{{name}}.tgz'
    );
    expect(result).toBe('/^@sentry\\/browser\\.tgz$/');
  });

  test('replaces {{simpleName}} with normalized name', () => {
    const result = packageNameToArtifactFromTemplate(
      '@sentry/browser',
      '{{simpleName}}.tgz'
    );
    expect(result).toBe('/^sentry-browser\\.tgz$/');
  });

  test('replaces {{version}} with version placeholder', () => {
    const result = packageNameToArtifactFromTemplate(
      '@sentry/browser',
      '{{simpleName}}-{{version}}.tgz'
    );
    expect(result).toBe('/^sentry-browser-\\d.*\\.tgz$/');
  });

  test('replaces {{version}} with specific version', () => {
    const result = packageNameToArtifactFromTemplate(
      '@sentry/browser',
      '{{simpleName}}-{{version}}.tgz',
      '1.0.0'
    );
    expect(result).toBe('/^sentry-browser-1\\.0\\.0\\.tgz$/');
  });

  test('handles complex templates', () => {
    const result = packageNameToArtifactFromTemplate(
      '@sentry/browser',
      'dist/{{simpleName}}/{{simpleName}}-{{version}}.tgz'
    );
    expect(result).toBe('/^dist\\/sentry-browser\\/sentry-browser-\\d.*\\.tgz$/');
  });
});

describe('topologicalSortPackages', () => {
  test('returns packages in dependency order', () => {
    const packages: WorkspacePackage[] = [
      { name: '@sentry/browser', location: '/path/browser', private: false, workspaceDependencies: ['@sentry/core'] },
      { name: '@sentry/core', location: '/path/core', private: false, workspaceDependencies: ['@sentry/types'] },
      { name: '@sentry/types', location: '/path/types', private: false, workspaceDependencies: [] },
    ];

    const sorted = topologicalSortPackages(packages);

    expect(sorted.map(p => p.name)).toEqual([
      '@sentry/types',  // no dependencies, comes first
      '@sentry/core',   // depends on types
      '@sentry/browser', // depends on core
    ]);
  });

  test('handles packages with no dependencies', () => {
    const packages: WorkspacePackage[] = [
      { name: 'pkg-a', location: '/path/a', private: false, workspaceDependencies: [] },
      { name: 'pkg-b', location: '/path/b', private: false, workspaceDependencies: [] },
      { name: 'pkg-c', location: '/path/c', private: false, workspaceDependencies: [] },
    ];

    const sorted = topologicalSortPackages(packages);

    // All packages have no dependencies, order should be preserved
    expect(sorted).toHaveLength(3);
    expect(sorted.map(p => p.name)).toEqual(['pkg-a', 'pkg-b', 'pkg-c']);
  });

  test('handles diamond dependencies', () => {
    // Diamond: A depends on B and C, both B and C depend on D
    const packages: WorkspacePackage[] = [
      { name: 'A', location: '/path/a', private: false, workspaceDependencies: ['B', 'C'] },
      { name: 'B', location: '/path/b', private: false, workspaceDependencies: ['D'] },
      { name: 'C', location: '/path/c', private: false, workspaceDependencies: ['D'] },
      { name: 'D', location: '/path/d', private: false, workspaceDependencies: [] },
    ];

    const sorted = topologicalSortPackages(packages);
    const names = sorted.map(p => p.name);

    // D must come before B and C, B and C must come before A
    expect(names.indexOf('D')).toBeLessThan(names.indexOf('B'));
    expect(names.indexOf('D')).toBeLessThan(names.indexOf('C'));
    expect(names.indexOf('B')).toBeLessThan(names.indexOf('A'));
    expect(names.indexOf('C')).toBeLessThan(names.indexOf('A'));
  });

  test('ignores dependencies not in the package list', () => {
    const packages: WorkspacePackage[] = [
      { name: 'pkg-a', location: '/path/a', private: false, workspaceDependencies: ['external-dep', 'pkg-b'] },
      { name: 'pkg-b', location: '/path/b', private: false, workspaceDependencies: ['lodash'] },
    ];

    const sorted = topologicalSortPackages(packages);

    // pkg-b comes first because pkg-a depends on it
    expect(sorted.map(p => p.name)).toEqual(['pkg-b', 'pkg-a']);
  });

  test('throws error on circular dependencies', () => {
    const packages: WorkspacePackage[] = [
      { name: 'pkg-a', location: '/path/a', private: false, workspaceDependencies: ['pkg-b'] },
      { name: 'pkg-b', location: '/path/b', private: false, workspaceDependencies: ['pkg-c'] },
      { name: 'pkg-c', location: '/path/c', private: false, workspaceDependencies: ['pkg-a'] },
    ];

    expect(() => topologicalSortPackages(packages)).toThrow(/Circular dependency/);
  });

  test('handles complex dependency graph', () => {
    // Real-world-like setup:
    // types -> core -> (browser, node) -> integrations
    const packages: WorkspacePackage[] = [
      { name: '@sentry/integrations', location: '/path/integrations', private: false, workspaceDependencies: ['@sentry/browser', '@sentry/node'] },
      { name: '@sentry/browser', location: '/path/browser', private: false, workspaceDependencies: ['@sentry/core'] },
      { name: '@sentry/node', location: '/path/node', private: false, workspaceDependencies: ['@sentry/core'] },
      { name: '@sentry/core', location: '/path/core', private: false, workspaceDependencies: ['@sentry/types'] },
      { name: '@sentry/types', location: '/path/types', private: false, workspaceDependencies: [] },
    ];

    const sorted = topologicalSortPackages(packages);
    const names = sorted.map(p => p.name);

    // Verify order: types -> core -> (browser, node) -> integrations
    expect(names.indexOf('@sentry/types')).toBeLessThan(names.indexOf('@sentry/core'));
    expect(names.indexOf('@sentry/core')).toBeLessThan(names.indexOf('@sentry/browser'));
    expect(names.indexOf('@sentry/core')).toBeLessThan(names.indexOf('@sentry/node'));
    expect(names.indexOf('@sentry/browser')).toBeLessThan(names.indexOf('@sentry/integrations'));
    expect(names.indexOf('@sentry/node')).toBeLessThan(names.indexOf('@sentry/integrations'));
  });
});
