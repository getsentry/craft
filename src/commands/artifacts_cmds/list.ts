import { logger, formatTable } from "../../logger";
import { ArtifactsOptions } from "../artifacts";
import { getArtifactProviderFromConfig } from "../../config";
import { handleGlobalError } from "../../utils/errors";
import { formatSize } from "../../utils/strings";
import { NoneArtifactProvider } from "../../artifact_providers/none";

export const command = ["list"];
export const aliases = ["l"];
export const description = "List artifacts";

/**
 * Body of 'artifacts list' command
 */
async function handlerMain(argv: ArtifactsOptions): Promise<any> {
  const revision = argv.rev;

  const artifactProvider = getArtifactProviderFromConfig();
  if (artifactProvider instanceof NoneArtifactProvider) {
    logger.warn(
      `Artifact provider is disabled in the configuration, nothing to do.`
    );
    return undefined;
  }

  const artifacts = await artifactProvider.listArtifactsForRevision(revision);

  if (artifacts.length === 0) {
    logger.info(`No artifacts found for revision ${revision}`);
    return undefined;
  }

  const artifactData = artifacts.map((ar) => [
    ar.filename,
    formatSize(ar.storedFile.size),
    ar.storedFile.lastUpdated || "",
  ]);

  const table = formatTable(
    {
      head: ["File Name", "Size", "Updated"],
      style: { head: ["cyan"] },
    },
    artifactData
  );
  logger.info(
    `Available artifacts for revision ${revision}: \n${table.toString()}\n`
  );

  return argv.rev;
}

/** Main command handler */
export const handler = async (args: {
  [argName: string]: any;
}): Promise<any> => {
  try {
    return await handlerMain(args as ArtifactsOptions);
  } catch (e) {
    handleGlobalError(e);
  }
};
