jest.mock('../../utils/githubApi.ts');
import { getGitHubClient } from '../../utils/githubApi';
import { RegistryConfig, RegistryTarget } from '../registry';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { RegistryPackageType } from '../../utils/registry';

describe('getUpdatedManifest', () => {
  let mockClient: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    mockClient = jest.fn();
    (getGitHubClient as jest.MockedFunction<
      typeof getGitHubClient
      // @ts-ignore we only need to mock a subset
    >).mockReturnValue({ graphql: mockClient });
  });

  const target = new RegistryTarget(
    { name: 'pypi' },
    new NoneArtifactProvider(),
    { owner: 'testSourceOwner', repo: 'testSourceRepo' }
  );

  it('check if createdAt exists', async () => {
    const registryConfig: RegistryConfig = {
      type: RegistryPackageType.SDK,
      canonicalName: 'example-package',
    };
    const packageManifest = {
      canonical: 'example-package',
    };
    const canonical = 'example-package';
    const version = '1.2.3';
    const revision = 'abc123';

    const updatedManifest = await target.getUpdatedManifest(
      registryConfig,
      packageManifest,
      canonical,
      version,
      revision
    );

    // check if property createdAt exists
    expect(updatedManifest).toHaveProperty('createdAt');
  });
});
