import { readdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { reportError } from '../utils/errors';
import { findFiles } from '../utils/files';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';
import { TargetConfig } from '../schemas/project_config';
import { logger } from '../logger';
import {
  DetectionContext,
  DetectionResult,
  fileExists,
} from '../utils/detection';
import { readdirSync } from 'fs';

const DEFAULT_GEM_BIN = 'gem';

/**
 * Command to launch gem
 */
const GEM_BIN = process.env.GEM_BIN || DEFAULT_GEM_BIN;

/**
 * RegExp for gems
 */
const DEFAULT_GEM_REGEX = /^.*(\.gem)$/;

/**
 * Target responsible for publishing releases to Ruby Gems (https://rubygems.org)
 */
export class GemTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'gem';

  /** Priority for ordering in config (package registries appear first) */
  public static readonly priority = 40;

  /**
   * Bump version in Ruby gem project files.
   *
   * Supports monorepos by searching for gemspec files up to 2 levels deep,
   * respecting .gitignore patterns.
   *
   * Looks for version patterns in:
   * 1. .gemspec files (s.version = "x.y.z")
   * 2. lib/.../version.rb files relative to each gemspec (VERSION = "x.y.z")
   */
  public static async bumpVersion(
    rootDir: string,
    newVersion: string,
  ): Promise<boolean> {
    // Find all gemspec files up to 2 levels deep, respecting .gitignore
    const gemspecFiles = await findFiles(rootDir, {
      maxDepth: 2,
      fileFilter: name => name.endsWith('.gemspec'),
    });

    if (gemspecFiles.length === 0) {
      return false;
    }

    let bumped = false;

    for (const gemspecPath of gemspecFiles) {
      const content = await readFile(gemspecPath, 'utf-8');

      // Match: s.version = "1.0.0" or spec.version = '1.0.0'
      const versionRegex = /^(\s*\w+\.version\s*=\s*["'])([^"']+)(["'])/m;

      if (versionRegex.test(content)) {
        const newContent = content.replace(versionRegex, `$1${newVersion}$3`);
        if (newContent !== content) {
          logger.debug(`Updating version in ${gemspecPath} to ${newVersion}`);
          await writeFile(gemspecPath, newContent);
          bumped = true;
        }
      }

      // Also check for lib/**/version.rb relative to each gemspec's directory
      const gemDir = dirname(gemspecPath);
      const libDir = join(gemDir, 'lib');
      const libUpdated = await GemTarget.updateVersionRbFiles(
        libDir,
        newVersion,
      );
      bumped = libUpdated || bumped;
    }

    return bumped;
  }

  /**
   * Recursively find and update version.rb files
   */
  private static async updateVersionRbFiles(
    dir: string,
    newVersion: string,
  ): Promise<boolean> {
    let updated = false;
    let entries;

    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const subUpdated = await GemTarget.updateVersionRbFiles(
          fullPath,
          newVersion,
        );
        updated = subUpdated || updated;
      } else if (entry.name === 'version.rb') {
        const content = await readFile(fullPath, 'utf-8');
        const versionRegex = /^(\s*VERSION\s*=\s*["'])([^"']+)(["'])/m;

        if (versionRegex.test(content)) {
          const newContent = content.replace(versionRegex, `$1${newVersion}$3`);
          if (newContent !== content) {
            logger.debug(`Updating VERSION in ${fullPath} to ${newVersion}`);
            await writeFile(fullPath, newContent);
            updated = true;
          }
        }
      }
    }

    return updated;
  }

  /**
   * Detect if this project should use the gem target.
   *
   * Checks for *.gemspec files in the root directory.
   */
  public static detect(context: DetectionContext): DetectionResult | null {
    const { rootDir } = context;

    // Check for Gemfile (indicates Ruby project)
    if (!fileExists(rootDir, 'Gemfile')) {
      return null;
    }

    // Look for .gemspec files (indicates a gem)
    try {
      const files = readdirSync(rootDir);
      const hasGemspec = files.some(f => f.endsWith('.gemspec'));
      if (hasGemspec) {
        return {
          config: { name: 'gem' },
          priority: GemTarget.priority,
          requiredSecrets: [
            {
              name: 'GEM_HOST_API_KEY',
              description: 'RubyGems API key for publishing',
            },
          ],
        };
      }
    } catch {
      // Ignore errors reading directory
    }

    return null;
  }

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
  ) {
    super(config, artifactProvider);
    checkExecutableIsPresent(GEM_BIN);
  }

  /**
   * Uploads a gem to rubygems
   *
   * @param path Absolute path to the archive to upload
   * @returns A promise that resolves when the gem pushed
   */
  public async pushGem(path: string): Promise<any> {
    return spawnProcess(GEM_BIN, ['push', path]);
  }

  /**
   * Pushes a gem to rubygems.org
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, revision: string): Promise<any> {
    this.logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: DEFAULT_GEM_REGEX,
    });

    if (!packageFiles.length) {
      reportError('Cannot push gem: no packages found');
      return undefined;
    }

    await Promise.all(
      packageFiles.map(async (file: RemoteArtifact) => {
        const path = await this.artifactProvider.downloadArtifact(file);
        this.logger.info(`Pushing gem "${file.filename}"`);
        return this.pushGem(path);
      }),
    );

    this.logger.info('Successfully registered gem');
  }
}
