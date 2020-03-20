import {
  calculateChecksum,
  HashAlgorithm,
  HashOutputFormat,
} from '../utils/system';
import { clearObjectProperties } from '../utils/objects';
import * as _ from 'lodash';
import { ConfigurationError } from '../utils/errors';
import { logger } from '../logger';

/** Maximum concurrency for downloads */
export const MAX_DOWNLOAD_CONCURRENCY = 5;

/**
 * A generic artifact interface
 */
export interface CraftArtifact {
  /**
   * The name of the file which was uploaded, which will be given to the file
   * which is downloaded (these distinctions only bear mentioning because the
   * copy of the file held by the artifact store might have a different name)
   */
  filename: string;
  /** File MIME type. Not guaranteed to be a valid IETF RFC 6838 type. */
  mimeType?: string;
  /** Information about the file stored on the artifact provider */
  storedFile: {
    /**
     * The path on the artifact store from which the artifact can be downloaded
     * (includes filename)
     */
    downloadFilepath: string;
    /** Name of the file on the artifact provider */
    filename: string;
    /** Last modified time (in ISO format) of the file on the artifact store */
    lastUpdated?: string;
    /** Size of the file in bytes */
    size: number;
  };
  /** Location of the downloaded copy of the file (includes filename) */
  localFilepath?: string;
}

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
 * Base interface for artifact providers.
 */
export abstract class BaseArtifactProvider {
  /** Cache for local paths to downloaded files */
  protected readonly downloadCache: {
    [key: string]: Promise<string> | undefined;
  } = {};

  /** Cache for storing mapping between revisions and a list of their artifacts */
  protected readonly fileListCache: {
    [key: string]: CraftArtifact[] | undefined;
  } = {};

  /** Cache for checksums computed for the files stored on disk */
  protected readonly checksumCache: {
    [path: string]: { [checksumType: string]: string };
  } = {};

  /** Directory that will be used for downloading artifacts by default */
  protected defaultDownloadDirectory: string | undefined;

  public constructor(downloadDirectory?: string) {
    this.clearCaches();
    if (downloadDirectory) {
      this.setDownloadDirectory(downloadDirectory);
    }
  }

  /**
   * Sets the default download directory for the artifact provider
   *
   * @param downloadDirectory Path to the download directory
   */
  public setDownloadDirectory(downloadDirectory: string): void {
    if (downloadDirectory) {
      this.defaultDownloadDirectory = downloadDirectory;
    } else {
      throw new ConfigurationError('Download directory cannot be empty!');
    }
  }

  /**
   * Clears download and file caches
   */
  public clearCaches(): void {
    clearObjectProperties(this.downloadCache);
    clearObjectProperties(this.fileListCache);
    clearObjectProperties(this.checksumCache);
  }

  /**
   * Downloads the given artifact (if not already cached), and returns the
   * file's local path.
   *
   * The cache persists for the lifetime of the ArtifactProvider instance, so
   * the same file is downloaded only once.
   *
   * @param artifact An artifact object to download
   * @param downloadDirectory The local directory into which artifacts should be
   * downloaded
   * @returns Absolute path to the saved file
   */
  public async downloadArtifact(
    artifact: CraftArtifact,
    downloadDirectory?: string
  ): Promise<string> {
    let finalDownloadDirectory;
    if (downloadDirectory) {
      finalDownloadDirectory = downloadDirectory;
    } else if (this.defaultDownloadDirectory) {
      finalDownloadDirectory = this.defaultDownloadDirectory;
    } else {
      throw new Error('Download directory not configured!');
    }

    const cacheKey = `${finalDownloadDirectory}/${artifact.filename}/${artifact.storedFile.lastUpdated}`;
    const cached = this.downloadCache[cacheKey];
    if (cached) {
      return cached;
    }
    const promise = this.doDownloadArtifact(
      artifact,
      finalDownloadDirectory
    ).catch(err => {
      logger.error(
        `Unable to download ${artifact.filename} from artifact provider!`
      );
      throw err;
    });
    this.downloadCache[cacheKey] = promise;
    return promise;
  }

  /**
   * Downloads the given file from the artifact store.
   *
   * This method's caller caches downloaded files during the instance's
   * lifetime, so this method should only be called once per artifact
   *
   * @param artifact An artifact object to download
   * @param downloadDirectory Directory where downloaded artifact is stored
   * @returns Absolute path to the saved file
   */
  protected abstract async doDownloadArtifact(
    artifact: CraftArtifact,
    downloadDirectory: string
  ): Promise<string>;

  /**
   * Given an array of artifacts, returns an array of local paths to those
   * artifacts, downloading (and then caching) each file first if necessary.
   *
   * The cache persists for the lifetime of the ArtifactProvider instance, so
   * each file is downloaded only once.
   *
   * @param artifacts An array of artifact objects to download
   * @param downloadDirectory The local directory into which artifacts should be
   * downloaded
   * @returns Array of absolute paths to the saved files
   */
  public async downloadArtifacts(
    artifacts: CraftArtifact[],
    downloadDirectory?: string
  ): Promise<string[]> {
    return Promise.all(
      artifacts.map(async artifact =>
        this.downloadArtifact(artifact, downloadDirectory)
      )
    );
  }

  /**
   * Gets a list of all recent artifacts for the given revision, either from the
   * cache or from the provider's API.
   *
   * If there are several artifacts with the same name, returns the most recent
   * of them.
   *
   * @param revision Git commit id
   * @returns Filtered list of artifacts, or "undefined" if the revision cannot
   * be found
   */
  public async listArtifactsForRevision(
    revision: string
  ): Promise<CraftArtifact[] | undefined> {
    // check the cache first
    const cached = this.fileListCache[revision];
    if (cached) {
      return cached;
    }

    // the data wasn't in the cache, so now we have to go get it
    let artifacts;
    try {
      artifacts = await this.doListArtifactsForRevision(revision);
    } catch (err) {
      logger.error(
        `Unable to retrieve artifact list for revision ${revision}!`
      );
      throw err;
    }
    if (!artifacts) {
      // No negative caching
      return undefined;
    }

    // For every filename, take the artifact with the most recent update time
    const nameToArtifacts = _.groupBy(artifacts, artifact => artifact.filename);
    const dedupedArtifacts = Object.keys(nameToArtifacts).map(artifactName => {
      const artifactObjects = nameToArtifacts[artifactName];
      // Sort by the update time
      const sortedArtifacts = _.sortBy(
        artifactObjects,
        artifact => Date.parse(artifact.storedFile.lastUpdated || '') || 0
      );
      return sortedArtifacts[sortedArtifacts.length - 1];
    });

    return dedupedArtifacts;
  }

  /**
   * Retrieves a list of artifacts for the given revision from the provider's
   * API.
   *
   * This method's caller caches artifact lists during the instance's lifetime,
   * so this method should only be called once per revision.
   *
   * @param revision Git commit id
   * @returns Filtered list of artifacts, or "undefined" if the revision cannot
   * be found
   */
  protected abstract async doListArtifactsForRevision(
    revision: string
  ): Promise<CraftArtifact[] | undefined>;

  /**
   * Returns the calculated hash digest for the given artifact
   *
   * The results are cached.
   *
   * @param artifact Artifact we want to compute hash for
   * @param algorithm Hash algorithm
   * @param format Hash format
   * @returns Calculated hash value
   */
  public async getChecksum(
    artifact: CraftArtifact,
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

  /**
   * Gets a list of artifacts that match the provided `includeNames` and
   * `excludeNames` filtering options
   *
   * @param revision Git commit id
   * @param filterOptions Filtering options
   * @returns Filtered array of artifacts
   */
  public async filterArtifactsForRevision(
    revision: string,
    filterOptions?: FilterOptions
  ): Promise<CraftArtifact[]> {
    let filteredArtifacts = await this.listArtifactsForRevision(revision);
    if (!filteredArtifacts) {
      return [];
    }
    if (!filterOptions) {
      return filteredArtifacts;
    }
    const { includeNames, excludeNames } = filterOptions;
    if (includeNames) {
      filteredArtifacts = filteredArtifacts.filter(artifact =>
        includeNames.test(artifact.filename)
      );
    }
    if (excludeNames) {
      filteredArtifacts = filteredArtifacts.filter(
        artifact => !excludeNames.test(artifact.filename)
      );
    }
    return filteredArtifacts;
  }
}
