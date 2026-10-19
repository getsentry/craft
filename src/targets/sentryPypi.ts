import fs from 'fs';
import path from 'path';
import { Octokit } from '@octokit/rest';
import { TargetConfig, TypedTargetConfig } from '../schemas/project_config';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { withTempDir } from '../utils/files';
import { ConfigurationError, reportError } from '../utils/errors';
import { spawnProcess } from '../utils/system';
import { BaseTarget } from './base';
import { getGitHubClient } from '../utils/githubApi';

/**
 * RegExp for Python packages
 */
export const WHEEL_REGEX = /^([^-]+)-([^-]+)-[^-]+-[^-]+-[^-]+\.whl$/;

/** Config fields for sentry-pypi target from .craft.yml */
interface SentryPypiYamlConfig extends Record<string, unknown> {
  internalPypiRepo?: string;
}

export function uniquePackages(filenames: Array<string>): Array<string> {
  const versions = filenames.map(filename => {
    const match = WHEEL_REGEX.exec(filename) as RegExpExecArray;
    return `${match[1]}==${match[2]}`;
  });
  return [...new Set(versions)].sort();
}

/**
 * Target responsible for publishing internal packages on internal PyPI
 */
export class SentryPypiTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'sentry-pypi';
  /** GitHub client */
  private readonly github: Octokit;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
  ) {
    super(config, artifactProvider);

    if (!('internalPypiRepo' in this.config)) {
      throw new ConfigurationError(
        'Missing project configuration parameter: internalPypiRepo',
      );
    }

    this.github = getGitHubClient();
  }

  /**
   * Creates a pull request in the target pypi repo
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, revision: string): Promise<any> {
    this.logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: WHEEL_REGEX,
    });

    if (!packageFiles.length) {
      reportError('Cannot release to PyPI: no packages found');
      return undefined;
    }

    const versions = uniquePackages(packageFiles.map(f => f.filename));

    const typedConfig = this.config as TypedTargetConfig<SentryPypiYamlConfig>;
    const [owner, repo] = typedConfig.internalPypiRepo!.split('/');

    const [contents, tree, commit] = await withTempDir(async directory => {
      await spawnProcess(
        'git',
        [
          'clone',
          '--quiet',
          '--depth=1',
          `https://github.com/${typedConfig.internalPypiRepo}`,
          directory,
        ],
        {},
        { enableInDryRunMode: true },
      );

      await spawnProcess(
        'python3',
        ['-m', 'add_pkg', '--skip-resolve', ...versions],
        { cwd: directory },
        { enableInDryRunMode: true },
      );

      const contents = fs.readFileSync(path.join(directory, 'packages.ini'), {
        encoding: 'utf-8',
      });
      const tree = (
        (await spawnProcess(
          'git',
          ['-C', directory, 'rev-parse', 'HEAD:'],
          {},
          { enableInDryRunMode: true },
        )) as Buffer
      )
        .toString('utf-8')
        .trim();
      const commit = (
        (await spawnProcess(
          'git',
          ['-C', directory, 'rev-parse', 'HEAD'],
          {},
          { enableInDryRunMode: true },
        )) as Buffer
      )
        .toString('utf-8')
        .trim();
      return [contents, tree, commit];
    });

    // making a commit involves:

    // 1. build a tree based on the previous tree
    const newTree = (
      await this.github.git.createTree({
        owner,
        repo,
        tree: [
          {
            path: 'packages.ini',
            mode: '100644',
            type: 'blob',
            content: contents,
          },
        ],
        base_tree: tree,
      })
    ).data.sha;

    // 2. make a commit
    const message = `update ${versions.join(' ')}`;
    const newCommit = (
      await this.github.git.createCommit({
        owner,
        repo,
        message,
        tree: newTree,
        parents: [commit],
      })
    ).data.sha;

    // 3. make a branch
    const branchName = `craft-release-${revision}`;
    await this.github.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: newCommit,
    });

    // 4. make a PR!
    await this.github.rest.pulls.create({
      owner,
      repo,
      head: branchName,
      base: 'main',
      title: message,
    });

    this.logger.info('internal PyPI release complete');
  }
}
