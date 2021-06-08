import { TargetConfig } from '../schemas/project_config';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { BaseTarget } from './base';
import { ConfigurationError } from '../utils/errors';
import { withTempDir } from '../utils/files';
import { isDryRun } from '../utils/helpers';
import * as Github from '@octokit/rest';
import {
  getAuthUsername,
  getGithubApiToken,
  getGithubClient,
  GithubRemote,
} from '../utils/githubApi';
import simpleGit from 'simple-git';
import { homedir } from 'os';
import { join } from 'path';
import * as fs from 'fs';

// TODO: add docs to the readme

const GIT_REPO_OWNER = 'getsentry';
const GIT_REPO_NAME = 'sentry-java';
const FILES_TO_COMMIT = ['gradle.properties'];

const USER_GRADLE_PROPS_FILE = join(homedir(), '/.gradle/gradle.properties');

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
  /** GitHub client. */
  public readonly github: Github;
  /** GitHub remote. */
  public readonly githubRemote: GithubRemote;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    // this.mavenConfig = this.getMavenConfig();
    console.log('got maven config');
    this.github = getGithubClient();
    this.githubRemote = new GithubRemote(GIT_REPO_OWNER, GIT_REPO_NAME);
  }

  private getMavenConfig(): MavenTargetConfig {
    return {
      ossrhUsername: this.getEnvVarValue('OSSRH_USERNAME'),
      ossrhPassword: this.getEnvVarValue('OSSRH_PASSWORD'),
      // MAVEN_CENTRAL_* shouldnt be required if the user already has `gradle.properties`
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
    await withTempDir(
      async dir => {
        console.log(`tmp dir: ${dir}`);

        const git = simpleGit(dir);
        const username = await getAuthUsername(this.github);
        this.githubRemote.setAuth(username, getGithubApiToken());
        await git.clone(this.githubRemote.getRemoteStringWithAuth(), dir);
        await git.checkout(`release/${version}`); // TODO: release name should be customized

        await this.createUserGradlePropsFile();

        await git.add(FILES_TO_COMMIT);
        await git.commit(`craft(maven): Deployed ${version} to Maven Central.`);
        if (this.shouldPush()) {
          await git.push();
        }
      },
      false, // TODO: set cleanup to true in production
      'craft-release-maven-' // Not making global since the directoy is supposed to be removed.
    );
  }

  private async createUserGradlePropsFile(): Promise<void> {
    // TODO: set option to use current file, instead of always overwriting it
    fs.writeFileSync(
      USER_GRADLE_PROPS_FILE,
      // Using `` instead of string concatenation makes all the lines but the
      // first one to be indented to the right. To avoid that, these lines
      // shouldn't have that much space at the beginning, something the linter
      // doesn't agree with (and the code would be harder to read).
      `mavenCentralUsername=${this.mavenConfig?.mavenUsername}\n` +
        `mavenCentralPassword=${this.mavenConfig?.mavenPassword}`
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
