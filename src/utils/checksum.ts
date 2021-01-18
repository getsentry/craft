import { ConfigurationError } from './errors';
import { HashAlgorithm, HashOutputFormat } from './system';

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
      if (typeof item !== 'object' || !item.algorithm || !item.format) {
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
