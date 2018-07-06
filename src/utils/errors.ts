import { shouldPerform } from 'dryrun';
import logger from '../logger';

/**
 * Writes a message to "error" log if in dry-mode, throws an error otherwise
 *
 * @param message Error message
 * @param customLogger Optional logger to use
 */
export function reportError(message: string, customLogger?: any): void {
  const errorLogger = customLogger || logger;
  if (shouldPerform()) {
    throw new Error(message);
  } else {
    errorLogger.error(`[dry-run] ${message}`);
  }
}
