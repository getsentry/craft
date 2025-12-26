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
  /** Base branch/ref for PR comparison (to identify which commits to highlight) */
  base?: string;
}

export const builder: CommandBuilder = (yargs: Argv) =>
  yargs
    .option('since', {
      alias: 's',
      description:
        'Base revision (tag or SHA) to generate changelog from. Defaults to latest tag.',
      type: 'string',
    })
    .option('base', {
      alias: 'b',
      description:
        'Base branch/ref for highlighting PR commits. Commits between --base and HEAD will be highlighted.',
      type: 'string',
    });

/**
 * Body of 'changelog' command
 */
export async function changelogMain(argv: ChangelogOptions): Promise<void> {
  const git = await getGitClient();

  // Determine base revision for changelog generation
  let since = argv.since;
  if (!since) {
    since = await getLatestTag(git);
    if (since) {
      logger.debug(`Using latest tag as base revision: ${since}`);
    } else {
      logger.debug('No tags found, generating changelog from beginning of history');
    }
  }

  // Get commits to highlight (commits in HEAD but not in base)
  let highlightCommits: Set<string> | undefined;
  if (argv.base) {
    try {
      // Get commits that are in HEAD but not in base (i.e., PR-specific commits)
      const logOutput = await git.raw([
        'log',
        '--format=%H',
        `${argv.base}..HEAD`,
        '--',
        '.',
      ]);
      const commits = logOutput.trim().split('\n').filter(Boolean);
      if (commits.length > 0) {
        highlightCommits = new Set(commits);
        logger.debug(`Found ${commits.length} commits to highlight from PR`);
      }
    } catch (error) {
      logger.warn(`Failed to get PR commits from base "${argv.base}":`, error);
    }
  }

  // Generate changelog with optional commit highlighting
  const result = await generateChangelogWithHighlight(git, since, highlightCommits);

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
