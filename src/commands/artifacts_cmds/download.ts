import { logger } from '../../logger';
import { ArtifactsOptions } from '../artifacts';
import { getArtifactProviderFromConfig } from '../../config';
import { handleGlobalError } from '../../utils/errors';
import { Argv } from 'yargs';

export const command = ['download NAME'];
export const aliases = ['d', 'get'];
export const description = 'Download artifacts';
export const builder = (yargs: Argv) =>
  yargs
    .positional('NAME', {
      description: 'Artifact name to download',
      type: 'string',
    })
    .option('all', {
      default: false,
      description: 'Download all artifacts',
      type: 'boolean',
    })
    .option('directory', {
      description: 'Target directory',
      type: 'string',
    });

/** TODO */
interface ArtifactsDownloadOptions extends ArtifactsOptions {
  name: string;
}

/** TODO */
async function handlerMain(argv: ArtifactsDownloadOptions): Promise<any> {
  // FIXME move elsewhere
  process.env.ZEUS_TOKEN = process.env.ZEUS_API_TOKEN;

  const revision = argv.rev;
  const name = argv.name;

  const artifactProvider = getArtifactProviderFromConfig();

  const artifacts = await artifactProvider.listArtifactsForRevision(revision);

  if (!artifacts) {
    logger.warn(`Revision ${revision} can not be found.`);
    return undefined;
  } else if (artifacts.length === 0) {
    logger.info(`No artifacts found for revision ${revision}`);
    return undefined;
  }

  const filteredArtifacts = artifacts.filter(a => a.name === name);
  if (filteredArtifacts.length === 0) {
    logger.warn(`Artifact "${name}" was not found for revision ${revision}`);
    return undefined;
  }
  const filteredArtifact = filteredArtifacts[0];

  const artifactPath = await artifactProvider.downloadArtifact(
    filteredArtifact,
    'tmpyo'
  );
  logger.debug(`Resulting artifact path: ${artifactPath}`);
}

/** TODO */
export async function handler(argv: ArtifactsDownloadOptions): Promise<any> {
  try {
    return await handlerMain(argv);
  } catch (e) {
    handleGlobalError(e);
  }
}
