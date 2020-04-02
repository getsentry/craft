import * as _ from 'lodash';
import { logger } from '../../logger';
import { ArtifactsOptions } from '../artifacts';
import { getArtifactProviderFromConfig } from '../../config';
import { handleGlobalError, ConfigurationError } from '../../utils/errors';
import { Argv } from 'yargs';
import { resolve } from 'path';
import { existsSync, lstatSync } from 'fs';
import mkdirp = require('mkdirp');
import { NoneArtifactProvider } from '../../artifact_providers/none';

export const command = ['download [NAME..]'];
export const aliases = ['d', 'get'];
export const description = 'Download artifacts';
export const builder = (yargs: Argv) =>
  yargs
    .positional('NAME', {
      alias: 'names',
      description: 'Artifact name to download',
      type: 'string',
    })
    .array('NAME')
    .option('all', {
      alias: 'a',
      default: false,
      description: 'Download all artifacts',
      type: 'boolean',
    })
    .option('directory', {
      alias: 'd',
      description: 'Target directory',
      type: 'string',
    });

/** Options for "download" command */
interface ArtifactsDownloadOptions extends ArtifactsOptions {
  names: string[];
  directory?: string;
  all?: boolean;
}

/**
 * Read/process output directory from command line arguments
 *
 * @param argv Full path to the target directory
 */
async function prepareOutputDirectory(
  argv: ArtifactsDownloadOptions
): Promise<string> {
  if (argv.directory) {
    const fullPath = resolve(argv.directory);
    if (existsSync(fullPath)) {
      if (lstatSync(fullPath).isDirectory()) {
        return fullPath;
      } else {
        throw new ConfigurationError(`Not a directory: ${fullPath}`);
      }
    } else {
      logger.debug(`Creating directory: ${fullPath}`);
      await mkdirp(fullPath);
      return fullPath;
    }
  } else {
    return resolve(process.cwd());
  }
}

/**
 * Body of 'artifacts download' command
 */
async function handlerMain(argv: ArtifactsDownloadOptions): Promise<any> {
  // FIXME move elsewhere
  process.env.ZEUS_TOKEN = process.env.ZEUS_API_TOKEN;

  if (!argv.all && argv.names.length === 0) {
    throw new ConfigurationError('No names to download, exiting.');
  }

  const revision = argv.rev;

  const artifactProvider = getArtifactProviderFromConfig();
  if (artifactProvider instanceof NoneArtifactProvider) {
    logger.warn(
      `Artifact provider is disabled in the configuration, nothing to do.`
    );
    return undefined;
  }

  const outputDirectory = await prepareOutputDirectory(argv);

  const artifacts = await artifactProvider.listArtifactsForRevision(revision);
  if (artifacts.length === 0) {
    logger.info(`No artifacts found for revision ${revision}`);
    return undefined;
  }

  const filesToDownload = argv.all
    ? artifacts.map(ar => ar.filename)
    : argv.names;
  const nameToArtifact = _.fromPairs(artifacts.map(ar => [ar.filename, ar]));

  logger.info(`Fetching artifacts for revision: ${revision}`);
  for (const name of filesToDownload) {
    logger.info(`Artifact to fetch: "${name}"`);
    const filteredArtifact = nameToArtifact[name];
    if (!filteredArtifact) {
      logger.warn(`Artifact "${name}" was not found`);
      continue;
    }

    const artifactPath = await artifactProvider.downloadArtifact(
      filteredArtifact,
      outputDirectory
    );
    logger.info(`Saved artifact to: ${artifactPath}`);
  }
}

/**
 * Main command handler
 */
export async function handler(argv: ArtifactsDownloadOptions): Promise<any> {
  try {
    return await handlerMain(argv);
  } catch (e) {
    handleGlobalError(e);
  }
}
