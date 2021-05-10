import { getConfiguration, getGlobalGithubConfig } from '../config';
import { formatJson } from '../utils/strings';

export const command = ['config'];
export const description = 'List defined targets as JSON array';

export async function handler(): Promise<void> {
  const github = await getGlobalGithubConfig();
  const config = {
    ...getConfiguration(),
    github,
  };
  console.log(formatJson(config));
}
