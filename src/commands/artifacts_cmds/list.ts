import { logger, formatTable } from '../../logger';
import { ArtifactsOptions } from '../artifacts';
import { getArtifactProviderFromConfig } from '../../config';
import { handleGlobalError } from '../../utils/errors';
import { formatJson, formatSize } from '../../utils/strings';

export const command = ['list'];
export const aliases = ['l'];
export const description = 'List artifacts';

/** TODO */
async function handlerMain(argv: ArtifactsOptions): Promise<any> {
  // FIXME move elsewhere
  process.env.ZEUS_TOKEN = process.env.ZEUS_API_TOKEN;

  const artifactProvider = getArtifactProviderFromConfig();
  logger.info(`Artifact provider: ${formatJson(artifactProvider)}`);
  const artifacts = await artifactProvider.listArtifactsForRevision(argv.rev);

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
  logger.info(`Available artifacts: \n${table.toString()}\n`);

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
