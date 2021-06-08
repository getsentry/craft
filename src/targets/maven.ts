import { TargetConfig } from '../schemas/project_config';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { BaseTarget } from './base';
import { ConfigurationError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { GitWrapper } from '../utils/gitWrapper';
import { exec } from 'child_process';
import { isDryRun } from '../utils/helpers';

// TODO: add docs to the readme

const GIT_REPO_OWNER = 'getsentry';
const GIT_REPO_NAME = 'sentry-java';
const CHECK_BUILD_CMD = 'make all';
const DEPLOY_CMD = 'make doReleasee'; // FIXME: added an additional `e` at the end to prevent accidental deploys
const FILES_TO_COMMIT = ['gradle.properties'];

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

  public async publish(version: string, _revison: string): Promise<void> {
    console.log('publish step on maven target');
    await withTempDir(
      async dir => {
        console.log(`tmp dir: ${dir}`);
        const git = new GitWrapper(GIT_REPO_OWNER, GIT_REPO_NAME, dir);
        await git.setAuth();
        await git.clone();
        await git.checkout(`release/${version}`); // TODO: this should be customized
        execCmd(dir, CHECK_BUILD_CMD); // TODO: takes a lot of time, add an option to skip this step
        execCmd(dir, DEPLOY_CMD); // GPG signing is done in this step
        git.add(FILES_TO_COMMIT);
        git.commit(`craft(maven): Deployed ${version} to Maven Central.`);
        if (this.shouldPush()) {
          await git.push();
        }
        console.log('cloned');
      },
      false, // TODO: set cleanup to true in production
      'craft-release-maven-' // Not making global since the directoy is supposed to be removed.
    );
  }

  private shouldPush(): boolean {
    if (isDryRun()) {
      this.logger.info('[dry-run] Not pushing the branch.');
      return false;
    }
    return true;
  }
}

function execCmd(workDir: string, command: string): void {
  exec(command, { cwd: workDir }, error => {
    if (error) {
      throw new Error(`Error executing ${command}:` + error);
    }
  });
}
