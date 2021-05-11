import { setGlobals } from '../../utils/helpers';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { UpmTarget } from '../upm';

describe('UPM Target', () => {
  const cleanEnv = { ...process.env };
  let upmTarget: UpmTarget;

  beforeEach(() => {
    process.env = {
      ...cleanEnv,
      GITHUB_TOKEN: 'ghp_TAN21WJQkLtYVdHCh5eQJ8hTWoYvNh47gGWH',
    };
    setGlobals({ 'dry-run': false, 'log-level': 'Info', 'no-input': true });
    jest.resetAllMocks();

    upmTarget = new UpmTarget(
      {
        name: 'upm-test',
        releaseRepoOwner: 'getsentry-test',
        releaseRepoName: 'unity-test',
      },
      new NoneArtifactProvider(),
      { owner: 'testSourceOwner', repo: 'testSourceRepo' }
    );
  });

  describe('artifacts', () => {
    beforeEach(() => {
      setGlobals({ 'dry-run': false, 'log-level': 'Info', 'no-input': true });
    });
    test.each`
      artifacts             | error
      ${[]}                 | ${'Cannot publish UPM: No release artifact found.'}
      ${['file1', 'file2']} | ${'Cannot publish UPM: Too many release artifacts found:\nfile1\nfile2'}
    `(
      'error with artifact count $artifacts.length',
      async ({ artifacts, error }) => {
        upmTarget.getArtifactsForRevision = jest
          .fn()
          .mockResolvedValueOnce(artifacts);

        await expect(upmTarget.fetchArtifact('revision')).rejects.toThrow(
          error
        );
      }
    );
  });

  // TODO(byk): Add more tests for this
  describe.skip('publish', () => {
    beforeEach(() => {
      upmTarget.fetchArtifact = jest
        .fn()
        .mockResolvedValueOnce({ filename: 'artifact.zip' });
      upmTarget.artifactProvider.downloadArtifact = jest
        .fn()
        .mockResolvedValueOnce('some/test/path');
    });

    test('publish', () => {
      return expect(
        upmTarget.publish('version', 'revision')
      ).resolves.not.toThrow();
    });
  });
});
