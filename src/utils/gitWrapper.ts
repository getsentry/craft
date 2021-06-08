import simpleGit, { SimpleGit } from 'simple-git';
import {
  GithubRemote,
  getGithubClient,
  getAuthUsername,
  getGithubApiToken,
} from './githubApi';
import * as Github from '@octokit/rest';

export class GitWrapper {
  private github: Github;
  private remote: GithubRemote;
  private authUsername = '';
  private git: SimpleGit;
  private directory: string;

  public constructor(owner: string, repo: string, directory: string) {
    this.github = getGithubClient();
    this.remote = new GithubRemote(owner, repo);
    this.directory = directory;
    this.git = simpleGit(directory);
  }

  public async setAuth(): Promise<void> {
    this.authUsername = await getAuthUsername(this.github);
    this.remote.setAuth(this.authUsername, getGithubApiToken());
  }

  public async clone(): Promise<void> {
    await this.git.clone(this.remote.getRemoteStringWithAuth(), this.directory);
  }

  public async checkout(branchName: string): Promise<void> {
    await this.git.checkout(branchName);
  }
}
