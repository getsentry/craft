import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

import {
  getPackageManifest,
  RegistryPackageType,
  InitialManifestData,
} from '../registry';

describe('getPackageManifest', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'craft-registry-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('when package already exists', () => {
    it('reads the existing latest.json manifest', async () => {
      const packageDir = path.join(
        tempDir,
        'packages',
        'npm',
        '@sentry',
        'browser',
      );
      fs.mkdirSync(packageDir, { recursive: true });
      const existingManifest = {
        canonical: 'npm:@sentry/browser',
        name: 'Sentry Browser SDK',
        version: '1.0.0',
        repo_url: 'https://github.com/getsentry/sentry-javascript',
      };
      fs.writeFileSync(
        path.join(packageDir, 'latest.json'),
        JSON.stringify(existingManifest),
      );

      const result = await getPackageManifest(
        tempDir,
        RegistryPackageType.SDK,
        'npm:@sentry/browser',
        '1.1.0',
      );

      expect(result.packageManifest).toEqual(existingManifest);
      expect(result.versionFilePath).toBe(path.join(packageDir, '1.1.0.json'));
    });

    it('throws an error if version file already exists', async () => {
      const packageDir = path.join(
        tempDir,
        'packages',
        'npm',
        '@sentry',
        'browser',
      );
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(
        path.join(packageDir, 'latest.json'),
        JSON.stringify({ canonical: 'npm:@sentry/browser' }),
      );
      fs.writeFileSync(path.join(packageDir, '1.0.0.json'), '{}');

      await expect(
        getPackageManifest(
          tempDir,
          RegistryPackageType.SDK,
          'npm:@sentry/browser',
          '1.0.0',
        ),
      ).rejects.toThrow('Version file for "1.0.0" already exists');
    });
  });

  describe('when package does not exist (new package)', () => {
    it('creates directory structure and returns initial manifest', async () => {
      const initialData: InitialManifestData = {
        canonical: 'npm:@sentry/wasm',
        repoUrl: 'https://github.com/getsentry/sentry-javascript',
        name: 'Sentry WASM',
        packageUrl: 'https://www.npmjs.com/package/@sentry/wasm',
        mainDocsUrl: 'https://docs.sentry.io/platforms/javascript/',
      };

      const result = await getPackageManifest(
        tempDir,
        RegistryPackageType.SDK,
        'npm:@sentry/wasm',
        '0.1.0',
        initialData,
      );

      // Check directory was created
      const packageDir = path.join(
        tempDir,
        'packages',
        'npm',
        '@sentry',
        'wasm',
      );
      expect(fs.existsSync(packageDir)).toBe(true);

      // Check manifest has correct fields
      expect(result.packageManifest).toEqual({
        canonical: 'npm:@sentry/wasm',
        repo_url: 'https://github.com/getsentry/sentry-javascript',
        name: 'Sentry WASM',
        package_url: 'https://www.npmjs.com/package/@sentry/wasm',
        main_docs_url: 'https://docs.sentry.io/platforms/javascript/',
      });

      // Check version file path
      expect(result.versionFilePath).toBe(path.join(packageDir, '0.1.0.json'));
    });

    it('creates initial manifest with only required fields when optional are not provided', async () => {
      const initialData: InitialManifestData = {
        canonical: 'npm:@sentry/minimal',
        repoUrl: 'https://github.com/getsentry/sentry-javascript',
      };

      const result = await getPackageManifest(
        tempDir,
        RegistryPackageType.SDK,
        'npm:@sentry/minimal',
        '1.0.0',
        initialData,
      );

      expect(result.packageManifest).toEqual({
        canonical: 'npm:@sentry/minimal',
        repo_url: 'https://github.com/getsentry/sentry-javascript',
      });
    });

    it('throws an error when package does not exist and no initial data provided', async () => {
      await expect(
        getPackageManifest(
          tempDir,
          RegistryPackageType.SDK,
          'npm:@sentry/new-package',
          '1.0.0',
        ),
      ).rejects.toThrow(
        'Package "npm:@sentry/new-package" does not exist in the registry and no initial manifest data was provided',
      );
    });

    it('works with APP type packages', async () => {
      const initialData: InitialManifestData = {
        canonical: 'app:craft',
        repoUrl: 'https://github.com/getsentry/craft',
        name: 'Craft',
      };

      const result = await getPackageManifest(
        tempDir,
        RegistryPackageType.APP,
        'app:craft',
        '2.0.0',
        initialData,
      );

      // Check directory was created
      const packageDir = path.join(tempDir, 'apps', 'craft');
      expect(fs.existsSync(packageDir)).toBe(true);

      expect(result.packageManifest).toEqual({
        canonical: 'app:craft',
        repo_url: 'https://github.com/getsentry/craft',
        name: 'Craft',
      });
    });

    it('includes apiDocsUrl when provided', async () => {
      const initialData: InitialManifestData = {
        canonical: 'npm:@sentry/core',
        repoUrl: 'https://github.com/getsentry/sentry-javascript',
        apiDocsUrl: 'https://docs.sentry.io/api/',
      };

      const result = await getPackageManifest(
        tempDir,
        RegistryPackageType.SDK,
        'npm:@sentry/core',
        '1.0.0',
        initialData,
      );

      expect(result.packageManifest).toEqual({
        canonical: 'npm:@sentry/core',
        repo_url: 'https://github.com/getsentry/sentry-javascript',
        api_docs_url: 'https://docs.sentry.io/api/',
      });
    });
  });
});
