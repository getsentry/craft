import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { TargetConfig } from '../schemas/project_config';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { ConfigurationError, reportError } from '../utils/errors';
import { checkExecutableIsPresent, runWithExecutable } from '../utils/system';
import { BaseTarget } from './base';
import { logger } from '../logger';
import {
  DetectionContext,
  DetectionResult,
  fileExists,
  readTextFile,
  TargetPriority,
} from '../utils/detection';

const DEFAULT_TWINE_BIN = 'twine';

/**
 * Command to launch twine
 */
const TWINE_BIN = process.env.TWINE_BIN || DEFAULT_TWINE_BIN;

/**
 * RegExp for Python packages
 */
const DEFAULT_PYPI_REGEX = /^.*\d\.\d.*(\.whl|\.gz|\.zip)$/;

/** Options for "pypi" target */
export interface PypiTargetOptions {
  /** Twine username */
  twineUsername: string;
  /** Twine password */
  twinePassword: string;
}

/**
 * Target responsible for publishing releases on PyPI (Python package index)
 */
export class PypiTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'pypi';
  /** Target options */
  public readonly pypiConfig: PypiTargetOptions;

  /**
   * Bump version in Python project files.
   *
   * Detection priority:
   * 1. [tool.hatch] in pyproject.toml → hatch version <version>
   * 2. [tool.poetry] in pyproject.toml → poetry version <version>
   * 3. [tool.setuptools_scm] in pyproject.toml → no-op (version from git tags)
   * 4. [project] with version field → direct TOML edit
   *
   * @param rootDir - Project root directory
   * @param newVersion - New version string to set
   * @returns true if version was bumped, false if no pyproject.toml exists
   * @throws Error if tool is not found or command fails
   */
  public static async bumpVersion(
    rootDir: string,
    newVersion: string,
  ): Promise<boolean> {
    const pyprojectPath = join(rootDir, 'pyproject.toml');
    if (!existsSync(pyprojectPath)) {
      return false;
    }

    const content = readFileSync(pyprojectPath, 'utf-8');

    if (content.includes('[tool.hatch]')) {
      return PypiTarget.bumpWithHatch(rootDir, newVersion);
    }

    if (content.includes('[tool.poetry]')) {
      return PypiTarget.bumpWithPoetry(rootDir, newVersion);
    }

    if (content.includes('[tool.setuptools_scm]')) {
      // setuptools_scm derives version from git tags, no bump needed
      logger.debug('setuptools_scm project - version derived from git tags');
      return true;
    }

    if (content.includes('[project]')) {
      return PypiTarget.bumpDirectToml(pyprojectPath, content, newVersion);
    }

    // No recognized Python project structure
    return false;
  }

  /**
   * Bump version using hatch
   */
  private static async bumpWithHatch(
    rootDir: string,
    newVersion: string,
  ): Promise<boolean> {
    await runWithExecutable(
      {
        name: 'hatch',
        envVar: 'HATCH_BIN',
        errorHint:
          'Install hatch or define a custom preReleaseCommand in .craft.yml',
      },
      ['version', newVersion],
      { cwd: rootDir },
    );
    return true;
  }

  /**
   * Bump version using poetry
   */
  private static async bumpWithPoetry(
    rootDir: string,
    newVersion: string,
  ): Promise<boolean> {
    await runWithExecutable(
      {
        name: 'poetry',
        envVar: 'POETRY_BIN',
        errorHint:
          'Install poetry or define a custom preReleaseCommand in .craft.yml',
      },
      ['version', newVersion],
      { cwd: rootDir },
    );
    return true;
  }

  /**
   * Bump version by directly editing pyproject.toml
   * This handles standard PEP 621 [project] section with version field
   */
  private static bumpDirectToml(
    pyprojectPath: string,
    content: string,
    newVersion: string,
  ): boolean {
    // Match version in [project] section
    // This regex handles: version = "1.0.0" or version = '1.0.0'
    const versionRegex = /^(\s*version\s*=\s*["'])([^"']+)(["'])/m;

    if (!versionRegex.test(content)) {
      logger.debug(
        'pyproject.toml has [project] section but no version field found',
      );
      return false;
    }

    const newContent = content.replace(versionRegex, `$1${newVersion}$3`);

    if (newContent === content) {
      logger.debug('Version already set to target value');
      return true;
    }

    logger.debug(`Updating version in ${pyprojectPath} to ${newVersion}`);
    writeFileSync(pyprojectPath, newContent);

    return true;
  }

  /**
   * Detect if this project should use the pypi target.
   *
   * Checks for pyproject.toml or setup.py.
   */
  public static detect(context: DetectionContext): DetectionResult | null {
    const { rootDir } = context;

    // Check for pyproject.toml (modern Python packaging)
    if (fileExists(rootDir, 'pyproject.toml')) {
      const content = readTextFile(rootDir, 'pyproject.toml');
      if (content) {
        // Check if it has a [project] or [tool.poetry] section (indicates a package)
        if (
          content.includes('[project]') ||
          content.includes('[tool.poetry]')
        ) {
          return {
            config: { name: 'pypi' },
            priority: TargetPriority.PYPI,
          };
        }
      }
    }

    // Check for setup.py (legacy Python packaging)
    if (fileExists(rootDir, 'setup.py')) {
      return {
        config: { name: 'pypi' },
        priority: TargetPriority.PYPI,
      };
    }

    return null;
  }

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider,
  ) {
    super(config, artifactProvider);
    this.pypiConfig = this.getPypiConfig();
    checkExecutableIsPresent(TWINE_BIN);
  }

  /**
   * Extracts PyPI target options from the environment
   */
  public getPypiConfig(): PypiTargetOptions {
    if (!process.env.TWINE_USERNAME || !process.env.TWINE_PASSWORD) {
      throw new ConfigurationError(
        `Cannot perform PyPI release: missing credentials.
         Please use TWINE_USERNAME and TWINE_PASSWORD environment variables.`.replace(
          /^\s+/gm,
          '',
        ),
      );
    }
    return {
      twinePassword: process.env.TWINE_PASSWORD,
      twineUsername: process.env.TWINE_USERNAME,
    };
  }

  async uploadAssets(paths: string[]): Promise<any> {
    // TODO: Sign the package with "--sign"
    return spawnProcess(TWINE_BIN, ['upload', ...paths]);
  }

  /**
   * Uploads all files to PyPI using Twine
   *
   * Requires twine to be configured in the environment (either beforehand or
   * via enviroment).
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, revision: string): Promise<any> {
    this.logger.debug('Fetching artifact list...');
    const packageFiles = await this.getArtifactsForRevision(revision, {
      includeNames: DEFAULT_PYPI_REGEX,
    });

    if (!packageFiles.length) {
      reportError('Cannot release to PyPI: no packages found');
      return undefined;
    }

    const paths = await Promise.all(
      packageFiles.map(async (file: RemoteArtifact) => {
        this.logger.info(`Uploading file "${file.filename}" via twine`);
        return this.artifactProvider.downloadArtifact(file);
      }),
    );
    await this.uploadAssets(paths);

    this.logger.info('PyPI release complete');
  }
}
