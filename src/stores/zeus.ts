import {
  Artifact,
  Client as ZeusClient,
  Result,
  RevisionInfo,
  Status,
  RepositoryInfo,
} from '@zeus-ci/sdk';

import { checkEnvForPrerequisite } from '../utils/env';
import {
  calculateChecksum,
  HashAlgorithm,
  HashOutputFormat,
} from '../utils/system';
import { clearObjectProperties } from '../utils/objects';
import { logger } from '../logger';

// TODO (kmclb) get rid of this file once artifact providers are done

/** Maximum concurrency for Zeus downloads */
export const ZEUS_DOWNLOAD_CONCURRENCY = 5;

/**
 * Fitlering options for artifacts
 */
export interface FilterOptions {
  /** Include files that match this regexp */
  includeNames?: RegExp;
  /** Exclude files that match this regexp */
  excludeNames?: RegExp;
}

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

  /** URL cache for downloaded files */
  private readonly downloadCache: {
    [key: string]: Promise<string> | undefined;
  } = {};

  /** Cache for storing mapping between revisions and a list of their artifacts */
  private readonly fileListCache: {
    [key: string]: Artifact[] | undefined;
  } = {};

  /** Cache for checksums computed for the files stored on disk */
  private readonly checksumCache: {
    [path: string]: { [checksumType: string]: string };
  } = {};

  public constructor(
    repoOwner: string,
    repoName: string,
    downloadDirectory?: string
  ) {
    checkEnvForPrerequisite({
      legacyName: 'ZEUS_TOKEN',
      name: 'ZEUS_API_TOKEN',
    });
    // We currently need ZEUS_TOKEN set for zeus-sdk to work properly
    if (!process.env.ZEUS_TOKEN) {
      process.env.ZEUS_TOKEN = process.env.ZEUS_API_TOKEN;
    }
    this.client = new ZeusClient({
      defaultDirectory: downloadDirectory,
      logger,
    });
    this.repoOwner = repoOwner;
    this.repoName = repoName;
  }

  /**
   * Clears download and file caches
   */
  public clearStoreCaches(): void {
    clearObjectProperties(this.downloadCache);
    clearObjectProperties(this.fileListCache);
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
   * Downloads the given list of artifacts.
   *
   * Downloaded files and their URLs are cached during the instance lifetime,
   * so the same file is downloaded only once.
   *
   * @param artifacts A list of artifact object to download
   */
  public async downloadArtifacts(artifacts: Artifact[]): Promise<string[]> {
    return Promise.all(
      artifacts.map(async artifact => this.downloadArtifact(artifact))
    );
  }

  /**
   * Gets a list of all recent artifacts for the given revision
   *
   * If there are several artifacts with the same name, returns the most recent
   * of them.
   *
   * @param revision Git commit id
   * @returns Filtered list of artifacts
   */
  public async listArtifactsForRevision(revision: string): Promise<Artifact[]> {
    const cached = this.fileListCache[revision];
    if (cached) {
      return cached;
    }
    const artifacts = await this.client.listArtifactsForRevision(
      this.repoOwner,
      this.repoName,
      revision
    );

    // For every filename, take the artifact with the most recent update time
    const filteredArtifacts = artifacts
      .sort((a, b) => {
        if (a.name < b.name) {
          return -1;
        } else if (a.name > b.name) {
          return 1;
        } else {
          const aUpdatedAt = Date.parse(a.updated_at ?? '') || 0;
          const bUpdatedAt = Date.parse(b.updated_at ?? '') || 0;
          if (aUpdatedAt < bUpdatedAt) {
            return -1;
          } else if (aUpdatedAt > bUpdatedAt) {
            return 1;
          } else {
            return 0;
          }
        }
      })
      .filter((artifact, idx, arr) => artifact.name !== arr[idx + 1]?.name);

    this.fileListCache[revision] = filteredArtifacts;
    return filteredArtifacts;
  }

  /**
   * Gets a list of artifacts that match the provided filtering options
   *
   * @param revision Git commit id
   * @param filterOptions Filtering options
   */
  public async filterArtifactsForRevision(
    revision: string,
    filterOptions?: FilterOptions
  ): Promise<Artifact[]> {
    let filteredArtifacts = await this.listArtifactsForRevision(revision);
    if (!filterOptions) {
      return filteredArtifacts;
    }
    const { includeNames, excludeNames } = filterOptions;
    if (includeNames) {
      filteredArtifacts = filteredArtifacts.filter(artifact =>
        includeNames.test(artifact.name)
      );
    }
    if (excludeNames) {
      filteredArtifacts = filteredArtifacts.filter(
        artifact => !excludeNames.test(artifact.name)
      );
    }
    return filteredArtifacts;
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

  /**
   * Checks if the revision's builds have failed
   *
   * @param revisionInfo Revision information as returned from getRevision()
   */
  public isRevisionFailed(revisionInfo: RevisionInfo): boolean {
    return (
      revisionInfo.status === Status.FINISHED &&
      revisionInfo.result !== Result.PASSED
    );
  }

  /**
   * Checks if the revision has some pending/unfinished builds
   *
   * @param revisionInfo Revision information as returned from getRevision()
   */
  public isRevisionPending(revisionInfo: RevisionInfo): boolean {
    return revisionInfo.status !== Status.FINISHED;
  }

  /**
   * Gets repository information
   *
   * TODO: this RepositoryInfo is from zeus-sdk.
   */
  public async getRepositoryInfo(): Promise<RepositoryInfo> {
    return this.client.getRepositoryInfo(this.repoOwner, this.repoName);
  }

  /**
   * Returns the calculated hash digest for the given artifact
   *
   * The results are cached using the cache object attached to the ZeusStore instance.   *
   *
   * @param artifact Artifact we want to compute hash for
   * @param algorithm Hash algorithm
   * @param format Hash format
   */
  public async getChecksum(
    artifact: Artifact,
    algorithm: HashAlgorithm,
    format: HashOutputFormat
  ): Promise<string> {
    const filePath = await this.downloadArtifact(artifact);
    const checksumKey = `${algorithm}__${format}`;
    if (!this.checksumCache[filePath]) {
      this.checksumCache[filePath] = {};
    }

    if (!this.checksumCache[filePath][checksumKey]) {
      const checksum = await calculateChecksum(filePath, { algorithm, format });
      this.checksumCache[filePath][checksumKey] = checksum;
    }

    return this.checksumCache[filePath][checksumKey];
  }
}

export { RevisionInfo };
