import {
  Artifact as ZeusArtifact,
  Client as ZeusClient,
  Status,
} from '@zeus-ci/sdk';
import * as _ from 'lodash';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';
import { logger } from '../logger';

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
      // tslint:disable: variable-name
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
  ): Promise<RemoteArtifact[] | undefined> {
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

    return artifacts.map(zeusArtifact =>
      this.convertToRemoteArtifact(zeusArtifact)
    );
  }
}
