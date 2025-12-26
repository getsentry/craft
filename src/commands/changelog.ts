import { Argv, CommandBuilder } from 'yargs';

import { logger } from '../logger';
import { getGitClient, getLatestTag } from '../utils/git';
import { generateChangelogWithHighlight } from '../utils/changelog';
import { handleGlobalError } from '../utils/errors';

export const command = ['changelog'];
export const description = 'Generate changelog from git history';

/** Command line options */
interface ChangelogOptions {
  /** Base revision to generate changelog from (defaults to latest tag) */
  since?: string;
  /** PR number to highlight in the output */
  pr?: number;
}

export const builder: CommandBuilder = (yargs: Argv) =>
  yargs
    .option('since', {
      alias: 's',
      description:
        'Base revision (tag or SHA) to generate changelog from. Defaults to latest tag.',
      type: 'string',
    })
    .option('pr', {
      description:
        'PR number to highlight in the output. Entries from this PR will be rendered as blockquotes.',
      type: 'number',
    });

/**
 * Body of 'changelog' command
 */
export async function changelogMain(argv: ChangelogOptions): Promise<void> {
  const git = await getGitClient();

  // Determine base revision
  let since = argv.since;
  if (!since) {
    since = await getLatestTag(git);
    if (since) {
      logger.debug(`Using latest tag as base revision: ${since}`);
    } else {
      logger.debug('No tags found, generating changelog from beginning of history');
    }
  }

  // Generate changelog with optional PR highlighting
  const highlightPR = argv.pr ? String(argv.pr) : undefined;
  const result = await generateChangelogWithHighlight(git, since, highlightPR);

  if (!result.changelog) {
    console.log('No changelog entries found.');
    return;
  }

  // Output to stdout
  console.log(result.changelog);
}

export const handler = async (args: {
  [argName: string]: any;
}): Promise<void> => {
  try {
    return await changelogMain(args as ChangelogOptions);
  } catch (e) {
    handleGlobalError(e);
  }
};
