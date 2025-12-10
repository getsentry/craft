import {
  DockerTarget,
  extractRegistry,
  registryToEnvPrefix,
} from '../docker';
import { NoneArtifactProvider } from '../../artifact_providers/none';
import * as system from '../../utils/system';

jest.mock('../../utils/system', () => ({
  ...jest.requireActual('../../utils/system'),
  checkExecutableIsPresent: jest.fn(),
  spawnProcess: jest.fn().mockResolvedValue(Buffer.from('')),
}));

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
    expect(extractRegistry('docker.io/library/nginx')).toBe('docker.io');
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

describe('DockerTarget', () => {
  const oldEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear all Docker-related env vars
    delete process.env.DOCKER_USERNAME;
    delete process.env.DOCKER_PASSWORD;
    delete process.env.DOCKER_GHCR_IO_USERNAME;
    delete process.env.DOCKER_GHCR_IO_PASSWORD;
    delete process.env.DOCKER_GCR_IO_USERNAME;
    delete process.env.DOCKER_GCR_IO_PASSWORD;
    delete process.env.GITHUB_ACTOR;
    delete process.env.GITHUB_TOKEN;
  });

  afterAll(() => {
    process.env = { ...oldEnv };
  });

  describe('credential resolution', () => {
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

        expect(target.dockerConfig.username).toBe('custom-user');
        expect(target.dockerConfig.password).toBe('custom-pass');
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

        expect(target.dockerConfig.username).toBe('ghcr-user');
        expect(target.dockerConfig.password).toBe('ghcr-pass');
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

        expect(target.dockerConfig.username).toBe('github-actor');
        expect(target.dockerConfig.password).toBe('github-token');
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

        expect(target.dockerConfig.username).toBe('dockerhub-user');
        expect(target.dockerConfig.password).toBe('dockerhub-pass');
        expect(target.dockerConfig.registry).toBeUndefined();
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

        expect(target.dockerConfig.username).toBe('default-user');
        expect(target.dockerConfig.password).toBe('default-pass');
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
        expect(
          () =>
            new DockerTarget(
              {
                name: 'docker',
                source: 'ghcr.io/org/image',
                target: 'gcr.io/project/image',
              },
              new NoneArtifactProvider()
            )
        ).toThrow('DOCKER_GCR_IO_USERNAME/PASSWORD');
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

        expect(target.dockerConfig.registry).toBe('gcr.io');
        expect(target.dockerConfig.username).toBe('gcr-user');
        expect(target.dockerConfig.password).toBe('gcr-pass');
      });
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
      const callArgs = (system.spawnProcess as jest.Mock).mock.calls[0];
      expect(callArgs[1]).not.toContain('--password=secret-password');
      expect(callArgs[1]).toContain('--password-stdin');
      expect(callArgs[3]).toEqual({ stdin: 'secret-password' });
    });
  });
});
