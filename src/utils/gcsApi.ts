import * as fs from 'fs';

import { Bucket, Storage } from '@google-cloud/storage';

import { logger as loggerRaw } from '../logger';
import { reportError } from './errors';
import { checkEnvForPrerequisite, RequiredConfigVar } from './env';

const logger = loggerRaw.withScope('[gcs]');

const DEFAULT_GCS_MAX_RETRIES = 5;

/**
 * Is this bucket being used as an artifact store or a target?
 */
export const enum BucketRole {
  /** Artifact storage (used in both `prepare` and `publish`) */
  STORE = 'store',
  /** Destination for `publish` */
  TARGET = 'target',
}

/**
 * Configuration options for the GCS bucket
 */
export interface GCSConfig {
  /** Bucket name */
  bucketName: string;
  /** ID of the project containing the bucket   */
  projectId: string;
  /** CGS credentials */
  credentials: { client_email: string; private_key: string };
  /** Role (is this being used as an artifact store or a target?) */
  role: BucketRole;
  /** Maximum number of retries after unsuccessful request */
  maxRetries?: number;
}

/**
 * Abstraction for a GCS bucket
 */
export class GCSBucket {
  /** Bucket name */
  public readonly bucketName: string;
  /** Role (is this being used as an artifact store or a target?) */
  public readonly role: BucketRole; // TODO kmclb do I need this?
  /** Bucket configuration */
  private readonly config: GCSConfig;
  /** CGS Client */
  private readonly bucket: Bucket;
  public constructor(config: GCSConfig) {
    const {
      bucketName,
      projectId,
      credentials,
      role,
      maxRetries = DEFAULT_GCS_MAX_RETRIES,
    } = config;

    this.config = config;
    this.bucketName = bucketName;
    this.role = role;

    const storage = new Storage({
      credentials,
      maxRetries,
      projectId,
    });
    this.bucket = new Bucket(storage, bucketName);
  }

  /**
   * Pulls GCS redentials out of the environment, where they can be stored either
   * as a path to a JSON file or as a JSON string.
   *
   * @returns An object containing the credentials
   */
  public static getGCSCredsFromEnv = (
    gcsRole: BucketRole
  ): { [key: string]: string } => {
    // tslint:disable: object-literal-sort-keys
    const jsonVar: RequiredConfigVar =
      gcsRole === BucketRole.STORE
        ? { name: 'CRAFT_GCS_STORE_CREDENTIALS_JSON' }
        : {
            name: 'CRAFT_GCS_TARGET_CREDENTIALS_JSON',
            legacyName: 'CRAFT_GCS_CREDENTIALS_JSON',
          };
    const filepathVar: RequiredConfigVar =
      gcsRole === BucketRole.STORE
        ? { name: 'CRAFT_GCS_STORE_CREDENTIALS_PATH' }
        : {
            name: 'CRAFT_GCS_TARGET_CREDENTIALS_PATH',
            legacyName: 'CRAFT_GCS_CREDENTIALS_PATH',
          };

    // make sure we have at least one of the necessary variables
    checkEnvForPrerequisite(jsonVar, filepathVar);

    const gcsCredsJson = process.env[jsonVar.name];
    const gcsCredsPath = process.env[filepathVar.name];

    // necessary in case we're doing a dry run, in which case missing
    // credentials will log an error but not throw
    let configRaw = '';

    if (gcsCredsJson) {
      logger.debug(`Using configuration from ${jsonVar.name}`);
      configRaw = gcsCredsJson;
    } else if (gcsCredsPath) {
      logger.debug(`Using configuration located at ${filepathVar.name}`);
      if (!fs.existsSync(gcsCredsPath)) {
        reportError(`File does not exist: ${gcsCredsPath}`);
      }
      configRaw = fs.readFileSync(gcsCredsPath).toString();
    } else {
      const errorMsg =
        `GCS credentials not found! Please provide the path to the ` +
        `configuration via environment variable ${filepathVar.name}, or ` +
        `specify the entire configuration in ${jsonVar.name}.`;
      reportError(errorMsg);
    }

    let creds = {};
    try {
      creds = JSON.parse(configRaw);
    } catch (err) {
      reportError('Error parsing JSON credentials');
    }

    return creds;
  };
}
