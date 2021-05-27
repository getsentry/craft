import {
  BaseArtifactProvider,
  RemoteArtifact,
  ArtifactProviderConfig,
} from '../artifact_providers/base';

/**
 * Empty artifact provider that does nothing.
 */
export class NoneArtifactProvider extends BaseArtifactProvider {
  public constructor(
    config: ArtifactProviderConfig = {
      repoName: 'none',
      repoOwner: 'none',
      name: 'none',
    }
  ) {
    super(config);
  }
  /**
   * Empty provider cannot download any files.
   *
   * @returns A promise rejection with an error message
   */
  protected async doDownloadArtifact(
    _artifact: RemoteArtifact,
    _downloadDirectory: string
  ): Promise<string> {
    return Promise.reject(
      new Error('NoneProvider does not suuport file downloads!')
    );
  }

  /**
   * Empty provider does not have any artifacts.
   *
   * @returns An empty array
   */
  protected async doListArtifactsForRevision(
    _revision: string
  ): Promise<RemoteArtifact[]> {
    return [];
  }
}
