import { GithubGlobalConfig } from '../schemas/project_config';

export function getGlobalGithubConfig(): GithubGlobalConfig {
  return {
    owner: 'test-owner',
    repo: 'test-repo',
  };
}
