import { logger as loggerRaw } from '../logger';
import { TargetConfig } from '../schemas/project_config';
import { forEachChained } from '../utils/async';
import { ConfigurationError, reportError } from '../utils/errors';
import {
  BucketPath,
  CraftGCSClient,
  GCSBucketConfig,
  getGCSCredsFromEnv,
  DEFAULT_UPLOAD_METADATA,
} from '../utils/gcsApi';
import { renderTemplateSafe } from '../utils/strings';
import { BaseTarget } from './base';
import {
  BaseArtifactProvider,
  RemoteArtifact,
} from '../artifact_providers/base';

const logger = loggerRaw.withScope(`[gcs target]`);

/**
 * Adds templating to the BucketPath interface.
 *
 * Omits required property `path` since that will be computed dynamically later.
 */
interface PathTemplate extends Omit<BucketPath, 'path'> {
  /**
   * Template for the path, into which `version` and `revision` can be
   * substituted
   */
  template: string;
}

/**
 * Configuration options for the GCS target
 */
export interface GCSTargetConfig extends GCSBucketConfig, TargetConfig {
  /** A list of path templates with associated metadata */
  pathTemplates: PathTemplate[];
}

/**
 * Target responsible for uploading files to GCS
 */
export class GcsTarget extends BaseTarget {
  /** Target name */
  public readonly name: string = 'gcs';
  /** Target options */
  public readonly targetConfig: GCSTargetConfig;
  /** GCS API client */
  private readonly gcsClient: CraftGCSClient;

  public constructor(
    config: TargetConfig,
    artifactProvider: BaseArtifactProvider
  ) {
    super(config, artifactProvider);
    this.targetConfig = this.getGCSTargetConfig();
    this.gcsClient = new CraftGCSClient(this.targetConfig);
  }

  /**
   * Parses and checks configuration for the GCS target
   */
  protected getGCSTargetConfig(): GCSTargetConfig {
    // tslint:disable: object-literal-sort-keys
    const { project_id, client_email, private_key } = getGCSCredsFromEnv(
      {
        name: 'CRAFT_GCS_TARGET_CREDS_JSON',
        legacyName: 'CRAFT_GCS_CREDENTIALS_JSON',
      },
      {
        name: 'CRAFT_GCS_TARGET_CREDS_PATH',
        legacyName: 'CRAFT_GCS_CREDENTIALS_PATH',
      }
    );

    const bucketName = this.config.bucket;
    if (!bucketName && typeof bucketName !== 'string') {
      reportError('No GCS bucket provided!');
    }

    const pathTemplates: PathTemplate[] = this.parseRawPathConfig(
      this.config.paths
    );

    return {
      bucketName,
      credentials: { client_email, private_key },
      name: 'GCS target',
      pathTemplates,
      projectId: project_id,
    };
  }

  /**
   * Converts raw destination paths from the config file into the format we
   * need.
   *
   * @param rawPathConfig The paths as they come from the config file
   * @returns An array of PathTemplates, each consisting of a path template
   * string and any metadata which should be associated with the files being
   * uploaded to that path
   */
  private parseRawPathConfig(rawPathConfig: any): PathTemplate[] {
    let parsedTemplates: PathTemplate[] = [];

    if (
      !rawPathConfig ||
      // in JS empty arrays are truthy
      (rawPathConfig.length && rawPathConfig.length === 0)
    ) {
      reportError('No bucket paths provided!');
    }

    // if there's only one path, and no metadata specified, path config can be
    // provided as a string rather than an array of objects
    else if (typeof rawPathConfig === 'string') {
      parsedTemplates = [
        {
          template: rawPathConfig,
        },
      ];
    }

    // otherwise, path config should be a list of objects, each containing
    // `path` (a template into which release-specific data can be interpolated)
    // and `metadata`
    else if (Array.isArray(rawPathConfig)) {
      rawPathConfig.forEach((configEntry: any) => {
        if (typeof configEntry !== 'object') {
          reportError(
            `Invalid bucket destination: ${JSON.stringify(
              configEntry
            )}. Use object notation to specify bucket paths!`
          );
        }

        const { path: template, metadata } = configEntry;

        if (!template) {
          reportError(`Invalid bucket path template: ${template}`);
        }
        if (metadata && typeof metadata !== 'object') {
          reportError(
            `Invalid metadata for path "${template}": "${JSON.stringify(
              metadata
            )}. Use object notation to specify metadata!"`
          );
        }

        parsedTemplates.push({
          metadata,
          template,
        });
      });
    }
    // if rawConfig is neither a string nor an array of objects, we're out of
    // luck
    else {
      reportError(`Cannot parse GCS target's path configuration!`);
    }

    return parsedTemplates;
  }

  /**
   * Converts a PathTemplate into a BucketPath by filling in `version` and
   * `revision` as appropriate.
   *
   * @param pathTemplate A path template with associated metadata
   * @param version The new version
   * @param revision The SHA revision of the new version
   * @returns The resulting BucketPath object
   */
  private materializePathTemplate(
    pathTemplate: PathTemplate,
    version: string,
    revision: string
  ): BucketPath {
    const { template, metadata } = pathTemplate;

    if (!template) {
      throw new Error(`Invalid path template \`${template}\`!`);
    }

    let realPath = renderTemplateSafe(template.trim(), {
      revision,
      version,
    });

    // enforce the constraint that all paths must start with a slash
    if (realPath[0] !== '/') {
      realPath = `/${realPath}`;
    }
    logger.debug(
      `Processed path template: \`${template}\` and got \`${realPath}\``
    );
    return { path: realPath, metadata };
  }

  /**
   * Uploads artifacts to Google Cloud Storage
   *
   * Artifacts are filtered by the `includeNames` and `excludeNames` settings
   * for the target.
   *
   * @param version New version to be released
   * @param revision Git commit SHA to be published
   */
  public async publish(version: string, revision: string): Promise<any> {
    const artifacts = await this.getArtifactsForRevision(revision);
    if (!artifacts.length) {
      throw new ConfigurationError(
        'No artifacts to publish: please check your configuration!'
      );
    }

    const { bucketName } = this.targetConfig;

    logger.info(`Uploading to GCS bucket: "${bucketName}"`);

    // before we can upload the artifacts to our target, we first need to
    // download them from the artifact provider
    const localFilePaths = await Promise.all(
      artifacts.map(
        async (artifact: RemoteArtifact): Promise<string> =>
          this.artifactProvider.downloadArtifact(artifact)
      )
    );

    // We intentionally do not make all requests concurrent here, instead
    // uploading files to each destination path in turn
    await forEachChained(
      this.targetConfig.pathTemplates,
      async (pathTemplate: PathTemplate): Promise<any> => {
        // fills `version` and `revision` values into the template
        const bucketPath = this.materializePathTemplate(
          pathTemplate,
          version,
          revision
        );

        logger.info(`Uploading files to ${bucketPath.path}.`);
        logger.debug(
          `Upload options: ${JSON.stringify({
            gzip: true,
            metadata: bucketPath.metadata || DEFAULT_UPLOAD_METADATA,
          })}`
        );

        return Promise.all(
          localFilePaths.map(async localPath =>
            this.gcsClient.uploadArtifact(localPath, bucketPath)
          )
        );
      }
    );

    logger.info('Upload to GCS complete.');
  }
}
