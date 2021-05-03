import {
  BaseArtifactProvider,
  RemoteArtifact,
} from "../artifact_providers/base";
import { ConfigurationError } from "./errors";
import { HashAlgorithm, HashOutputFormat } from "./system";

/** Describes a checksum entry. */
export interface ChecksumEntry {
  /** Checksum (hash) algorithm */
  algorithm: HashAlgorithm;
  /** Checksum format */
  format: HashOutputFormat;
}

/**
 * Checks the provided checksums configuration.
 *
 * TODO: this all has to be replaced with JSON schema.
 *
 * @param checksums Raw checksum configuration.
 */
export function castChecksums(checksums: any[]): ChecksumEntry[] {
  if (!checksums) {
    return [];
  }
  if (!Array.isArray(checksums)) {
    throw new ConfigurationError(
      'Invalid type of "checksums": should be an array'
    );
  }
  return checksums.map(
    (item: any): ChecksumEntry => {
      if (typeof item !== "object" || !item.algorithm || !item.format) {
        throw new ConfigurationError(
          `Invalid checksum type: ${JSON.stringify(item)}`
        );
      }
      if (
        !Object.values(HashAlgorithm).includes(item.algorithm) ||
        !Object.values(HashOutputFormat).includes(item.format)
      ) {
        throw new ConfigurationError(
          `Invalid checksum type: ${JSON.stringify(item)}`
        );
      }
      return {
        algorithm: item.algorithm,
        format: item.format,
      };
    }
  );
}

/**
 * Retrieves a mapping from the provided checksums to the computed checksum.
 * @param checksums List of checksums to be calculated.
 * @param artifact The artifact to calculate the checksums of.
 * @param artifactProvider The artifact provider to get the checksum of.
 */
export async function getArtifactChecksums(
  checksums: ChecksumEntry[],
  artifact: RemoteArtifact,
  artifactProvider: BaseArtifactProvider
): Promise<{
  [key: string]: string;
}> {
  const fileChecksums: { [key: string]: string } = {};
  for (const checksumType of checksums) {
    const { algorithm, format } = checksumType;
    const currentChecksum = await artifactProvider.getChecksum(
      artifact,
      algorithm,
      format
    );
    fileChecksums[`${algorithm}-${format}`] = currentChecksum;
  }
  return fileChecksums;
}
