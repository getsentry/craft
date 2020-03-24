import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';

/**
 * Empty artifact provider that does nothing.
 */
export class NoneArtifactProvider extends BaseArtifactProvider {
  /**
   * Empty provider cannot download any files.
   *
   * @returns A promise rejection with an error message
   */
  protected async doDownloadArtifact(
    _artifact: RemoteArtifact,
    _downloadDirectory: string
  ): Promise<string> {
    return Promise.reject('NoneProvider does not suuport file downloads!');
  }

  /**
   * Empty provider does not have any artifacts.
   *
   * @returns An empty array
   */
  protected async doListArtifactsForRevision(
    _revision: string
  ): Promise<RemoteArtifact[] | undefined> {
    return [];
  }
}
