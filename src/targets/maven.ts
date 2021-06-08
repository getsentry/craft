import { TargetConfig } from '../schemas/project_config';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { BaseTarget } from './base';
import { ConfigurationError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { GitWrapper } from '../utils/gitWrapper';

// TODO: add docs to the readme

const GIT_REPO_OWNER = 'getsentry';
const GIT_REPO_NAME = 'sentry-java';

/** Config options for the "maven" target. */
interface MavenTargetConfig {
  ossrhUsername: string; // env var: OSSRH_USERNAME
  ossrhPassword: string; // env var: OSSRH_PASSWORD
  mavenUsername: string; // env var: MAVEN_CENTRAL_USERNAME
  mavenPassword: string; // env var: MAVEN_CENTRAL_PASSWORD
}

/**
 * Target responsible for uploading files to Maven Central.
 */
export class MavenTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'maven';
  /** Target options */
  public readonly mavenConfig: MavenTargetConfig | undefined; // TODO: remove `undefined` when using actual config

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    // this.mavenConfig = this.getMavenConfig();
    console.log('got maven config');
  }

  private getMavenConfig(): MavenTargetConfig {
    return {
      ossrhUsername: this.getEnvVarValue('OSSRH_USERNAME'),
      ossrhPassword: this.getEnvVarValue('OSSRH_PASSWORD'),
      mavenUsername: this.getEnvVarValue('MAVEN_CENTRAL_USERNAME'),
      mavenPassword: this.getEnvVarValue('MAVEN_CENTRAL_PASSWORD'),
    };
  }

  private getEnvVarValue(envVar: string): string {
    if (process.env['envVar']) {
      return process.env['envVar'];
    }
    throw new ConfigurationError(
      `Cannot publish to Maven Central: missing credentials.
      Please, use the ${envVar} environment variable.`
    );
  }

  public async publish(_version: string, _revison: string): Promise<void> {
    console.log('publish step on maven target');
    await withTempDir(
      async dir => {
        console.log(`tmp dir: ${dir}`);
        const git = new GitWrapper(GIT_REPO_OWNER, GIT_REPO_NAME, dir);
        await git.setAuth();
        await git.clone();
        console.log('cloned');
      },
      false, // TODO: set cleanup to true in production
      'craft-release-maven-' // Not making global since the directoy is supposed to be removed.
    );
  }
}
