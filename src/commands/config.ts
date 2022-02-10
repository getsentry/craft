import { getConfiguration, getGlobalGitHubConfig } from '../config';
import { formatJson } from '../utils/strings';

export const command = ['config'];
export const description =
  'Print the parsed, processed, and validated Craft config for the current project in pretty-JSON.';

export async function handler(): Promise<void> {
  const github = await getGlobalGitHubConfig();
  const config = {
    ...getConfiguration(),
    github,
  };
  console.log(formatJson(config));
}
