import { Client as ZeusClient, Status } from '@zeus-ci/sdk';
import * as _ from 'lodash';
import {
  BaseArtifactProvider,
  CraftArtifact,
} from '../artifact_providers/base';

/**
 * TODO
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
    this.client = new ZeusClient({ defaultDirectory: downloadDirectory });
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
   * @returns Absolute path to the saved file
   */
  public async doDownloadArtifact(artifact: CraftArtifact): Promise<string> {
    // TODO fix some of these attributes
    return this.client.downloadArtifact({
      ...artifact,
      file: { name: '', size: 0 },
      id: '',
      status: Status.UNKNOWN,
      type: '',
    });
  }

  /** TODO */
  protected async doListArtifactsForRevision(
    revision: string
  ): Promise<CraftArtifact[]> {
    const artifacts = await this.client.listArtifactsForRevision(
      this.repoOwner,
      this.repoName,
      revision
    );

    // For every filename, take the artifact with the most recent update time
    const nameToArtifacts = _.groupBy(artifacts, artifact => artifact.name);
    const filteredArtifacts = Object.keys(nameToArtifacts).map(artifactName => {
      const artifactObjects = nameToArtifacts[artifactName];
      // Sort by the update time
      const sortedArtifacts = _.sortBy(
        artifactObjects,
        artifact => Date.parse(artifact.updated_at || '') || 0
      );
      return sortedArtifacts[sortedArtifacts.length - 1];
    });
    return filteredArtifacts;
  }
}
