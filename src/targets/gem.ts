import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { reportError } from '../utils/errors';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';
import { TargetConfig } from '../schemas/project_config';
import { logger } from '../logger';

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

  /**
   * Bump version in Ruby gem project files.
   *
   * Looks for version patterns in:
   * 1. .gemspec files (s.version = "x.y.z")
   * 2. lib/.../version.rb files (VERSION = "x.y.z")
   */
  public static async bumpVersion(
    rootDir: string,
    newVersion: string
  ): Promise<boolean> {
    const gemspecFiles = readdirSync(rootDir).filter(f => f.endsWith('.gemspec'));
    if (gemspecFiles.length === 0) {
      return false;
    }

    let bumped = false;

    for (const gemspecFile of gemspecFiles) {
      const gemspecPath = join(rootDir, gemspecFile);
      const content = readFileSync(gemspecPath, 'utf-8');

      // Match: s.version = "1.0.0" or spec.version = '1.0.0'
      const versionRegex = /^(\s*\w+\.version\s*=\s*["'])([^"']+)(["'])/m;

      if (versionRegex.test(content)) {
        const newContent = content.replace(versionRegex, `$1${newVersion}$3`);
        if (newContent !== content) {
          logger.debug(`Updating version in ${gemspecPath} to ${newVersion}`);
          writeFileSync(gemspecPath, newContent);
          bumped = true;
        }
      }
    }

    const libDir = join(rootDir, 'lib');
    if (existsSync(libDir)) {
      bumped = GemTarget.updateVersionRbFiles(libDir, newVersion) || bumped;
    }

    return bumped;
  }

  /**
   * Recursively find and update version.rb files
   */
  private static updateVersionRbFiles(dir: string, newVersion: string): boolean {
    let updated = false;
    let entries;

    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        updated = GemTarget.updateVersionRbFiles(fullPath, newVersion) || updated;
      } else if (entry.name === 'version.rb') {
        const content = readFileSync(fullPath, 'utf-8');
        const versionRegex = /^(\s*VERSION\s*=\s*["'])([^"']+)(["'])/m;

        if (versionRegex.test(content)) {
          const newContent = content.replace(versionRegex, `$1${newVersion}$3`);
          if (newContent !== content) {
            logger.debug(`Updating VERSION in ${fullPath} to ${newVersion}`);
            writeFileSync(fullPath, newContent);
            updated = true;
          }
        }
      }
    }

    return updated;
  }

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
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
      })
    );

    this.logger.info('Successfully registered gem');
  }
}
