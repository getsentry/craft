import { vi, type Mock, type MockedFunction } from 'vitest';
vi.mock('../../utils/githubApi.ts');
import { getGitHubClient } from '../../utils/githubApi';
import { RegistryConfig, RegistryTarget } from '../registry';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import { RegistryPackageType } from '../../utils/registry';

describe('getUpdatedManifest', () => {
  let mockClient: Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    mockClient = vi.fn();
    (getGitHubClient as MockedFunction<
      typeof getGitHubClient
      // @ts-ignore we only need to mock a subset
    >).mockReturnValue({ graphql: mockClient });
  });

  const target = new RegistryTarget(
    { name: 'pypi' },
    new NoneArtifactProvider(),
    { owner: 'testSourceOwner', repo: 'testSourceRepo' }
  );

  it('check if created_at exists', async () => {
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

    // check if property created_at exists
    expect(updatedManifest).toHaveProperty('created_at');
  });

  it('always sets repo_url from githubRepo config', async () => {
    const registryConfig: RegistryConfig = {
      type: RegistryPackageType.SDK,
      canonicalName: 'example-package',
    };
    const packageManifest = {
      canonical: 'example-package',
      repo_url: 'https://github.com/old/repo',
    };

    const updatedManifest = await target.getUpdatedManifest(
      registryConfig,
      packageManifest,
      'example-package',
      '1.0.0',
      'abc123'
    );

    expect(updatedManifest.repo_url).toBe(
      'https://github.com/testSourceOwner/testSourceRepo'
    );
  });

  it('applies config metadata fields to manifest', async () => {
    const registryConfig: RegistryConfig = {
      type: RegistryPackageType.SDK,
      canonicalName: 'example-package',
      name: 'Example Package',
      packageUrl: 'https://npmjs.com/package/example',
      mainDocsUrl: 'https://docs.example.com',
      apiDocsUrl: 'https://api.example.com/docs',
    };
    const packageManifest = {
      canonical: 'example-package',
    };

    const updatedManifest = await target.getUpdatedManifest(
      registryConfig,
      packageManifest,
      'example-package',
      '1.0.0',
      'abc123'
    );

    expect(updatedManifest.name).toBe('Example Package');
    expect(updatedManifest.package_url).toBe('https://npmjs.com/package/example');
    expect(updatedManifest.main_docs_url).toBe('https://docs.example.com');
    expect(updatedManifest.api_docs_url).toBe('https://api.example.com/docs');
  });

  it('config metadata fields override existing manifest values', async () => {
    const registryConfig: RegistryConfig = {
      type: RegistryPackageType.SDK,
      canonicalName: 'example-package',
      name: 'New Name',
      mainDocsUrl: 'https://new-docs.example.com',
    };
    const packageManifest = {
      canonical: 'example-package',
      name: 'Old Name',
      main_docs_url: 'https://old-docs.example.com',
      package_url: 'https://npmjs.com/package/example',
    };

    const updatedManifest = await target.getUpdatedManifest(
      registryConfig,
      packageManifest,
      'example-package',
      '1.0.0',
      'abc123'
    );

    // Config values should override
    expect(updatedManifest.name).toBe('New Name');
    expect(updatedManifest.main_docs_url).toBe('https://new-docs.example.com');
    // Existing value not in config should be preserved
    expect(updatedManifest.package_url).toBe('https://npmjs.com/package/example');
  });

  it('does not set optional fields when not specified in config', async () => {
    const registryConfig: RegistryConfig = {
      type: RegistryPackageType.SDK,
      canonicalName: 'example-package',
    };
    const packageManifest = {
      canonical: 'example-package',
    };

    const updatedManifest = await target.getUpdatedManifest(
      registryConfig,
      packageManifest,
      'example-package',
      '1.0.0',
      'abc123'
    );

    expect(updatedManifest.name).toBeUndefined();
    expect(updatedManifest.package_url).toBeUndefined();
    expect(updatedManifest.main_docs_url).toBeUndefined();
    expect(updatedManifest.api_docs_url).toBeUndefined();
  });
});
