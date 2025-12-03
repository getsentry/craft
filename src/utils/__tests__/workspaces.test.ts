import { resolve } from 'path';

import {
  discoverWorkspaces,
  filterWorkspacePackages,
  packageNameToArtifactPattern,
  packageNameToArtifactFromTemplate,
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

    const pkgA = result.packages.find(p => p.name === '@test/pkg-a');
    expect(pkgA?.private).toBe(false);
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
    { name: '@sentry/browser', location: '/path/browser', private: false },
    { name: '@sentry/node', location: '/path/node', private: false },
    { name: '@sentry-internal/utils', location: '/path/utils', private: false },
    { name: '@other/package', location: '/path/other', private: false },
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
