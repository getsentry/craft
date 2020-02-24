import { Client as ZeusClient, Status } from '@zeus-ci/sdk';
import * as _ from 'lodash';
import {
  BaseArtifactProvider,
  CraftArtifact,
} from '../artifact_providers/base';
import { logger } from '../logger';

/**
 * Zeus artifact provider
 *
 * Artifacts have to be uploaded to Zeus via "zeus-cli" command line tool.
 */
export class ZeusArtifactProvider extends BaseArtifactProvider {
  /** Zeus API client */
  public readonly client: ZeusClient;
  /** Zeus project owner */
  public readonly repoOwner: string;
  /** Zeus project name */
  public readonly repoName: string;

  public constructor(
    repoOwner: string,
    repoName: string,
    downloadDirectory?: string
  ) {
    super();
    this.client = new ZeusClient({
      defaultDirectory: downloadDirectory,
      logger,
    });
    this.repoOwner = repoOwner;
    this.repoName = repoName;
  }

  /**
   * Downloads the given artifact file.
   *
   * Downloaded URL are cached during the instance's lifetime, so the same
   * file is downloaded only once.
   *
   * @param artifact An artifact object to download
   * @param downloadDirectory Directory where downloaded artifact is stored
   * @returns Absolute path to the saved file
   */
  public async doDownloadArtifact(
    artifact: CraftArtifact,
    downloadDirectory: string
  ): Promise<string> {
    // TODO fix some of these attributes
    return this.client.downloadArtifact(
      {
        ...artifact,
        file: { name: '', size: 0 },
        id: '',
        status: Status.UNKNOWN,
        type: '',
      },
      downloadDirectory
    );
  }

  /**
   * List artifacts for the given revision
   *
   * @param revision revision id (its SHA)
   */
  protected async doListArtifactsForRevision(
    revision: string
  ): Promise<CraftArtifact[] | undefined> {
    logger.debug(
      `Fetching Zeus artifacts for ${this.repoOwner}/${this.repoName}, revision ${revision}`
    );
    let artifacts;
    try {
      artifacts = await this.client.listArtifactsForRevision(
        this.repoOwner,
        this.repoName,
        revision
      );
    } catch (e) {
      const errorMessage: string = e.message || '';
      if (errorMessage.match(/404 not found|resource not found/i)) {
        return undefined;
      }
      throw e;
    }

    return artifacts;
  }
}
