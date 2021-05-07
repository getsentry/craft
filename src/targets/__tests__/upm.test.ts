import { NoneArtifactProvider } from '../../artifact_providers/none';
import { UpmTarget } from '../upm';
import { ConfigurationError } from '../../utils/errors';

jest.mock('fs');

/** Returns a new UpmTarget test instance. */
function getUpmTarget(): UpmTarget {
  return new UpmTarget(
    {
      name: 'upm-test',
      ['releaseOwner']: 'getsentry-test',
      ['releaseRepo']: 'unity-test',
    },
    new NoneArtifactProvider(),
    { owner: 'testSourceOwner', repo: 'testSourceRepo' }
  );
}

/** Returns a new UpmTarget test instance without configs. */
function getUpmTargetWithoutConfig(): UpmTarget {
  return new UpmTarget(
    {
      name: 'upm-test',
    },
    new NoneArtifactProvider(),
    { owner: 'testSourceOwner', repo: 'testSourceRepo' }
  );
}

describe('UPM evironment variables', () => {
  const oldEnvVariables = process.env;

  beforeEach(() => {
    jest.resetModules(); // Clear the cache.
    process.env = { ...oldEnvVariables }; // Restore environment
  });

  afterAll(() => {
    process.env = { ...oldEnvVariables }; // Restore environment
  });

  test('error on missing environment variables', async () => {
    if ('GITHUB_TOKEN' in process.env) {
      delete process.env.GITHUB_TOKEN;
    }
    try {
      getUpmTarget();
    } catch (error) {
      expect(error instanceof ConfigurationError).toBe(true);
      // const missingConfigPattern = /Missing environment variable/;
      // expect(missingConfigPattern.test(error.message)).toBe(true);
    }
  });

  test('success on environment variables', () => {
    process.env.GITHUB_TOKEN = 'test github token';
    process.env.GITHUB_API_TOKEN = 'test github api token';
    getUpmTarget();
  });
});

describe('UPM config parameters', () => {
  test('error on missing config parameters', async () => {
    try {
      getUpmTargetWithoutConfig();
    } catch (error) {
      expect(error instanceof ConfigurationError).toBe(true);
      // const missingConfigPattern = /Missing project configuration parameter/;
      // expect(missingConfigPattern.test(error.message)).toBe(true);
    }
  });

  test('success on config parameters', async () => {
    getUpmTarget();
  });
});

describe('publish', () => {
  const noArtifactsForRevision = jest.fn().mockImplementation(function () {
    return [];
  });

  test('error on missing artifact', async () => {
    const upmTarget = getUpmTarget();
    upmTarget.getArtifactsForRevision = noArtifactsForRevision.bind(UpmTarget);

    expect(
      upmTarget.publish('version', 'revision')
    ).rejects.toThrowErrorMatchingInlineSnapshot();

    // try {
    //   const publishResult = await upmTarget.publish('version', 'revision');
    //   expect(publishResult).toBe(undefined);
    // } catch (error) {
    //   // expect(error instanceof Error).toBe(true);
    //   // const noPackagePattern = /No release artifact found/;
    //   // expect(noPackagePattern.test(error.message)).toBe(true);

    // }
  });

  const tooManyArtifactsForRevision = jest.fn().mockImplementation(function () {
    return ['file1', 'file2'];
  });

  test('error on too many artifacts', async () => {
    const upmTarget = getUpmTarget();
    upmTarget.getArtifactsForRevision = tooManyArtifactsForRevision.bind(
      UpmTarget
    );

    try {
      const publishResult = await upmTarget.publish('version', 'revision');
      expect(publishResult).toBe(undefined);
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      // const tooManyPackagesPattern = /Too many release artifacts found/;
      // expect(tooManyPackagesPattern.test(error.message)).toBe(true);
    }
  });
});
