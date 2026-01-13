import { existsSync, promises as fsPromises } from 'fs';
import { join, relative } from 'path';

import { safeFs, createDryRunIsolation } from '../utils/dryRun';
import * as shellQuote from 'shell-quote';
import { SimpleGit, StatusResult } from 'simple-git';
import { Arguments, Argv, CommandBuilder } from 'yargs';

import {
  getConfiguration,
  DEFAULT_RELEASE_BRANCH_NAME,
  getGlobalGitHubConfig,
  requiresMinVersion,
  loadConfigurationFromString,
  CONFIG_FILE_NAME,
  getVersioningPolicy,
} from '../config';
import { logger } from '../logger';
import { ChangelogPolicy, VersioningPolicy } from '../schemas/project_config';
import { calculateCalVer, DEFAULT_CALVER_CONFIG } from '../utils/calver';
import { sleep } from '../utils/async';
import {
  DEFAULT_CHANGELOG_PATH,
  DEFAULT_UNRELEASED_TITLE,
  findChangeset,
  removeChangeset,
  prependChangeset,
  generateChangesetFromGit,
} from '../utils/changelog';
import {
  ConfigurationError,
  handleGlobalError,
  reportError,
} from '../utils/errors';
import {
  getGitClient,
  getDefaultBranch,
  getLatestTag,
  isRepoDirty,
} from '../utils/git';
import {
  getChangelogWithBumpType,
  calculateNextVersion,
  validateBumpType,
  isBumpType,
  type BumpType,
} from '../utils/autoVersion';
import {
  isDryRun,
  promptConfirmation,
  setGitHubActionsOutput,
} from '../utils/helpers';
import { formatJson } from '../utils/strings';
import { spawnProcess } from '../utils/system';
import { isValidVersion } from '../utils/version';
import { withTracing } from '../utils/tracing';

import { handler as publishMainHandler, PublishOptions } from './publish';

export const command = ['prepare [NEW-VERSION]'];
export const aliases = ['p', 'prerelease', 'prepublish', 'prepare', 'release'];
export const description = '🚢 Prepare a new release branch';

/** Default path to bump-version script, relative to project root */
const DEFAULT_BUMP_VERSION_PATH = join('scripts', 'bump-version.sh');

/** Minimum craft version required for auto-versioning */
const AUTO_VERSION_MIN_VERSION = '2.14.0';

export const builder: CommandBuilder = (yargs: Argv) =>
  yargs
    .positional('NEW-VERSION', {
      description:
        'The new version to release. Can be: a semver string (e.g., "1.2.3"), ' +
        'a bump type ("major", "minor", or "patch"), "auto" to determine automatically ' +
        'from conventional commits, or "calver" for calendar versioning. ' +
        'If omitted, uses the versioning.policy from .craft.yml',
      type: 'string',
    })
    .option('rev', {
      alias: 'r',
      description:
        'Source revision (git SHA or tag) to prepare from (if not branch head)',
      type: 'string',
    })
    .option('no-push', {
      default: false,
      description: 'Do not push the release branch',
      type: 'boolean',
    })
    .option('no-git-checks', {
      default: false,
      description: 'Ignore local git changes and unsynchronized remotes',
      type: 'boolean',
    })
    .option('no-changelog', {
      default: false,
      description: 'Do not check for changelog entries',
      type: 'boolean',
    })
    .option('publish', {
      default: false,
      description: 'Run "publish" right after "release"',
      type: 'boolean',
    })
    .option('remote', {
      default: 'origin',
      description: 'The git remote to use when pushing',
      type: 'string',
    })
    .option('config-from', {
      description:
        'Load .craft.yml from the specified remote branch instead of local file',
      type: 'string',
    })
    .option('calver-offset', {
      description:
        'Days to go back for CalVer date calculation (overrides config)',
      type: 'number',
    })
    .check(checkVersionOrPart);

/** Command line options. */
interface PrepareOptions {
  /** The new version to release (optional if versioning.policy is configured) */
  newVersion?: string;
  /** The base revision to release */
  rev: string;
  /** The git remote to use when pushing */
  remote: string;
  /** Do not perform basic git checks */
  noGitChecks: boolean;
  /** Do not check for changelog */
  noChangelog: boolean;
  /** Do not push the newly created release branch */
  noPush: boolean;
  /** Run publish right after */
  publish: boolean;
  /** Load config from specified remote branch */
  configFrom?: string;
  /** Override CalVer offset (days to go back) */
  calverOffset?: number;
}

/**
 * Wait for this number of seconds before publishing, if the corresponding
 * flag was specified
 */
const SLEEP_BEFORE_PUBLISH_SECONDS = 30;

/**
 * Checks the provided version argument for validity
 *
 * We check that the argument is either a valid version string, 'auto' for
 * automatic version detection, 'calver' for calendar versioning, a version
 * bump type (major/minor/patch), or a valid semantic version.
 * Empty/undefined is also allowed (will use versioning.policy from config).
 *
 * @param argv Parsed yargs arguments
 * @param _opt A list of options and aliases
 */
export function checkVersionOrPart(argv: Arguments<any>, _opt: any): boolean {
  const version = argv.newVersion;

  // Allow empty version (will use versioning.policy from config)
  if (!version) {
    return true;
  }

  // Allow 'auto' for automatic version detection
  if (version === 'auto') {
    return true;
  }

  // Allow 'calver' for calendar versioning
  if (version === 'calver') {
    return true;
  }

  // Allow version bump types (major, minor, patch)
  if (isBumpType(version)) {
    return true;
  }

  if (isValidVersion(version)) {
    return true;
  } else {
    let errMsg = `Invalid version or version part specified: "${version}"`;
    if (version.startsWith('v')) {
      errMsg += '. Removing the "v" prefix will likely fix the issue';
    }
    throw Error(errMsg);
  }
}

/**
 * Creates a new local release branch
 *
 * Throws an error if the branch already exists.
 *
 * @param git Local git client
 * @param newVersion Version we are releasing
 * @param releaseBranchPrefix Prefix of the release branch. Defaults to "release".
 */
async function createReleaseBranch(
  git: SimpleGit,
  rev: string,
  newVersion: string,
  remoteName: string,
  releaseBranchPrefix?: string,
): Promise<string> {
  const branchPrefix = releaseBranchPrefix || DEFAULT_RELEASE_BRANCH_NAME;
  const branchName = `${branchPrefix}/${newVersion}`;

  const branchHead = await git.raw('show-ref', '--heads', branchName);

  // in case `show-ref` can't find a branch it returns `null`
  if (branchHead) {
    let errorMsg = `Branch already exists: ${branchName}. `;
    errorMsg +=
      'Run the following commands to delete the branch, and then rerun "prepare":\n';
    errorMsg += `    git branch -D ${branchName}; git push ${remoteName} --delete ${branchName}\n`;
    reportError(errorMsg, logger);
  }

  await git.checkoutBranch(branchName, rev);
  logger.info(`Created a new release branch: "${branchName}"`);
  logger.info(`Switched to branch "${branchName}"`);
  return branchName;
}

/**
 * Pushes the release branch to the remote
 *
 * @param git Local git client
 * @param defaultBranch Default branch of the remote repository
 * @param pushFlag If "true", push the release branch
 */
async function pushReleaseBranch(
  git: SimpleGit,
  branchName: string,
  remoteName: string,
  pushFlag = true,
): Promise<any> {
  if (pushFlag) {
    logger.info(`Pushing the release branch "${branchName}"...`);
    // TODO check remote somehow
    await git.push(remoteName, branchName, ['--set-upstream']);
  } else {
    logger.info('Not pushing the release branch.');
    logger.info(
      'You can push this branch later using the following command:',
      `  $ git push -u ${remoteName} "${branchName}"`,
    );
  }
}

/**
 * Makes a release commit of all uncommitted changes
 *
 * @param git Local git client
 * @param newVersion The version we are releasing
 */
async function commitNewVersion(
  git: SimpleGit,
  newVersion: string,
): Promise<any> {
  const message = `release: ${newVersion}`;
  const repoStatus = await git.status();
  if (!(repoStatus.created.length || repoStatus.modified.length)) {
    reportError('Nothing to commit: has the pre-release command done its job?');
  }

  logger.debug('Committing the release changes...');
  logger.trace(`Commit message: "${message}"`);
  await git.commit(message, ['--all']);
}

/**
 * Run an external pre-release command
 *
 * The command usually executes operations for version bumping and might
 * include dependency updates.
 *
 * @param newVersion Version being released
 * @param preReleaseCommand Custom pre-release command
 */
export async function runPreReleaseCommand(
  oldVersion: string,
  newVersion: string,
  preReleaseCommand?: string,
): Promise<boolean> {
  let sysCommand: string;
  let args: string[];
  if (preReleaseCommand !== undefined && preReleaseCommand.length === 0) {
    // Not running pre-release command
    logger.warn('Not running the pre-release command: no command specified');
    return false;
  }

  // This is a workaround for the case when the old version is empty, which
  // should only happen when the project is new and has no version yet.
  // Instead of using an empty string, we use "0.0.0" as the old version to
  // avoid breaking the pre-release command as most scripts expect a non-empty
  // version string.
  const nonEmptyOldVersion = oldVersion || '0.0.0';
  if (preReleaseCommand) {
    [sysCommand, ...args] = shellQuote.parse(preReleaseCommand) as string[];
  } else {
    sysCommand = '/bin/bash';
    args = [DEFAULT_BUMP_VERSION_PATH];
  }
  args = [...args, nonEmptyOldVersion, newVersion];
  logger.info('Running the pre-release command...');
  const additionalEnv = {
    CRAFT_NEW_VERSION: newVersion,
    CRAFT_OLD_VERSION: nonEmptyOldVersion,
  };
  await spawnProcess(sysCommand, args, {
    env: { ...process.env, ...additionalEnv },
  });
  return true;
}

/**
 * Checks that it is safe to perform the release right now
 *
 * @param repoStatus Result of git.status()
 * @param rev Revision to prepare the relese from
 */
function checkGitStatus(repoStatus: StatusResult, rev: string) {
  logger.info('Checking the local repository status...');

  logger.debug('Repository status:', formatJson(repoStatus));

  if (isRepoDirty(repoStatus)) {
    reportError(
      'Your repository is in a dirty state. ' +
        'Please stash or commit the pending changes.',
      logger,
    );
  }

  if (repoStatus.current !== rev) {
    logger.warn(
      `You are releasing from '${rev}', not '${repoStatus.current}' which you are currently on.`,
    );
  }
}

/**
 * Run the "publish" step and terminate the process.
 *
 * This function will never return: it terminates the process with the
 * corresponding error code after publishing is done.
 *
 * @param remote The git remote to use when pushing
 * @param newVersion Version to publish
 * @param noGitChecks If true, skip git status checks
 */
async function execPublish(
  remote: string,
  newVersion: string,
  noGitChecks: boolean,
): Promise<never> {
  logger.info('Running the "publish" command...');
  const publishOptions: PublishOptions = {
    remote,
    newVersion,
    keepBranch: false,
    keepDownloads: false,
    noMerge: false,
    noStatusCheck: false,
    noGitChecks,
  };
  logger.info(
    `Sleeping for ${SLEEP_BEFORE_PUBLISH_SECONDS} seconds before publishing...`,
  );
  if (!isDryRun()) {
    await sleep(SLEEP_BEFORE_PUBLISH_SECONDS * 1000);
  } else {
    logger.info('[dry-run] Not wasting time on sleep');
  }

  try {
    await publishMainHandler(publishOptions);
    process.exit(0);
  } catch (e) {
    logger.error(e);
    logger.error(
      'There was an error running "publish". Fix the issue and run the command manually:',
      `  $ craft publish ${newVersion}`,
    );
    throw e;
  }
}

/**
 * Checks changelog entries in accordance with the provided changelog policy.
 *
 * @param git Local git client
 * @param oldVersion The previous version to start the change list
 * @param newVersion The new version we are releasing
 * @param changelogPolicy One of the changelog policies, such as "none", "simple", etc.
 * @param changelogPath Path to the changelog file
 * @returns The changelog body for this version, or undefined if no changelog
 */
async function prepareChangelog(
  git: SimpleGit,
  oldVersion: string,
  newVersion: string,
  changelogPolicy: ChangelogPolicy = ChangelogPolicy.None,
  changelogPath: string = DEFAULT_CHANGELOG_PATH,
): Promise<string | undefined> {
  if (changelogPolicy === ChangelogPolicy.None) {
    logger.debug(
      `Changelog policy is set to "${changelogPolicy}", nothing to do.`,
    );
    return undefined;
  }

  if (
    changelogPolicy !== ChangelogPolicy.Auto &&
    changelogPolicy !== ChangelogPolicy.Simple
  ) {
    throw new ConfigurationError(
      `Invalid changelog policy: "${changelogPolicy}"`,
    );
  }

  logger.info('Checking the changelog...');
  logger.debug(`Changelog policy: "${changelogPolicy}".`);

  const relativePath = relative('', changelogPath);
  logger.debug(`Changelog path: ${relativePath}`);
  if (relativePath.startsWith('.')) {
    throw new ConfigurationError(`Invalid changelog path: "${changelogPath}"`);
  }

  if (!existsSync(relativePath)) {
    if (changelogPolicy === ChangelogPolicy.Auto) {
      logger.info(`Creating changelog file: ${relativePath}`);
      await safeFs.writeFile(relativePath, '# Changelog\n');
    } else {
      throw new ConfigurationError(
        `Changelog does not exist: "${changelogPath}"`,
      );
    }
  }

  let changelogString = (await fsPromises.readFile(relativePath)).toString();
  let changeset = findChangeset(
    changelogString,
    newVersion,
    changelogPolicy === ChangelogPolicy.Auto,
  );
  switch (changelogPolicy) {
    case ChangelogPolicy.Auto:
      // eslint-disable-next-line no-case-declarations
      let replaceSection;
      if (!changeset) {
        changeset = { name: newVersion, body: '' };
      }
      if (!changeset.body) {
        replaceSection = changeset.name;
        // generateChangesetFromGit is memoized, so this won't duplicate API calls
        const result = await generateChangesetFromGit(git, oldVersion);
        changeset.body = result.changelog;
      }
      if (changeset.name === DEFAULT_UNRELEASED_TITLE) {
        replaceSection = changeset.name;
        changeset.name = newVersion;
      }
      logger.debug(
        `Updating the changelog file for the new version: ${newVersion}`,
      );

      if (replaceSection) {
        changelogString = removeChangeset(changelogString, replaceSection);
        changelogString = prependChangeset(changelogString, changeset);
      }

      await safeFs.writeFile(relativePath, changelogString);

      break;
    default:
      if (!changeset?.body) {
        throw new ConfigurationError(
          `No changelog entry found for version "${newVersion}"`,
        );
      }
  }

  logger.debug('Changelog entry found:', changeset.name);
  logger.trace(changeset.body);
  return changeset?.body;
}

/**
 * Switches to the default branch of the repo
 *
 * @param git Local git client
 * @param defaultBranch Default branch of the remote repository
 */
async function switchToDefaultBranch(
  git: SimpleGit,
  defaultBranch: string,
): Promise<void> {
  const repoStatus = await git.status();
  if (repoStatus.current === defaultBranch) {
    return;
  }
  logger.info(`Switching back to the default branch (${defaultBranch})...`);
  await git.checkout(defaultBranch);
}

interface ResolveVersionOptions {
  /** The raw version input from CLI (may be undefined, 'auto', 'calver', bump type, or semver) */
  versionArg?: string;
  /** Override for CalVer offset (days to go back) */
  calverOffset?: number;
}

/**
 * Resolves the final semver version string from various input types.
 *
 * Handles:
 * - No input: uses versioning.policy from config
 * - 'calver': calculates calendar version
 * - 'auto': analyzes commits to determine bump type
 * - 'major'/'minor'/'patch': applies bump to latest tag
 * - Explicit semver: returns as-is
 *
 * @param git Local git client
 * @param options Version resolution options
 * @returns The resolved semver version string
 */
async function resolveVersion(
  git: SimpleGit,
  options: ResolveVersionOptions,
): Promise<string> {
  const config = getConfiguration();
  let version = options.versionArg;

  // If no version specified, use the versioning policy from config
  if (!version) {
    const policy = getVersioningPolicy();
    logger.debug(`No version specified, using versioning policy: ${policy}`);

    if (policy === VersioningPolicy.Manual) {
      throw new ConfigurationError(
        'Version is required. Either specify a version argument or set ' +
          'versioning.policy to "auto" or "calver" in .craft.yml',
      );
    }

    // Use the policy as the version type
    version = policy;
  }

  // Handle CalVer versioning
  if (version === 'calver') {
    if (!requiresMinVersion(AUTO_VERSION_MIN_VERSION)) {
      throw new ConfigurationError(
        `CalVer versioning requires minVersion >= ${AUTO_VERSION_MIN_VERSION} in .craft.yml. ` +
          'Please update your configuration or specify the version explicitly.',
      );
    }

    // Build CalVer config with overrides
    const calverOffset =
      options.calverOffset ??
      (process.env.CRAFT_CALVER_OFFSET
        ? parseInt(process.env.CRAFT_CALVER_OFFSET, 10)
        : undefined) ??
      config.versioning?.calver?.offset ??
      DEFAULT_CALVER_CONFIG.offset;

    const calverFormat =
      config.versioning?.calver?.format ?? DEFAULT_CALVER_CONFIG.format;

    return calculateCalVer(git, {
      offset: calverOffset,
      format: calverFormat,
    });
  }

  // Handle automatic version detection or version bump types
  if (version === 'auto' || isBumpType(version)) {
    if (!requiresMinVersion(AUTO_VERSION_MIN_VERSION)) {
      const featureName = isBumpType(version)
        ? 'Version bump types'
        : 'Auto-versioning';
      throw new ConfigurationError(
        `${featureName} requires minVersion >= ${AUTO_VERSION_MIN_VERSION} in .craft.yml. ` +
          'Please update your configuration or specify the version explicitly.',
      );
    }

    const latestTag = await getLatestTag(git);

    // Determine bump type - either from arg or from commit analysis
    let bumpType: BumpType;
    if (version === 'auto') {
      const changelogResult = await getChangelogWithBumpType(git, latestTag);
      validateBumpType(changelogResult);
      bumpType = changelogResult.bumpType;
    } else {
      bumpType = version as BumpType;
    }

    // Calculate new version from latest tag
    const currentVersion =
      latestTag && latestTag.replace(/^v/, '').match(/^\d/)
        ? latestTag.replace(/^v/, '')
        : '0.0.0';

    const newVersion = calculateNextVersion(currentVersion, bumpType);
    logger.info(
      `Version bump: ${currentVersion} -> ${newVersion} (${bumpType} bump)`,
    );
    return newVersion;
  }

  // Explicit semver version - return as-is
  return version;
}

/**
 * Body of 'prepare' command
 *
 * @param argv Command-line arguments
 */
export async function prepareMain(argv: PrepareOptions): Promise<any> {
  let git = await getGitClient();

  // Handle --config-from: load config from remote branch
  if (argv.configFrom) {
    logger.info(`Loading configuration from remote branch: ${argv.configFrom}`);
    try {
      await git.fetch([argv.remote, argv.configFrom]);
      const configContent = await git.show([
        `${argv.remote}/${argv.configFrom}:${CONFIG_FILE_NAME}`,
      ]);
      loadConfigurationFromString(configContent);
    } catch (error: any) {
      throw new ConfigurationError(
        `Failed to load ${CONFIG_FILE_NAME} from branch "${argv.configFrom}": ${error.message}`,
      );
    }
  }

  // Get repo configuration
  const config = getConfiguration();
  const githubConfig = await getGlobalGitHubConfig();

  const defaultBranch = await getDefaultBranch(git, argv.remote);
  logger.debug(`Default branch for the repo:`, defaultBranch);
  const repoStatus = await git.status();
  const rev = argv.rev || repoStatus.current || defaultBranch;

  if (argv.noGitChecks) {
    logger.info('Not checking the status of the local repository');
  } else {
    // Check that we're in an acceptable state for the release
    checkGitStatus(repoStatus, rev);
  }

  // Resolve version from input, policy, or automatic detection
  const newVersion = await resolveVersion(git, {
    versionArg: argv.newVersion,
    calverOffset: argv.calverOffset,
  });

  // Emit resolved version for GitHub Actions
  setGitHubActionsOutput('version', newVersion);

  logger.info(`Releasing version ${newVersion} from ${rev}`);
  if (!argv.rev && rev !== defaultBranch) {
    logger.warn("You're not on your default branch, so I have to ask...");
    await promptConfirmation();
  }

  logger.info(`Preparing to release the version: ${newVersion}`);

  // Create isolation context (worktree in dry-run mode, passthrough otherwise)
  const isolation = await createDryRunIsolation(git, rev);
  git = isolation.git;

  try {
    // Create a new release branch and check it out. Fail if it already exists.
    const branchName = await createReleaseBranch(
      git,
      rev,
      newVersion,
      argv.remote,
      config.releaseBranchPrefix,
    );

    // Do this once we are on the release branch as we might be releasing from
    // a custom revision and it is harder to tell git to give us the tag right
    // before a specific revision.
    // TL;DR - WARNING:
    // The order matters here, do not move this command above createReleaseBranch!
    const oldVersion = await getLatestTag(git);

    // Check & update the changelog
    // Extract changelog path from config (can be string or object)
    const changelogPath =
      typeof config.changelog === 'string'
        ? config.changelog
        : config.changelog?.filePath;
    // Get policy from new format or legacy changelogPolicy
    const changelogPolicy = (
      typeof config.changelog === 'object' && config.changelog?.policy
        ? config.changelog.policy
        : config.changelogPolicy
    ) as ChangelogPolicy | undefined;
    const changelogBody = await prepareChangelog(
      git,
      oldVersion,
      newVersion,
      argv.noChangelog ? ChangelogPolicy.None : changelogPolicy,
      changelogPath,
    );

    // Run a pre-release script (e.g. for version bumping)
    const preReleaseCommandRan = await runPreReleaseCommand(
      oldVersion,
      newVersion,
      config.preReleaseCommand,
    );

    if (preReleaseCommandRan) {
      // Commit the pending changes
      await commitNewVersion(git, newVersion);
    } else {
      logger.debug('Not committing anything since preReleaseCommand is empty.');
    }

    // Show diff preview (no-op in non-dry-run mode)
    await isolation.showDiff();

    // Push the release branch (blocked in dry-run mode)
    await pushReleaseBranch(git, branchName, argv.remote, !argv.noPush);

    // Emit GitHub Actions outputs for downstream steps
    const releaseSha = await git.revparse(['HEAD']);
    setGitHubActionsOutput('branch', branchName);
    setGitHubActionsOutput('sha', releaseSha);
    setGitHubActionsOutput('previous_tag', oldVersion || '');
    if (changelogBody) {
      setGitHubActionsOutput('changelog', changelogBody);
    }

    logger.info(
      `View diff at: https://github.com/${githubConfig.owner}/${githubConfig.repo}/compare/${branchName}`,
    );

    if (argv.publish) {
      if (isolation.isIsolated) {
        logger.info(`[dry-run] Would run: craft publish ${newVersion}`);
      } else {
        logger.success(`Release branch "${branchName}" has been pushed.`);
        await execPublish(argv.remote, newVersion, argv.noGitChecks);
      }
    } else {
      logger.success(
        'Done. Do not forget to run "craft publish" to publish the artifacts:',
        `  $ craft publish ${newVersion}`,
      );
    }

    if (!argv.rev && !isolation.isIsolated) {
      await switchToDefaultBranch(git, defaultBranch);
    }
  } finally {
    // Clean up (no-op in non-dry-run mode)
    await isolation.cleanup();
  }
}

export const handler = async (args: {
  [argName: string]: any;
}): Promise<void> => {
  try {
    return await withTracing(prepareMain, {
      name: 'craft.prepare',
      op: 'craft.prepare',
    })(args as PrepareOptions);
  } catch (e) {
    handleGlobalError(e);
  }
};
