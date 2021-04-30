import {
  Artifact as ZeusArtifact,
  Client as ZeusClient,
  Status,
} from '@zeus-ci/sdk';

import {
  BaseArtifactProvider,
  RemoteArtifact,
  ArtifactProviderConfig,
} from '../artifact_providers/base';
import { checkEnvForPrerequisite } from '../utils/env';
import { logger as loggerRaw } from '../logger';

const logger = loggerRaw.withScope(`[artifact-provider/zeus]`);

// TODO (kmclb) once `craft upload` is a thing, add an upload method here (and change the docstring below)

/**
 * Zeus artifact provider
 *
 * For the moment, artifacts have to be uploaded to Zeus via "zeus-cli" command
 * line tool.
 */
export class ZeusArtifactProvider extends BaseArtifactProvider {
  /** Zeus API client */
  public readonly client: ZeusClient;

  public constructor(config: ArtifactProviderConfig) {
    super(config);
    checkEnvForPrerequisite({
      legacyName: 'ZEUS_TOKEN',
      name: 'ZEUS_API_TOKEN',
    });
    // We currently need ZEUS_TOKEN set for zeus-sdk to work properly
    if (!process.env.ZEUS_TOKEN) {
      process.env.ZEUS_TOKEN = process.env.ZEUS_API_TOKEN;
    }
    this.client = new ZeusClient({
      defaultDirectory: config.downloadDirectory,
      logger,
    });
  }

  /**
   * Rearranges and renames data to convert from one interface to another.
   *
   * @param zeusArtifact A zeus-style Artifact to convert
   * @returns The data transformed into a RemoteArtifact
   */
  private convertToRemoteArtifact(zeusArtifact: ZeusArtifact): RemoteArtifact {
    // unpacking...
    const {
      name: filename,
      download_url: downloadFilepath,
      file: zeusFile,
      updated_at: lastUpdated,
      type: mimeType,
    } = zeusArtifact;
    const { name: storedFilename, size } = zeusFile;

    // ...and repacking
    return {
      filename,
      mimeType,
      storedFile: {
        downloadFilepath,
        filename: storedFilename,
        lastUpdated,
        size,
      },
    };
  }

  /**
   * Rearranges and renames data to convert from one interface to another.
   *
   * @param remoteArtifact A RemoteArtifact to convert
   * @returns  The data transformed into a Zeus-style Artifact
   */
  private convertToZeusArtifact(remoteArtifact: RemoteArtifact): ZeusArtifact {
    // unpacking...
    const { filename: name, storedFile, mimeType: type } = remoteArtifact;
    const {
      lastUpdated: updated_at,
      downloadFilepath: download_url,
      filename: storedFilename,
      size,
    } = storedFile;

    // ...and repacking
    return {
      download_url,
      file: {
        name: storedFilename,
        size,
      },
      id: '',
      name,
      status: Status.UNKNOWN,
      type: type || '',
      updated_at,
    };
  }

  /**
   * @inheritDoc
   */
  public async doDownloadArtifact(
    artifact: RemoteArtifact,
    downloadDirectory: string
  ): Promise<string> {
    return this.client.downloadArtifact(
      this.convertToZeusArtifact(artifact),
      downloadDirectory
    );
  }

  /**
   * @inheritDoc
   */
  protected async doListArtifactsForRevision(
    revision: string
  ): Promise<RemoteArtifact[]> {
    const { repoName, repoOwner } = this.config;
    logger.debug(
      `Fetching Zeus artifacts for ${repoOwner}/${repoName}, revision ${revision}`
    );
    let zeusArtifacts;
    try {
      zeusArtifacts = await this.client.listArtifactsForRevision(
        repoOwner,
        repoName,
        revision
      );
    } catch (e) {
      // zeus is the only artifact provider which could know about a commit
      // (from its role as a status provider) but not have any files associated
      // with that commit. (For all other artifact providers, not knowing about
      // the commit and having no files associated with the commit are one and
      // the same.) In the former case (known commit, no files), zeus will
      // return an empty list, whereas in the latter case (unknown commit), it
      // will error. This error message check and the length check below are
      // here to disambiguate those two situations.
      const errorMessage: string = e.message || '';
      if (errorMessage.match(/404 not found|resource not found/i)) {
        logger.debug(`Revision \`${revision}\` not found!`);
      }
      throw e;
    }

    // see comment above
    if (zeusArtifacts.length === 0) {
      logger.debug(`Revision \`${revision}\` found.`);
    }

    // similarly, zeus is the only artifact provider which will store multiple
    // copies of the same file for a given revision, so to mimic the behavior of
    // the other providers (which overwrite pre-existing, identically-named
    // files within the same commit), for each filename, take the one with the
    // most recent update time
    zeusArtifacts.sort((a, b) => {
      if (a.name < b.name) {
        return -1;
      } else if (a.name > b.name) {
        return 1;
      } else {
        const aUpdatedAt = Date.parse(a.updated_at ?? '') || 0;
        const bUpdatedAt = Date.parse(b.updated_at ?? '') || 0;
        if (aUpdatedAt < bUpdatedAt) {
          return -1;
        } else if (aUpdatedAt > bUpdatedAt) {
          return 1;
        } else {
          return 0;
        }
      }
    });

    return zeusArtifacts
      .filter((artifact, idx, arr) => artifact.name !== arr[idx + 1]?.name)
      .map(zeusArtifact => this.convertToRemoteArtifact(zeusArtifact));
  }
}
