import {
  BaseArtifactProvider,
  CraftArtifact,
} from '../artifact_providers/base';

/**
 * Empty artifact provider that does nothing.
 */
export class NoneArtifactProvider extends BaseArtifactProvider {
  /**
   * This method should not be called by user code.
   */
  public async doDownloadArtifact(
    _artifact: CraftArtifact,
    _downloadDirectory: string
  ): Promise<string> {
    return Promise.reject('NoneProvider does not suuport file downloads!');
  }

  /**
   * Empty provider does not have any artifacts.
   */
  protected async doListArtifactsForRevision(
    _revision: string
  ): Promise<CraftArtifact[] | undefined> {
    return [];
  }
}
