import { NoneArtifactProvider } from '../../artifact_providers/none';
import { MavenTarget } from '../maven';
import { withTempDir } from '../../utils/files';
import { promises as fsPromises } from 'fs';
import { join } from 'path';

jest.mock('../../utils/gpg');
jest.mock('../../utils/system');

const DEFAULT_OPTION_VALUE = 'my_default_value';

function getRequiredTargetConfig(): any {
  return {
    GPG_PASSPHRASE: DEFAULT_OPTION_VALUE,
    OSSRH_USERNAME: DEFAULT_OPTION_VALUE,
    OSSRH_PASSWORD: DEFAULT_OPTION_VALUE,
    mavenCliPath: DEFAULT_OPTION_VALUE,
    mavenSettingsPath: DEFAULT_OPTION_VALUE,
    mavenRepoId: DEFAULT_OPTION_VALUE,
    mavenRepoUrl: DEFAULT_OPTION_VALUE,
    android: false,
    kmp: false,
  };
}

function createMavenTarget(
  targetConfig?: Record<string, unknown>
): MavenTarget {
  process.env.GPG_PRIVATE_KEY = DEFAULT_OPTION_VALUE;
  process.env.GPG_PASSPHRASE = DEFAULT_OPTION_VALUE;
  process.env.OSSRH_USERNAME = DEFAULT_OPTION_VALUE;
  process.env.OSSRH_PASSWORD = DEFAULT_OPTION_VALUE;

  const finalConfig = targetConfig ? targetConfig : getRequiredTargetConfig();
  const mergedConfig = {
    name: 'maven',
    ...finalConfig,
  };
  return new MavenTarget(mergedConfig, new NoneArtifactProvider());
}

describe('maven disk io', () => {
  test('fileExists', async () => {
    await withTempDir(
      async (tmpDir): Promise<void> => {
        const target = createMavenTarget();

        expect(await target.fileExists('a/random/path')).toBe(false);

        // a folder should return false
        expect(await target.fileExists(tmpDir)).toBe(false);

        const file = join(tmpDir, 'module.json');

        // when the file doesn't exist it should return false
        expect(await target.fileExists(file)).toBe(false);
        await fsPromises.writeFile(file, 'abc');

        // once the file is written, it should exist
        expect(await target.fileExists(file)).toBe(true);
      }
    );
  });

  test('fixModuleFileName', async () => {
    await withTempDir(
      async (tmpDir): Promise<void> => {
        const target = createMavenTarget();

        const file = join(tmpDir, 'module.json');
        await fsPromises.writeFile(file, 'abc');

        const moduleFile = join(tmpDir, 'sentry-java-1.0.0.module');
        // when fix module is called with proper file names
        await target.fixModuleFileName(tmpDir, moduleFile);

        // it should rename the file
        expect(await target.fileExists(file)).toBe(false);
        expect(await target.fileExists(moduleFile)).toBe(true);
      }
    );
  });

  test('fixModuleFileName no-op', async () => {
    await withTempDir(
      async (tmpDir): Promise<void> => {
        const target = createMavenTarget();

        const file = join(tmpDir, 'sentry-java-1.0.0.module');
        await fsPromises.writeFile(file, 'abc');

        // when fix module is called, but the proper file already exists
        await target.fixModuleFileName(tmpDir, file);

        // it should still exist after calling fixModuleFileName
        expect(await target.fileExists(file)).toBe(true);
      }
    );
  });

  test('fixModuleFileName non-existant-files', async () => {
    await withTempDir(
      async (tmpDir): Promise<void> => {
        const target = createMavenTarget();

        const file = join(tmpDir, 'sentry-java-1.0.0.module');
        await target.fixModuleFileName(tmpDir, file);
      }
    );
  });
});
