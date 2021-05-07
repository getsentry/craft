import { NoneArtifactProvider } from '../../artifact_providers/none';
import { UpmTarget } from '../upm';

/** Returns a new UpmTarget test instance. */
const getUpmTarget = () =>
  new UpmTarget(
    {
      name: 'upm-test',
      releaseOwner: 'getsentry-test',
      releaseRepo: 'unity-test',
    },
    new NoneArtifactProvider(),
    { owner: 'testSourceOwner', repo: 'testSourceRepo' }
  );

describe('artifacts', () => {
  const cleanEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...cleanEnv,
      GITHUB_TOKEN: 'ghp_TAN21WJQkLtYVdHCh5eQJ8hTWoYvNh47gGWH',
    };
    jest.resetAllMocks();
  });

  test.each`
    artifacts             | error
    ${[]}                 | ${'Cannot publish UPM: No release artifact found.'}
    ${['file1', 'file2']} | ${'Cannot publish UPM: Too many release artifacts found:file1\nfile2'}
  `(
    'error with artifact count $artifacts.length',
    async ({ artifacts, error }) => {
      const upmTarget = getUpmTarget();
      upmTarget.getArtifactsForRevision = jest
        .fn()
        .mockReturnValueOnce(artifacts);

      expect(upmTarget.publish('version', 'revision')).rejects.toThrow(error);
    }
  );
});
