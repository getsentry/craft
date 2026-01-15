import { vi, describe, it, expect, beforeEach, afterEach, afterAll, type Mock, type Mocked } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';

import {
  DockerTarget,
  extractRegistry,
  registryToEnvPrefix,
  normalizeImageRef,
  isGoogleCloudRegistry,
  hasGcloudCredentials,
} from '../docker';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import * as system from '../../utils/system';

vi.mock('../../utils/system', async (importOriginal) => {
  const actual = await importOriginal<typeof system>();
  return {
    ...actual,
    checkExecutableIsPresent: vi.fn(),
    spawnProcess: vi.fn().mockResolvedValue(Buffer.from('')),
  };
});

vi.mock('node:fs');
vi.mock('node:os');

describe('normalizeImageRef', () => {
  it('normalizes string source to object with image property', () => {
    const config = { source: 'ghcr.io/org/image' };
    const result = normalizeImageRef(config, 'source');
    expect(result).toEqual({
      image: 'ghcr.io/org/image',
      format: undefined,
      registry: undefined,
      usernameVar: undefined,
      passwordVar: undefined,
    });
  });

  it('normalizes string target to object with image property', () => {
    const config = { target: 'getsentry/craft' };
    const result = normalizeImageRef(config, 'target');
    expect(result).toEqual({
      image: 'getsentry/craft',
      format: undefined,
      registry: undefined,
      usernameVar: undefined,
      passwordVar: undefined,
    });
  });

  it('passes through object form', () => {
    const config = {
      source: {
        image: 'ghcr.io/org/image',
        registry: 'ghcr.io',
        format: '{{{source}}}:latest',
        usernameVar: 'MY_USER',
        passwordVar: 'MY_PASS',
      },
    };
    const result = normalizeImageRef(config, 'source');
    expect(result).toEqual({
      image: 'ghcr.io/org/image',
      registry: 'ghcr.io',
      format: '{{{source}}}:latest',
      usernameVar: 'MY_USER',
      passwordVar: 'MY_PASS',
    });
  });

  it('uses legacy source params as fallback for string form', () => {
    const config = {
      source: 'ghcr.io/org/image',
      sourceFormat: '{{{source}}}:custom',
      sourceRegistry: 'custom.registry.io',
      sourceUsernameVar: 'LEGACY_USER',
      sourcePasswordVar: 'LEGACY_PASS',
    };
    const result = normalizeImageRef(config, 'source');
    expect(result).toEqual({
      image: 'ghcr.io/org/image',
      format: '{{{source}}}:custom',
      registry: 'custom.registry.io',
      usernameVar: 'LEGACY_USER',
      passwordVar: 'LEGACY_PASS',
    });
  });

  it('uses legacy target params as fallback for string form', () => {
    const config = {
      target: 'getsentry/craft',
      targetFormat: '{{{target}}}:v{{{version}}}',
      registry: 'docker.io',
      usernameVar: 'LEGACY_USER',
      passwordVar: 'LEGACY_PASS',
    };
    const result = normalizeImageRef(config, 'target');
    expect(result).toEqual({
      image: 'getsentry/craft',
      format: '{{{target}}}:v{{{version}}}',
      registry: 'docker.io',
      usernameVar: 'LEGACY_USER',
      passwordVar: 'LEGACY_PASS',
    });
  });

  it('prefers object properties over legacy params', () => {
    const config = {
      source: {
        image: 'ghcr.io/org/image',
        registry: 'new.registry.io',
        format: '{{{source}}}:new',
      },
      sourceFormat: '{{{source}}}:legacy',
      sourceRegistry: 'legacy.registry.io',
      sourceUsernameVar: 'LEGACY_USER',
      sourcePasswordVar: 'LEGACY_PASS',
    };
    const result = normalizeImageRef(config, 'source');
    expect(result).toEqual({
      image: 'ghcr.io/org/image',
      registry: 'new.registry.io',
      format: '{{{source}}}:new',
      usernameVar: 'LEGACY_USER', // Falls back to legacy since not in object
      passwordVar: 'LEGACY_PASS',
    });
  });

  it('allows partial object with legacy fallback', () => {
    const config = {
      source: { image: 'ghcr.io/org/image' },
      sourceFormat: '{{{source}}}:legacy',
      sourceRegistry: 'legacy.registry.io',
    };
    const result = normalizeImageRef(config, 'source');
    expect(result).toEqual({
      image: 'ghcr.io/org/image',
      format: '{{{source}}}:legacy',
      registry: 'legacy.registry.io',
      usernameVar: undefined,
      passwordVar: undefined,
    });
  });

  it('throws ConfigurationError when source is missing', () => {
    const config = { target: 'getsentry/craft' };
    expect(() => normalizeImageRef(config, 'source')).toThrow(
      "Docker target requires a 'source' property. Please specify the source image."
    );
  });

  it('throws ConfigurationError when target is missing', () => {
    const config = { source: 'ghcr.io/org/image' };
    expect(() => normalizeImageRef(config, 'target')).toThrow(
      "Docker target requires a 'target' property. Please specify the target image."
    );
  });
});

describe('extractRegistry', () => {
  it('returns undefined for Docker Hub images (user/image)', () => {
    expect(extractRegistry('user/image')).toBeUndefined();
    expect(extractRegistry('getsentry/craft')).toBeUndefined();
  });

  it('returns undefined for simple image names', () => {
    expect(extractRegistry('nginx')).toBeUndefined();
    expect(extractRegistry('ubuntu')).toBeUndefined();
  });

  it('extracts ghcr.io registry', () => {
    expect(extractRegistry('ghcr.io/user/image')).toBe('ghcr.io');
    expect(extractRegistry('ghcr.io/getsentry/craft')).toBe('ghcr.io');
  });

  it('extracts gcr.io and regional variants', () => {
    expect(extractRegistry('gcr.io/project/image')).toBe('gcr.io');
    expect(extractRegistry('us.gcr.io/project/image')).toBe('us.gcr.io');
    expect(extractRegistry('eu.gcr.io/project/image')).toBe('eu.gcr.io');
    expect(extractRegistry('asia.gcr.io/project/image')).toBe('asia.gcr.io');
  });

  it('extracts other registries with dots', () => {
    expect(extractRegistry('registry.example.com/image')).toBe(
      'registry.example.com'
    );
  });

  it('treats docker.io variants as Docker Hub (returns undefined)', () => {
    // docker.io is the canonical Docker Hub registry
    expect(extractRegistry('docker.io/library/nginx')).toBeUndefined();
    expect(extractRegistry('docker.io/getsentry/craft')).toBeUndefined();
    // index.docker.io is the legacy Docker Hub registry
    expect(extractRegistry('index.docker.io/library/nginx')).toBeUndefined();
    // registry-1.docker.io is another Docker Hub alias
    expect(extractRegistry('registry-1.docker.io/user/image')).toBeUndefined();
  });

  it('extracts registries with ports', () => {
    expect(extractRegistry('localhost:5000/image')).toBe('localhost:5000');
    expect(extractRegistry('myregistry:8080/user/image')).toBe(
      'myregistry:8080'
    );
  });
});

describe('registryToEnvPrefix', () => {
  it('converts ghcr.io to GHCR_IO', () => {
    expect(registryToEnvPrefix('ghcr.io')).toBe('GHCR_IO');
  });

  it('converts gcr.io to GCR_IO', () => {
    expect(registryToEnvPrefix('gcr.io')).toBe('GCR_IO');
  });

  it('converts regional GCR to correct prefix', () => {
    expect(registryToEnvPrefix('us.gcr.io')).toBe('US_GCR_IO');
    expect(registryToEnvPrefix('eu.gcr.io')).toBe('EU_GCR_IO');
    expect(registryToEnvPrefix('asia.gcr.io')).toBe('ASIA_GCR_IO');
  });

  it('handles hyphens in registry names', () => {
    expect(registryToEnvPrefix('my-registry.example.com')).toBe(
      'MY_REGISTRY_EXAMPLE_COM'
    );
  });

  it('handles ports in registry names', () => {
    expect(registryToEnvPrefix('localhost:5000')).toBe('LOCALHOST_5000');
  });
});

describe('isGoogleCloudRegistry', () => {
  it('returns true for gcr.io', () => {
    expect(isGoogleCloudRegistry('gcr.io')).toBe(true);
  });

  it('returns true for regional GCR variants', () => {
    expect(isGoogleCloudRegistry('us.gcr.io')).toBe(true);
    expect(isGoogleCloudRegistry('eu.gcr.io')).toBe(true);
    expect(isGoogleCloudRegistry('asia.gcr.io')).toBe(true);
  });

  it('returns true for Artifact Registry multi-region (pkg.dev)', () => {
    expect(isGoogleCloudRegistry('us-docker.pkg.dev')).toBe(true);
    expect(isGoogleCloudRegistry('europe-docker.pkg.dev')).toBe(true);
    expect(isGoogleCloudRegistry('asia-docker.pkg.dev')).toBe(true);
  });

  it('returns true for Artifact Registry regional endpoints (pkg.dev)', () => {
    expect(isGoogleCloudRegistry('us-west1-docker.pkg.dev')).toBe(true);
    expect(isGoogleCloudRegistry('us-central1-docker.pkg.dev')).toBe(true);
    expect(isGoogleCloudRegistry('us-east4-docker.pkg.dev')).toBe(true);
    expect(isGoogleCloudRegistry('europe-west1-docker.pkg.dev')).toBe(true);
    expect(isGoogleCloudRegistry('asia-east1-docker.pkg.dev')).toBe(true);
    expect(isGoogleCloudRegistry('australia-southeast1-docker.pkg.dev')).toBe(true);
  });

  it('returns false for non-Google registries', () => {
    expect(isGoogleCloudRegistry('ghcr.io')).toBe(false);
    expect(isGoogleCloudRegistry('docker.io')).toBe(false);
    expect(isGoogleCloudRegistry('custom.registry.io')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isGoogleCloudRegistry(undefined)).toBe(false);
  });
});

describe('hasGcloudCredentials', () => {
  const mockFs = fs as Mocked<typeof fs>;
  const mockOs = os as Mocked<typeof os>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockFs.existsSync).mockReturnValue(false);
    vi.mocked(mockOs.homedir).mockReturnValue('/home/user');
  });

  afterEach(() => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_GHA_CREDS_PATH;
    delete process.env.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE;
  });

  it('returns true when GOOGLE_APPLICATION_CREDENTIALS points to existing file', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';
    vi.mocked(mockFs.existsSync).mockImplementation(
      (p: fs.PathLike) => p === '/path/to/creds.json'
    );

    expect(hasGcloudCredentials()).toBe(true);
  });

  it('returns true when GOOGLE_GHA_CREDS_PATH points to existing file', () => {
    process.env.GOOGLE_GHA_CREDS_PATH = '/tmp/gha-creds.json';
    vi.mocked(mockFs.existsSync).mockImplementation(
      (p: fs.PathLike) => p === '/tmp/gha-creds.json'
    );

    expect(hasGcloudCredentials()).toBe(true);
  });

  it('returns true when CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE points to existing file', () => {
    process.env.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE = '/override/creds.json';
    vi.mocked(mockFs.existsSync).mockImplementation(
      (p: fs.PathLike) => p === '/override/creds.json'
    );

    expect(hasGcloudCredentials()).toBe(true);
  });

  it('returns true when default ADC file exists', () => {
    vi.mocked(mockFs.existsSync).mockImplementation(
      (p: fs.PathLike) =>
        p === '/home/user/.config/gcloud/application_default_credentials.json'
    );

    expect(hasGcloudCredentials()).toBe(true);
  });

  it('returns false when no credentials are found', () => {
    expect(hasGcloudCredentials()).toBe(false);
  });
});

describe('DockerTarget', () => {
  const oldEnv = { ...process.env };
  const mockFs = fs as Mocked<typeof fs>;
  const mockOs = os as Mocked<typeof os>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockFs.existsSync).mockReturnValue(false);
    vi.mocked(mockOs.homedir).mockReturnValue('/home/user');
    // Clear all Docker-related env vars
    delete process.env.DOCKER_USERNAME;
    delete process.env.DOCKER_PASSWORD;
    delete process.env.DOCKER_GHCR_IO_USERNAME;
    delete process.env.DOCKER_GHCR_IO_PASSWORD;
    delete process.env.DOCKER_GCR_IO_USERNAME;
    delete process.env.DOCKER_GCR_IO_PASSWORD;
    delete process.env.GITHUB_ACTOR;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_API_TOKEN;
  });

  afterAll(() => {
    process.env = { ...oldEnv };
  });

  describe('target credential resolution', () => {
    describe('Mode A: explicit usernameVar/passwordVar', () => {
      it('uses explicit env vars when both are specified', () => {
        process.env.MY_USER = 'custom-user';
        process.env.MY_PASS = 'custom-pass';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'ghcr.io/org/image',
            usernameVar: 'MY_USER',
            passwordVar: 'MY_PASS',
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.username).toBe('custom-user');
        expect(target.dockerConfig.target.credentials!.password).toBe('custom-pass');
      });

      it('throws if only usernameVar is specified', () => {
        process.env.MY_USER = 'custom-user';

        expect(
          () =>
            new DockerTarget(
              {
                name: 'docker',
                source: 'ghcr.io/org/image',
                target: 'ghcr.io/org/image',
                usernameVar: 'MY_USER',
              },
              new NoneArtifactProvider()
            )
        ).toThrow('Both usernameVar and passwordVar must be specified together');
      });

      it('throws if only passwordVar is specified', () => {
        process.env.MY_PASS = 'custom-pass';

        expect(
          () =>
            new DockerTarget(
              {
                name: 'docker',
                source: 'ghcr.io/org/image',
                target: 'ghcr.io/org/image',
                passwordVar: 'MY_PASS',
              },
              new NoneArtifactProvider()
            )
        ).toThrow('Both usernameVar and passwordVar must be specified together');
      });

      it('throws if explicit env vars are not set (no fallback)', () => {
        // Ensure fallback vars are set but should NOT be used
        process.env.DOCKER_USERNAME = 'fallback-user';
        process.env.DOCKER_PASSWORD = 'fallback-pass';

        expect(
          () =>
            new DockerTarget(
              {
                name: 'docker',
                source: 'ghcr.io/org/image',
                target: 'ghcr.io/org/image',
                usernameVar: 'NONEXISTENT_USER',
                passwordVar: 'NONEXISTENT_PASS',
              },
              new NoneArtifactProvider()
            )
        ).toThrow(
          'Missing credentials: NONEXISTENT_USER and/or NONEXISTENT_PASS environment variable(s) not set'
        );
      });
    });

    describe('Mode B: automatic resolution', () => {
      it('uses registry-derived env vars first', () => {
        process.env.DOCKER_GHCR_IO_USERNAME = 'ghcr-user';
        process.env.DOCKER_GHCR_IO_PASSWORD = 'ghcr-pass';
        process.env.DOCKER_USERNAME = 'default-user';
        process.env.DOCKER_PASSWORD = 'default-pass';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'ghcr.io/org/image',
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.username).toBe('ghcr-user');
        expect(target.dockerConfig.target.credentials!.password).toBe('ghcr-pass');
      });

      it('falls back to GHCR defaults (GITHUB_ACTOR/GITHUB_TOKEN) for ghcr.io', () => {
        process.env.GITHUB_ACTOR = 'github-actor';
        process.env.GITHUB_TOKEN = 'github-token';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'ghcr.io/org/image',
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.username).toBe('github-actor');
        expect(target.dockerConfig.target.credentials!.password).toBe('github-token');
      });

      it('falls back to GITHUB_API_TOKEN for ghcr.io when GITHUB_TOKEN is not set', () => {
        process.env.GITHUB_ACTOR = 'github-actor';
        process.env.GITHUB_API_TOKEN = 'github-api-token';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'ghcr.io/org/image',
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.username).toBe('github-actor');
        expect(target.dockerConfig.target.credentials!.password).toBe('github-api-token');
      });

      it('falls back to x-access-token username for ghcr.io when GITHUB_ACTOR is not set', () => {
        process.env.GITHUB_TOKEN = 'github-token';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'ghcr.io/org/image',
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.username).toBe('x-access-token');
        expect(target.dockerConfig.target.credentials!.password).toBe('github-token');
      });

      it('falls back to x-access-token username for ghcr.io when GITHUB_ACTOR is empty', () => {
        process.env.GITHUB_ACTOR = '';
        process.env.GITHUB_TOKEN = 'github-token';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'ghcr.io/org/image',
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.username).toBe('x-access-token');
        expect(target.dockerConfig.target.credentials!.password).toBe('github-token');
      });

      it('uses x-access-token and GITHUB_API_TOKEN for ghcr.io (app token scenario)', () => {
        // This simulates the getsentry/publish workflow with release bot token
        process.env.GITHUB_API_TOKEN = 'release-bot-token';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'ghcr.io/org/image',
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.username).toBe('x-access-token');
        expect(target.dockerConfig.target.credentials!.password).toBe('release-bot-token');
      });

      it('uses default DOCKER_* env vars for Docker Hub', () => {
        process.env.DOCKER_USERNAME = 'dockerhub-user';
        process.env.DOCKER_PASSWORD = 'dockerhub-pass';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'getsentry/craft',
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.username).toBe('dockerhub-user');
        expect(target.dockerConfig.target.credentials!.password).toBe('dockerhub-pass');
        expect(target.dockerConfig.target.credentials!.registry).toBeUndefined();
      });

      it('treats docker.io as Docker Hub and uses default credentials', () => {
        process.env.DOCKER_USERNAME = 'dockerhub-user';
        process.env.DOCKER_PASSWORD = 'dockerhub-pass';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'docker.io/getsentry/craft',
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.username).toBe('dockerhub-user');
        expect(target.dockerConfig.target.credentials!.password).toBe('dockerhub-pass');
        expect(target.dockerConfig.target.credentials!.registry).toBeUndefined();
      });

      it('treats index.docker.io as Docker Hub and uses default credentials', () => {
        process.env.DOCKER_USERNAME = 'dockerhub-user';
        process.env.DOCKER_PASSWORD = 'dockerhub-pass';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'index.docker.io/getsentry/craft',
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.username).toBe('dockerhub-user');
        expect(target.dockerConfig.target.credentials!.password).toBe('dockerhub-pass');
        expect(target.dockerConfig.target.credentials!.registry).toBeUndefined();
      });

      it('falls back to DOCKER_* when registry-specific vars are not set', () => {
        process.env.DOCKER_USERNAME = 'default-user';
        process.env.DOCKER_PASSWORD = 'default-pass';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'gcr.io/project/image',
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.username).toBe('default-user');
        expect(target.dockerConfig.target.credentials!.password).toBe('default-pass');
      });

      it('falls back to DOCKER_* when registry-specific vars are empty strings', () => {
        process.env.DOCKER_GCR_IO_USERNAME = '';
        process.env.DOCKER_GCR_IO_PASSWORD = '';
        process.env.DOCKER_USERNAME = 'default-user';
        process.env.DOCKER_PASSWORD = 'default-pass';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'gcr.io/project/image',
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.username).toBe('default-user');
        expect(target.dockerConfig.target.credentials!.password).toBe('default-pass');
      });

      it('throws when no credentials are available', () => {
        expect(
          () =>
            new DockerTarget(
              {
                name: 'docker',
                source: 'ghcr.io/org/image',
                target: 'getsentry/craft',
              },
              new NoneArtifactProvider()
            )
        ).toThrow('Cannot perform Docker release: missing credentials');
      });

      it('includes registry-specific hint in error message', () => {
        // Use a non-Google Cloud registry that will require credentials
        expect(
          () =>
            new DockerTarget(
              {
                name: 'docker',
                source: 'ghcr.io/org/image',
                target: 'custom.registry.io/project/image',
              },
              new NoneArtifactProvider()
            )
        ).toThrow('DOCKER_CUSTOM_REGISTRY_IO_USERNAME/PASSWORD');
      });
    });

    describe('registry config override', () => {
      it('uses explicit registry config over auto-detection', () => {
        process.env.DOCKER_GCR_IO_USERNAME = 'gcr-user';
        process.env.DOCKER_GCR_IO_PASSWORD = 'gcr-pass';

        const target = new DockerTarget(
          {
            name: 'docker',
            source: 'ghcr.io/org/image',
            target: 'us.gcr.io/project/image',
            registry: 'gcr.io', // Override to share creds across regions
          },
          new NoneArtifactProvider()
        );

        expect(target.dockerConfig.target.credentials!.registry).toBe('gcr.io');
        expect(target.dockerConfig.target.credentials!.username).toBe('gcr-user');
        expect(target.dockerConfig.target.credentials!.password).toBe('gcr-pass');
      });
    });
  });

  describe('source credential resolution', () => {
    it('resolves source credentials when source registry differs from target', () => {
      process.env.DOCKER_GHCR_IO_USERNAME = 'ghcr-user';
      process.env.DOCKER_GHCR_IO_PASSWORD = 'ghcr-pass';
      process.env.DOCKER_USERNAME = 'dockerhub-user';
      process.env.DOCKER_PASSWORD = 'dockerhub-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/image',
          target: 'getsentry/craft',
        },
        new NoneArtifactProvider()
      );

      // Target should use Docker Hub credentials
      expect(target.dockerConfig.target.credentials!.username).toBe('dockerhub-user');
      expect(target.dockerConfig.target.credentials!.password).toBe('dockerhub-pass');
      expect(target.dockerConfig.target.credentials!.registry).toBeUndefined();

      // Source should use GHCR credentials
      expect(target.dockerConfig.source.credentials).toBeDefined();
      expect(target.dockerConfig.source.credentials?.username).toBe('ghcr-user');
      expect(target.dockerConfig.source.credentials?.password).toBe('ghcr-pass');
      expect(target.dockerConfig.source.credentials?.registry).toBe('ghcr.io');
    });

    it('does not set source credentials when source and target registries are the same', () => {
      process.env.DOCKER_GHCR_IO_USERNAME = 'ghcr-user';
      process.env.DOCKER_GHCR_IO_PASSWORD = 'ghcr-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/source-image',
          target: 'ghcr.io/org/target-image',
        },
        new NoneArtifactProvider()
      );

      expect(target.dockerConfig.source.credentials).toBeUndefined();
    });

    it('uses explicit sourceUsernameVar/sourcePasswordVar for source credentials', () => {
      process.env.MY_SOURCE_USER = 'source-user';
      process.env.MY_SOURCE_PASS = 'source-pass';
      process.env.DOCKER_USERNAME = 'dockerhub-user';
      process.env.DOCKER_PASSWORD = 'dockerhub-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/image',
          target: 'getsentry/craft',
          sourceUsernameVar: 'MY_SOURCE_USER',
          sourcePasswordVar: 'MY_SOURCE_PASS',
        },
        new NoneArtifactProvider()
      );

      expect(target.dockerConfig.source.credentials?.username).toBe('source-user');
      expect(target.dockerConfig.source.credentials?.password).toBe('source-pass');
    });

    it('throws if only sourceUsernameVar is specified', () => {
      process.env.MY_SOURCE_USER = 'source-user';
      process.env.DOCKER_USERNAME = 'dockerhub-user';
      process.env.DOCKER_PASSWORD = 'dockerhub-pass';

      expect(
        () =>
          new DockerTarget(
            {
              name: 'docker',
              source: 'ghcr.io/org/image',
              target: 'getsentry/craft',
              sourceUsernameVar: 'MY_SOURCE_USER',
            },
            new NoneArtifactProvider()
          )
      ).toThrow('Both usernameVar and passwordVar must be specified together');
    });

    it('does not require source credentials if source is assumed public', () => {
      process.env.DOCKER_USERNAME = 'dockerhub-user';
      process.env.DOCKER_PASSWORD = 'dockerhub-pass';
      // No GHCR credentials set - source assumed to be public

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/public-image',
          target: 'getsentry/craft',
        },
        new NoneArtifactProvider()
      );

      // Should not throw, source credentials are optional
      expect(target.dockerConfig.source.credentials).toBeUndefined();
    });

    it('uses sourceRegistry config override', () => {
      process.env.DOCKER_GCR_IO_USERNAME = 'gcr-user';
      process.env.DOCKER_GCR_IO_PASSWORD = 'gcr-pass';
      process.env.DOCKER_USERNAME = 'dockerhub-user';
      process.env.DOCKER_PASSWORD = 'dockerhub-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'us.gcr.io/project/image',
          target: 'getsentry/craft',
          sourceRegistry: 'gcr.io', // Use gcr.io creds for us.gcr.io
        },
        new NoneArtifactProvider()
      );

      expect(target.dockerConfig.source.credentials?.registry).toBe('gcr.io');
      expect(target.dockerConfig.source.credentials?.username).toBe('gcr-user');
      expect(target.dockerConfig.source.credentials?.password).toBe('gcr-pass');
    });
  });

  describe('nested object config format', () => {
    it('supports target as object with image property', () => {
      process.env.DOCKER_GHCR_IO_USERNAME = 'ghcr-user';
      process.env.DOCKER_GHCR_IO_PASSWORD = 'ghcr-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/source-image',
          target: {
            image: 'ghcr.io/org/target-image',
          },
        },
        new NoneArtifactProvider()
      );

      expect(target.dockerConfig.target.image).toBe('ghcr.io/org/target-image');
      expect(target.dockerConfig.target.credentials!.registry).toBe('ghcr.io');
    });

    it('supports source as object with image property', () => {
      process.env.DOCKER_GHCR_IO_USERNAME = 'ghcr-user';
      process.env.DOCKER_GHCR_IO_PASSWORD = 'ghcr-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: {
            image: 'ghcr.io/org/source-image',
          },
          target: 'ghcr.io/org/target-image',
        },
        new NoneArtifactProvider()
      );

      expect(target.dockerConfig.source.image).toBe('ghcr.io/org/source-image');
    });

    it('supports both source and target as objects', () => {
      process.env.DOCKER_GHCR_IO_USERNAME = 'ghcr-user';
      process.env.DOCKER_GHCR_IO_PASSWORD = 'ghcr-pass';
      process.env.DOCKER_USERNAME = 'dockerhub-user';
      process.env.DOCKER_PASSWORD = 'dockerhub-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: {
            image: 'ghcr.io/org/source-image',
          },
          target: {
            image: 'getsentry/craft',
          },
        },
        new NoneArtifactProvider()
      );

      expect(target.dockerConfig.source.image).toBe('ghcr.io/org/source-image');
      expect(target.dockerConfig.target.image).toBe('getsentry/craft');
    });

    it('uses registry from object config', () => {
      process.env.DOCKER_GCR_IO_USERNAME = 'gcr-user';
      process.env.DOCKER_GCR_IO_PASSWORD = 'gcr-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/source-image',
          target: {
            image: 'us.gcr.io/project/image',
            registry: 'gcr.io', // Override to share creds across regions
          },
        },
        new NoneArtifactProvider()
      );

      expect(target.dockerConfig.target.credentials!.registry).toBe('gcr.io');
      expect(target.dockerConfig.target.credentials!.username).toBe('gcr-user');
    });

    it('uses usernameVar/passwordVar from object config', () => {
      process.env.MY_TARGET_USER = 'target-user';
      process.env.MY_TARGET_PASS = 'target-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/source-image',
          target: {
            image: 'getsentry/craft',
            usernameVar: 'MY_TARGET_USER',
            passwordVar: 'MY_TARGET_PASS',
          },
        },
        new NoneArtifactProvider()
      );

      expect(target.dockerConfig.target.credentials!.username).toBe('target-user');
      expect(target.dockerConfig.target.credentials!.password).toBe('target-pass');
    });

    it('uses format from object config', () => {
      process.env.DOCKER_USERNAME = 'user';
      process.env.DOCKER_PASSWORD = 'pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: {
            image: 'ghcr.io/org/source-image',
            format: '{{{source}}}:sha-{{{revision}}}',
          },
          target: {
            image: 'getsentry/craft',
            format: '{{{target}}}:v{{{version}}}',
          },
        },
        new NoneArtifactProvider()
      );

      expect(target.dockerConfig.source.format).toBe(
        '{{{source}}}:sha-{{{revision}}}'
      );
      expect(target.dockerConfig.target.format).toBe(
        '{{{target}}}:v{{{version}}}'
      );
    });

    it('supports source object with credentials for cross-registry publishing', () => {
      process.env.MY_SOURCE_USER = 'source-user';
      process.env.MY_SOURCE_PASS = 'source-pass';
      process.env.DOCKER_USERNAME = 'dockerhub-user';
      process.env.DOCKER_PASSWORD = 'dockerhub-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: {
            image: 'ghcr.io/org/private-image',
            usernameVar: 'MY_SOURCE_USER',
            passwordVar: 'MY_SOURCE_PASS',
          },
          target: 'getsentry/craft',
        },
        new NoneArtifactProvider()
      );

      expect(target.dockerConfig.source.credentials?.username).toBe('source-user');
      expect(target.dockerConfig.source.credentials?.password).toBe('source-pass');
      expect(target.dockerConfig.target.credentials!.username).toBe('dockerhub-user');
    });
  });

  describe('login', () => {
    it('passes registry to docker login command', async () => {
      process.env.DOCKER_GHCR_IO_USERNAME = 'user';
      process.env.DOCKER_GHCR_IO_PASSWORD = 'pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/image',
          target: 'ghcr.io/org/image',
        },
        new NoneArtifactProvider()
      );

      await target.login();

      expect(system.spawnProcess).toHaveBeenCalledWith(
        'docker',
        ['login', '--username=user', '--password-stdin', 'ghcr.io'],
        {},
        { stdin: 'pass' }
      );
    });

    it('omits registry for Docker Hub', async () => {
      process.env.DOCKER_USERNAME = 'user';
      process.env.DOCKER_PASSWORD = 'pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/image',
          target: 'getsentry/craft',
        },
        new NoneArtifactProvider()
      );

      await target.login();

      expect(system.spawnProcess).toHaveBeenCalledWith(
        'docker',
        ['login', '--username=user', '--password-stdin'],
        {},
        { stdin: 'pass' }
      );
    });

    it('uses password-stdin for security', async () => {
      process.env.DOCKER_USERNAME = 'user';
      process.env.DOCKER_PASSWORD = 'secret-password';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/image',
          target: 'getsentry/craft',
        },
        new NoneArtifactProvider()
      );

      await target.login();

      // Verify password is passed via stdin, not command line
      const callArgs = vi.mocked(system.spawnProcess).mock.calls[0];
      expect(callArgs[1]).not.toContain('--password=secret-password');
      expect(callArgs[1]).toContain('--password-stdin');
      expect(callArgs[3]).toEqual({ stdin: 'secret-password' });
    });

    it('logs into both source and target registries for cross-registry publishing', async () => {
      process.env.DOCKER_GHCR_IO_USERNAME = 'ghcr-user';
      process.env.DOCKER_GHCR_IO_PASSWORD = 'ghcr-pass';
      process.env.DOCKER_USERNAME = 'dockerhub-user';
      process.env.DOCKER_PASSWORD = 'dockerhub-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/image',
          target: 'getsentry/craft',
        },
        new NoneArtifactProvider()
      );

      await target.login();

      // Should login to both registries
      expect(system.spawnProcess).toHaveBeenCalledTimes(2);

      // First call: login to source (GHCR)
      expect(system.spawnProcess).toHaveBeenNthCalledWith(
        1,
        'docker',
        ['login', '--username=ghcr-user', '--password-stdin', 'ghcr.io'],
        {},
        { stdin: 'ghcr-pass' }
      );

      // Second call: login to target (Docker Hub)
      expect(system.spawnProcess).toHaveBeenNthCalledWith(
        2,
        'docker',
        ['login', '--username=dockerhub-user', '--password-stdin'],
        {},
        { stdin: 'dockerhub-pass' }
      );
    });

    it('only logs into target when source has no credentials (public source)', async () => {
      process.env.DOCKER_USERNAME = 'dockerhub-user';
      process.env.DOCKER_PASSWORD = 'dockerhub-pass';
      // No GHCR credentials - source is public

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/public-image',
          target: 'getsentry/craft',
        },
        new NoneArtifactProvider()
      );

      await target.login();

      // Should only login to Docker Hub
      expect(system.spawnProcess).toHaveBeenCalledTimes(1);
      expect(system.spawnProcess).toHaveBeenCalledWith(
        'docker',
        ['login', '--username=dockerhub-user', '--password-stdin'],
        {},
        { stdin: 'dockerhub-pass' }
      );
    });

    it('only logs in once when source and target are same registry', async () => {
      process.env.DOCKER_GHCR_IO_USERNAME = 'ghcr-user';
      process.env.DOCKER_GHCR_IO_PASSWORD = 'ghcr-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/source-image',
          target: 'ghcr.io/org/target-image',
        },
        new NoneArtifactProvider()
      );

      await target.login();

      // Should only login once
      expect(system.spawnProcess).toHaveBeenCalledTimes(1);
      expect(system.spawnProcess).toHaveBeenCalledWith(
        'docker',
        ['login', '--username=ghcr-user', '--password-stdin', 'ghcr.io'],
        {},
        { stdin: 'ghcr-pass' }
      );
    });

    it('skips login when target.skipLogin is true', async () => {
      // No credentials set - would normally throw

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/image',
          target: {
            image: 'us.gcr.io/project/image',
            skipLogin: true, // Auth handled externally (e.g., gcloud workload identity)
          },
        },
        new NoneArtifactProvider()
      );

      await target.login();

      // Should not attempt any login
      expect(system.spawnProcess).not.toHaveBeenCalled();
    });

    it('skips login when source.skipLogin is true', async () => {
      process.env.DOCKER_USERNAME = 'dockerhub-user';
      process.env.DOCKER_PASSWORD = 'dockerhub-pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: {
            image: 'us.gcr.io/project/image',
            skipLogin: true, // Auth handled externally
          },
          target: 'getsentry/craft',
        },
        new NoneArtifactProvider()
      );

      await target.login();

      // Should only login to target (Docker Hub)
      expect(system.spawnProcess).toHaveBeenCalledTimes(1);
      expect(system.spawnProcess).toHaveBeenCalledWith(
        'docker',
        ['login', '--username=dockerhub-user', '--password-stdin'],
        {},
        { stdin: 'dockerhub-pass' }
      );
    });

    it('skips login for both when both have skipLogin', async () => {
      const target = new DockerTarget(
        {
          name: 'docker',
          source: {
            image: 'us.gcr.io/project/source',
            skipLogin: true,
          },
          target: {
            image: 'us.gcr.io/project/target',
            skipLogin: true,
          },
        },
        new NoneArtifactProvider()
      );

      await target.login();

      // Should not attempt any login
      expect(system.spawnProcess).not.toHaveBeenCalled();
    });

    it('auto-configures gcloud for GCR registries when credentials are available', async () => {
      // Set up gcloud credentials
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';
      vi.mocked(mockFs.existsSync).mockReturnValue(true);

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/image',
          target: 'gcr.io/project/image',
        },
        new NoneArtifactProvider()
      );

      await target.login();

      // Should call gcloud auth configure-docker
      expect(system.spawnProcess).toHaveBeenCalledWith(
        'gcloud',
        ['auth', 'configure-docker', 'gcr.io', '--quiet'],
        {},
        {}
      );
    });

    it('auto-configures gcloud for Artifact Registry (pkg.dev)', async () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';
      vi.mocked(mockFs.existsSync).mockReturnValue(true);

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/image',
          target: 'us-docker.pkg.dev/project/repo/image',
        },
        new NoneArtifactProvider()
      );

      await target.login();

      // Should call gcloud auth configure-docker with Artifact Registry
      expect(system.spawnProcess).toHaveBeenCalledWith(
        'gcloud',
        ['auth', 'configure-docker', 'us-docker.pkg.dev', '--quiet'],
        {},
        {}
      );
    });

    it('configures multiple GCR registries in one call', async () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';
      vi.mocked(mockFs.existsSync).mockReturnValue(true);

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'us.gcr.io/project/source',
          target: 'eu.gcr.io/project/target',
        },
        new NoneArtifactProvider()
      );

      await target.login();

      // Should configure both registries in one call
      expect(system.spawnProcess).toHaveBeenCalledWith(
        'gcloud',
        ['auth', 'configure-docker', 'us.gcr.io,eu.gcr.io', '--quiet'],
        {},
        {}
      );
    });

    it('skips gcloud configuration when no credentials are available', async () => {
      // No credentials set, fs.existsSync returns false
      vi.mocked(mockFs.existsSync).mockReturnValue(false);

      // Use Docker Hub as target (requires DOCKER_USERNAME/PASSWORD)
      process.env.DOCKER_USERNAME = 'user';
      process.env.DOCKER_PASSWORD = 'pass';

      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'gcr.io/project/image',
          target: 'getsentry/craft',
        },
        new NoneArtifactProvider()
      );

      await target.login();

      // Should not call gcloud, only docker login
      expect(system.spawnProcess).not.toHaveBeenCalledWith(
        'gcloud',
        expect.any(Array),
        expect.any(Object),
        expect.any(Object)
      );
      expect(system.spawnProcess).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining(['login']),
        {},
        expect.any(Object)
      );
    });

    it('does not require credentials for GCR registries at config time', () => {
      // This should not throw even though no credentials are set
      // because GCR registries can use gcloud auth
      const target = new DockerTarget(
        {
          name: 'docker',
          source: 'ghcr.io/org/image',
          target: 'gcr.io/project/image',
        },
        new NoneArtifactProvider()
      );

      expect(target.dockerConfig.target.credentials).toBeUndefined();
    });
  });
});
