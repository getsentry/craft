import {
  calculateChecksum,
  HashAlgorithm,
  HashOutputFormat,
} from '../utils/system';
import { clearObjectProperties } from '../utils/objects';
import * as _ from 'lodash';
import { ConfigurationError } from '../utils/errors';

/** Maximum concurrency for downloads */
export const MAX_DOWNLOAD_CONCURRENCY = 5;

/**
 * A generic artifact interface
 */
export interface CraftArtifact {
  download_url: string;
  name: string;
  updated_at?: string;
  type?: string;
  file: {
    name: string;
    size: number;
  };
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
  /** URL cache for downloaded files */
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
   * Set the default download directory for the artifact provider
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
   * Downloads the given artifact file.
   *
   * Downloaded URL are cached during the instance's lifetime, so the same
   * file is downloaded only once.
   *
   * @param artifact An artifact object to download
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

    const cacheKey = `${finalDownloadDirectory}/${artifact.name}/${artifact.updated_at}`;
    const cached = this.downloadCache[cacheKey];
    if (cached) {
      return cached;
    }
    const promise = this.doDownloadArtifact(artifact, finalDownloadDirectory);
    this.downloadCache[cacheKey] = promise;
    return promise;
  }

  /**
   * Downloads the given artifact file (without caching)
   */
  protected abstract async doDownloadArtifact(
    artifact: CraftArtifact,
    downloadDirectory: string
  ): Promise<string>;

  /**
   * Downloads multiple artifacts to the given directory
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
   * Gets a list of all recent artifacts for the given revision
   *
   * If there are several artifacts with the same name, returns the most recent
   * of them.
   * The results are cached.
   *
   * @param revision Git commit id
   * @returns Filtered list of artifacts, or "undefined" if the revision can not be found
   */
  public async listArtifactsForRevision(
    revision: string
  ): Promise<CraftArtifact[] | undefined> {
    const cached = this.fileListCache[revision];
    if (cached) {
      return cached;
    }
    const artifacts = await this.doListArtifactsForRevision(revision);
    if (!artifacts) {
      // No negative caching
      return undefined;
    }

    // For every filename, take the artifact with the most recent update time
    const nameToArtifacts = _.groupBy(artifacts, artifact => artifact.name);
    const dedupedArtifacts = Object.keys(nameToArtifacts).map(artifactName => {
      const artifactObjects = nameToArtifacts[artifactName];
      // Sort by the update time
      const sortedArtifacts = _.sortBy(
        artifactObjects,
        artifact => Date.parse(artifact.updated_at || '') || 0
      );
      return sortedArtifacts[sortedArtifacts.length - 1];
    });

    return dedupedArtifacts;
  }

  /**
   * List artifacts for the given revision (without caching)
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
   * Gets a list of artifacts that match the provided filtering options
   *
   * @param revision Git commit id
   * @param filterOptions Filtering options
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
}
