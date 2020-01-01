import {
  calculateChecksum,
  HashAlgorithm,
  HashOutputFormat,
} from '../utils/system';
import { clearObjectProperties } from '../utils/objects';
import * as _ from 'lodash';

/**
 * TODO
 */
export interface CraftArtifact {
  download_url: string;
  name: string;
  updated_at?: string;
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

/** TODO */
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

  public constructor() {
    this.clearCaches();
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
  public async downloadArtifact(artifact: CraftArtifact): Promise<string> {
    const cached = this.downloadCache[artifact.download_url];
    if (cached) {
      return cached;
    }
    const promise = this.doDownloadArtifact(artifact);
    this.downloadCache[artifact.download_url] = promise;
    return promise;
  }

  /** TODO */
  protected abstract async doDownloadArtifact(
    artifact: CraftArtifact
  ): Promise<string>;

  /** TODO */
  public async downloadArtifacts(
    artifacts: CraftArtifact[]
  ): Promise<string[]> {
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
  public async listArtifactsForRevision(
    revision: string
  ): Promise<CraftArtifact[]> {
    const cached = this.fileListCache[revision];
    if (cached) {
      return cached;
    }
    const artifacts = await this.doListArtifactsForRevision(revision);
    this.fileListCache[revision] = artifacts;
    return artifacts;
  }

  /** TODO */
  protected abstract async doListArtifactsForRevision(
    revision: string
  ): Promise<CraftArtifact[]>;

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
