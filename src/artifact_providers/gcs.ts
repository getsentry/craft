import {
  BaseArtifactProvider,
  RemoteArtifact,
  ArtifactProviderConfig,
} from '../artifact_providers/base';
import { CraftGCSClient, getGCSCredsFromEnv } from '../utils/gcsApi';
import { ConfigurationError } from '../utils/errors';
import { logger as loggerRaw } from '../logger';

const logger = loggerRaw.withScope(`[artifact provider]`);

/**
 * Google Cloud Storage artifact provider
 */
export class GCSArtifactProvider extends BaseArtifactProvider {
  /** Client for interacting with the GCS bucket */
  private readonly gcsClient: CraftGCSClient;

  public constructor(config: ArtifactProviderConfig) {
    super(config);
    const { project_id, client_email, private_key } = getGCSCredsFromEnv(
      {
        name: 'CRAFT_GCS_STORE_CREDS_JSON',
      },
      {
        name: 'CRAFT_GCS_STORE_CREDS_PATH',
      },
      logger
    );

    // TODO (kmclb) get rid of this check once config validation is working
    if (!config.bucket) {
      throw new ConfigurationError(
        'No GCS bucket provided in artifact provider config!'
      );
    }

    this.gcsClient = new CraftGCSClient({
      bucketName: config.bucket,
      credentials: { client_email, private_key },
      logger,
      projectId: project_id,
    });
  }

  /**
   * @inheritDoc
   */
  protected async doDownloadArtifact(
    artifact: RemoteArtifact,
    downloadDirectory: string
  ): Promise<string> {
    return this.gcsClient.downloadArtifact(
      artifact.storedFile.downloadFilepath,
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
    return this.gcsClient.listArtifactsForRevision(
      repoOwner,
      repoName,
      revision
    );
  }
}
