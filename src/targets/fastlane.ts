import { logger as loggerRaw } from '../logger';
import { BaseArtifactProvider } from '../artifact_providers/base';
import { reportError } from '../utils/errors';
import { TargetConfig } from '../schemas/project_config';
import { checkExecutableIsPresent, spawnProcess } from '../utils/system';
import { BaseTarget } from './base';

const logger = loggerRaw.withScope('[fastlane]');

const DEFAULT_FASTLANE_BIN = 'fastlane';

/**
 * Command to launch gem
 */
const FASTLANE_BIN = process.env.FASTLANE_BIN || DEFAULT_FASTLANE_BIN;

export interface FastlaneTargetOptions extends TargetConfig {
  /** Lanes that should be invoked */
  lanes: { cwd?: string; name: string }[];
}

/**
 * Target responsible for invoking fastlane https://fastlane.tools/
 */
export class FastlaneTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'fastlane';
  /** Target options */
  public readonly fastlaneConfig: FastlaneTargetOptions;

  public constructor(
    config: Record<string, any>,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    checkExecutableIsPresent(FASTLANE_BIN);
    this.fastlaneConfig = this.getFastlaneConfig();
  }

  /**
   * Extracts NPM target options from the raw configuration
   */
  protected getFastlaneConfig(): FastlaneTargetOptions {
    const fastlaneConfig: FastlaneTargetOptions = {
      lanes: this.config.lanes || [],
    };
    if (
      !Array.isArray(fastlaneConfig.lanes) ||
      fastlaneConfig.lanes.length == 0
    ) {
      reportError(`You need to define at least one lane that can be invoked.`);
    }
    return fastlaneConfig;
  }

  /**
   * Pushes a gem to rubygems.org
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(_version: string, _revision: string): Promise<any> {
    for (const laneConfig of this.fastlaneConfig.lanes) {
      logger.info(`Invoking lane: "${laneConfig.name}"`);
      await spawnProcess(FASTLANE_BIN, [laneConfig.name], {
        cwd: laneConfig.cwd,
        env: {
          ...process.env,
        },
      });
    }

    logger.info('Successfully ran fastlane');
  }
}
