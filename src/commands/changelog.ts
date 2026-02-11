import { Argv, CommandBuilder } from 'yargs';

import { logger } from '../logger';
import { findConfigFile, getVersioningPolicy } from '../config';
import { getGitClient, getLatestTag } from '../utils/git';
import {
  generateChangesetFromGit,
  generateChangelogWithHighlight,
} from '../utils/changelog';
import { handleGlobalError } from '../utils/errors';

export const command = ['changelog'];
export const description = 'Generate changelog from git history';

/** Output format options */
type OutputFormat = 'text' | 'json';

/** Command line options */
interface ChangelogOptions {
  /** Base revision to generate changelog from (defaults to latest tag) */
  since?: string;
  /** PR number for the current (unmerged) PR */
  pr?: number;
  /** Output format: text (default) or json */
  format?: OutputFormat;
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
        'PR number for the current (unmerged) PR. The PR info will be fetched from GitHub API and the PR included in the changelog with highlighting.',
      type: 'number',
    })
    .option('format', {
      alias: 'f',
      description: 'Output format: text (default) or json',
      type: 'string',
      choices: ['text', 'json'] as const,
      default: 'text',
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
      logger.debug(
        'No tags found, generating changelog from beginning of history',
      );
    }
  }

  // Generate changelog - use different function depending on whether PR is specified
  const result = argv.pr
    ? await generateChangelogWithHighlight(git, since, argv.pr)
    : await generateChangesetFromGit(git, since);

  // Output based on format
  if (argv.format === 'json') {
    // Detect the versioning policy from .craft.yml so consumers (e.g. the
    // changelog-preview workflow) can tailor their display accordingly.
    let versioningPolicy = 'auto';
    try {
      if (findConfigFile()) {
        versioningPolicy = getVersioningPolicy();
      }
    } catch {
      // If config can't be read, default to 'auto' (semver behavior)
    }

    const output = {
      changelog: result.changelog || '',
      bumpType: result.bumpType,
      versioningPolicy,
      totalCommits: result.totalCommits,
      matchedCommitsWithSemver: result.matchedCommitsWithSemver,
      prSkipped: result.prSkipped ?? false,
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    if (!result.changelog) {
      console.log('No changelog entries found.');
      return;
    }
    console.log(result.changelog);
  }
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
