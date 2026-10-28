import type { SimpleGit } from 'simple-git';
import { Argv, CommandBuilder } from 'yargs';

import { logger } from '../logger';
import {
  findConfigFile,
  getActiveWorkspace,
  getGitTagPrefix,
  getVersioningPolicy,
  getWorkspaceNames,
  setActiveWorkspace,
} from '../config';
import { getGitClient, getLatestTag } from '../utils/git';
import {
  BUMP_TYPES,
  type BumpType,
  type ChangelogResult,
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

/** The changelog preview of a PR for one workspace it lands in */
interface WorkspacePreview {
  name: string;
  versioningPolicy: string;
  result: ChangelogResult;
}

/**
 * Body of 'changelog' command
 */
export async function changelogMain(argv: ChangelogOptions): Promise<void> {
  const git = await getGitClient();

  // Without a selected workspace, preview a PR in every workspace it lands in.
  const workspaces = argv.pr && !getActiveWorkspace() ? listWorkspaces() : [];
  if (argv.pr && workspaces.length > 0) {
    const previews = await previewInWorkspaces(
      git,
      workspaces,
      argv.pr,
      argv.since,
    );
    printWorkspacePreviews(previews, argv.format);
    return;
  }

  const since = argv.since ?? (await getDefaultBase(git));

  // Generate changelog - use different function depending on whether PR is specified
  const result = argv.pr
    ? await generateChangelogWithHighlight(git, since, argv.pr)
    : await generateChangesetFromGit(git, since);

  // Output based on format
  if (argv.format === 'json') {
    const output = {
      changelog: result.changelog || '',
      bumpType: result.bumpType,
      // Lets consumers (e.g. the changelog-preview workflow) tailor their display
      versioningPolicy: readVersioningPolicy(),
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

/**
 * Returns the latest tag to generate the changelog from, or an empty string
 * when there are no tags.
 */
async function getDefaultBase(git: SimpleGit): Promise<string> {
  // Scope the latest-tag lookup to the configured tag prefix (if any) so
  // monorepos with interleaved product tags (e.g. `cli@`, `mcp@`) resolve
  // the correct base. Only read the prefix when a config file is present;
  // the changelog command can run standalone without one. A broken or
  // unreadable .craft.yml must not abort a standalone changelog run (which
  // otherwise needs only git history), so fall back to no prefix on error.
  let tagPrefix = '';
  try {
    if (findConfigFile()) {
      tagPrefix = getGitTagPrefix();
    }
  } catch {
    // If config can't be read, generate from the latest unprefixed tag.
    logger.debug(
      'Could not read tag prefix from config; using latest tag overall',
    );
  }
  const since = await getLatestTag(git, tagPrefix);
  if (since) {
    logger.debug(`Using latest tag as base revision: ${since}`);
  } else {
    logger.debug(
      'No tags found, generating changelog from beginning of history',
    );
  }
  return since;
}

/**
 * Reads the versioning policy from .craft.yml, defaulting to 'auto' (semver
 * behavior) when there is no readable config.
 */
function readVersioningPolicy(): string {
  try {
    if (findConfigFile()) {
      return getVersioningPolicy();
    }
  } catch {
    // Fall through to the default
  }
  return 'auto';
}

/**
 * Lists the configured workspaces, or none when there is no readable config.
 */
function listWorkspaces(): string[] {
  try {
    return findConfigFile() ? getWorkspaceNames() : [];
  } catch {
    // An unreadable config falls back to the single-changelog preview,
    // which reports the configuration error itself.
    return [];
  }
}

/**
 * Previews a PR in each workspace, keeping only the workspaces whose
 * changelog would list it.
 */
async function previewInWorkspaces(
  git: SimpleGit,
  workspaces: string[],
  pr: number,
  since: string | undefined,
): Promise<WorkspacePreview[]> {
  const previews: WorkspacePreview[] = [];
  try {
    for (const name of workspaces) {
      setActiveWorkspace(name);
      const result = await generateChangelogWithHighlight(
        git,
        since ?? (await getDefaultBase(git)),
        pr,
      );
      if (!result.prOutsideWorkspace) {
        previews.push({
          name,
          versioningPolicy: readVersioningPolicy(),
          result,
        });
      }
    }
  } finally {
    setActiveWorkspace(undefined);
  }
  return previews;
}

function printWorkspacePreviews(
  previews: WorkspacePreview[],
  format: OutputFormat | undefined,
): void {
  if (format === 'json') {
    const bumpTypes = previews
      .map(({ result }) => result.bumpType)
      .filter((bumpType): bumpType is BumpType => bumpType !== null)
      .sort((a, b) => BUMP_TYPES.get(a)! - BUMP_TYPES.get(b)!);
    const policies = new Set(previews.map(p => p.versioningPolicy));
    const output = {
      // The PR's entry reads the same in every workspace, so show it once
      changelog: previews.find(p => p.result.prEntry)?.result.prEntry ?? '',
      bumpType: bumpTypes[0] ?? null,
      versioningPolicy: policies.size === 1 ? [...policies][0] : 'auto',
      prSkipped: previews.some(p => p.result.prSkipped),
      workspaces: previews.map(({ name, versioningPolicy, result }) => ({
        name,
        bumpType: result.bumpType,
        versioningPolicy,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (previews.length === 0) {
    console.log('This PR is not listed in any workspace changelog.');
    return;
  }
  for (const { name, result } of previews) {
    console.log(`# ${name}\n`);
    console.log(
      result.prSkipped
        ? 'This PR will not appear in the changelog.\n'
        : `${result.changelog || 'No changelog entries found.'}\n`,
    );
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
