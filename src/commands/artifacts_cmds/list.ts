import { logger, formatTable } from '../../logger';
import { ArtifactsOptions } from '../artifacts';
import { getArtifactProviderFromConfig } from '../../config';
import { handleGlobalError } from '../../utils/errors';
import { formatSize } from '../../utils/strings';

export const command = ['list'];
export const aliases = ['l'];
export const description = 'List artifacts';

/** TODO */
async function handlerMain(argv: ArtifactsOptions): Promise<any> {
  // FIXME move elsewhere
  process.env.ZEUS_TOKEN = process.env.ZEUS_API_TOKEN;

  const revision = argv.rev;

  const artifactProvider = getArtifactProviderFromConfig();
  if (!artifactProvider) {
    logger.warn(
      `Artifact provider is disabled in the configuration, nothing to do.`
    );
    return undefined;
  }

  const artifacts = await artifactProvider.listArtifactsForRevision(revision);

  if (!artifacts) {
    logger.warn(`Revision ${revision} can not be found.`);
    return undefined;
  } else if (artifacts.length === 0) {
    logger.info(`No artifacts found for revision ${revision}`);
    return undefined;
  }

  const artifactData = artifacts.map(ar => [
    ar.name,
    formatSize(ar.file.size),
    ar.updated_at || '',
  ]);

  const table = formatTable(
    {
      head: ['File Name', 'Size', 'Updated'],
      style: { head: ['cyan'] },
    },
    artifactData
  );
  logger.info(
    `Available artifacts for revision ${revision}: \n${table.toString()}\n`
  );

  return argv.rev;
}

/** TODO */
export async function handler(argv: ArtifactsOptions): Promise<any> {
  try {
    return await handlerMain(argv);
  } catch (e) {
    handleGlobalError(e);
  }
}
