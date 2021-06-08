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
  private username = '';
  private git: SimpleGit;
  private directory: string;

  public constructor(owner: string, repo: string, directory: string) {
    this.github = getGithubClient();
    this.remote = new GithubRemote(owner, repo);
    this.directory = directory;
    this.git = simpleGit(directory);
  }

  public async init(): Promise<void> {
    this.username = await getAuthUsername(this.github);
    this.remote.setAuth(this.username, getGithubApiToken());
  }

  public async clone(): Promise<void> {
    await this.git.clone(this.remote.getRemoteStringWithAuth(), this.directory);
  }
}
