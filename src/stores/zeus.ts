import {
  Artifact,
  Client as ZeusClient,
  Result,
  RevisionInfo,
  Status,
} from '@zeus-ci/sdk';

/**
 * An artifact storage
 *
 * Essentialy, it's a caching wrapper around ZeusClient at the moment.
 */
export class ZeusStore {
  /** Zeus API client */
  public readonly client: ZeusClient;
  /** Zeus project owner */
  public readonly repoOwner: string;
  /** Zeus project name */
  public readonly repoName: string;

  /** URL cache for downloaded fies */
  private readonly downloadCache: { [key: string]: Promise<string> } = {};

  private readonly fileListCache: { [key: string]: Promise<Artifact[]> } = {};

  public constructor(
    repoOwner: string,
    repoName: string,
    downloadDirectory?: string
  ) {
    this.client = new ZeusClient({ defaultDirectory: downloadDirectory });
    this.repoOwner = repoOwner;
    this.repoName = repoName;
  }

  /**
   * Downloads the given artifact file.
   *
   * Downloaded URL are cached during the instance's lifetime, so the same
   * files is downloaded only once.
   *
   * @param artifact An artifact object to download
   */
  public async downloadArtifact(artifact: Artifact): Promise<string> {
    const cached = this.downloadCache[artifact.download_url];
    if (cached) {
      return cached;
    }
    const promise = this.client.downloadArtifact(artifact);
    this.downloadCache[artifact.download_url] = promise;
    return promise;
  }

  /**
   * Gets a list of all available artifacts for the given revision
   *
   * @param revision Git commit id
   */
  public async listArtifactsForRevision(revision: string): Promise<Artifact[]> {
    const cached = this.fileListCache[revision];
    if (cached) {
      return cached;
    }
    const promise = this.client.listArtifactsForRevision(
      this.repoOwner,
      this.repoName,
      revision
    );
    this.fileListCache[revision] = promise;
    return promise;
  }

  /**
   * Gets aggregated revision information
   *
   * @param revision Git commit id
   */
  public async getRevision(revision: string): Promise<RevisionInfo> {
    return this.client.getRevision(this.repoOwner, this.repoName, revision);
  }

  /**
   * Checks if the revision has been built successfully
   *
   * @param revisionInfo Revision information as returned from getRevision()
   */
  public isRevisionBuiltSuccessfully(revisionInfo: RevisionInfo): boolean {
    return (
      revisionInfo.status === Status.FINISHED &&
      revisionInfo.result === Result.PASSED
    );
  }
}

export { RevisionInfo };
