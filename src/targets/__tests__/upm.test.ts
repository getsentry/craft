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

describe('publish', () => {
  const cleanEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...cleanEnv,
      GITHUB_TOKEN: 'ghp_TAN21WJQkLtYVdHCh5eQJ8hTWoYvNh47gGWH',
    };
    jest.resetAllMocks();
  });

  test('error on missing artifact', async () => {
    const upmTarget = getUpmTarget();
    upmTarget.getArtifactsForRevision = jest.fn().mockReturnValueOnce([]);

    expect(
      upmTarget.publish('version', 'revision')
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Cannot publish UPM: No release artifact found."`
    );
  });

  test('error on too many artifacts', async () => {
    const upmTarget = getUpmTarget();
    upmTarget.getArtifactsForRevision = jest
      .fn()
      .mockReturnValueOnce(['file1', 'file2']);

    expect(upmTarget.publish('version', 'revision')).rejects
      .toThrowErrorMatchingInlineSnapshot(`
      "Cannot publish UPM: Too many release artifacts found:file1
      file2"
    `);
  });
});
