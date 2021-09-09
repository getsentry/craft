import { NoneArtifactProvider } from '../../artifact_providers/none';
import {
  GRADLE_PROPERTIES_FILENAME,
  MavenTarget,
  targetSecrets,
} from '../maven';
import { withTempDir } from '../../utils/files';
// import { promises as fsPromises, acce } from 'fs';
import * as fs from 'fs';

jest.mock('../../utils/system');

const DEFAULT_OPTION_VALUE = 'my_default_value';

function setTargetSecretsInEnv(): void {
  for (const option of targetSecrets) {
    process.env[option] = DEFAULT_OPTION_VALUE;
  }
}

function removeTargetSecretsFromEnv(): void {
  for (const option of targetSecrets) {
    delete process.env[option];
  }
}

function getRequiredTargetConfig(): any {
  return {
    OSSRH_USERNAME: DEFAULT_OPTION_VALUE,
    OSSRH_PASSWORD: DEFAULT_OPTION_VALUE,
    gradleCliPath: DEFAULT_OPTION_VALUE,
    mavenCliPath: DEFAULT_OPTION_VALUE,
    mavenSettingsPath: DEFAULT_OPTION_VALUE,
    mavenRepoId: DEFAULT_OPTION_VALUE,
    mavenRepoUrl: DEFAULT_OPTION_VALUE,
    android: false,
  };
}

function createMavenTarget(
  targetConfig?: Record<string, unknown>
): MavenTarget {
  const finalConfig = targetConfig ? targetConfig : getRequiredTargetConfig();
  const mergedConfig = {
    name: 'maven',
    ...finalConfig,
  };
  return new MavenTarget(mergedConfig, new NoneArtifactProvider());
}

describe('withGradleProps', () => {
  beforeAll(() => {
    setTargetSecretsInEnv();
  });

  afterAll(() => removeTargetSecretsFromEnv());

  afterEach(() => {
    delete process.env.GRADLE_USER_HOME;
  });

  /**
   * Checks whether the properties file is correct.
   * @param path Path to the properties file.
   */
  async function testCorrectPropsFile(path: string): Promise<void> {
    try {
      const content = (await fs.promises.readFile(path)).toString();
      expect(content).toMatch(`mavenCentralUsername=${DEFAULT_OPTION_VALUE}`);
      expect(content).toMatch(`mavenCentralPassword=${DEFAULT_OPTION_VALUE}`);
    } catch (error) {
      throw new Error(`Cannot read the contents of the props file: ${error}`);
    }
  }

  test('non-existent props file', async () => {
    await withTempDir(async dir => {
      // TODO: make the calls to `fs` async

      process.env.GRADLE_USER_HOME = dir;
      const expectedPropsPath = `${dir}/${GRADLE_PROPERTIES_FILENAME}`;

      /**
       * Expect 3 assertions:
       *  2 testing whether the correct file in execution is created.
       *  1 testing whether the user's file has been deleted.
       */
      expect.assertions(3);

      const mvnTarget = createMavenTarget(getRequiredTargetConfig());
      mvnTarget.upload = jest
        .fn()
        .mockImplementationOnce(
          async () => await testCorrectPropsFile(expectedPropsPath)
        );

      await mvnTarget.publish('v3rs10n', 'r3v1s10n');
      expect(() => fs.accessSync(expectedPropsPath)).toThrowError(
        /ENOENT: no such file/
      );
    });
  });

  test('existent props file', async () => {
    await withTempDir(async dir => {
      // TODO: make the calls to `fs` async

      process.env.GRADLE_USER_HOME = dir;
      const expectedPropsPath = `${dir}/${GRADLE_PROPERTIES_FILENAME}`;
      const testProps = 'some random data to test prop snapshotting';

      /**
       * Expect 3 assertions:
       *  2 testing whether the correct file in execution is created.
       *  1 testing whether the file user's props file has correctly been restored.
       */
      expect.assertions(3);

      try {
        await fs.promises.writeFile(expectedPropsPath, testProps);
      } catch (error) {
        // If we can't create the props file this test doesn't test anything
        // new, so stop it.
        throw new Error(`Cannot create a props file: ${error}`);
      }

      const mvnTarget = createMavenTarget(getRequiredTargetConfig());
      mvnTarget.upload = jest
        .fn()
        .mockImplementationOnce(
          async () => await testCorrectPropsFile(expectedPropsPath)
        );
      await mvnTarget.publish('v3rs10n', 'r3v1s10n');

      expect(fs.readFileSync(expectedPropsPath).toString()).toStrictEqual(
        testProps
      );
    });
  });
});
