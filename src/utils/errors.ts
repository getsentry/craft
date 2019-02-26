import { shouldPerform } from 'dryrun';
import { logger } from '../logger';
import { captureException } from './sentry';

/**
 * Custom error class that describes client configuration errors
 */
export class ConfigurationError extends Error {
  // We have to do the following because of: https://github.com/Microsoft/TypeScript/issues/13965
  // Otherwise we cannot use instanceof later to catch a given type
  /** Error prototype */
  // tslint:disable-next-line:variable-name
  public __proto__: Error;

  public constructor(message?: string) {
    const trueProto = new.target.prototype;
    super(message);

    this.__proto__ = trueProto;
  }
}

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

/**
 * Checks at runtime that the type of the object is what we expect it is
 *
 * Throws an error if the type of the object is different.
 *
 * @param obj Object, which type we're checking
 * @param typeName Expected type name
 * @param message Optional error message
 */
export function coerceType<T>(
  obj: T,
  typeName:
    | 'string'
    | 'number'
    | 'boolean'
    | 'symbol'
    | 'undefined'
    | 'object'
    | 'function',
  message?: string
): T | never {
  const objType = typeof obj;
  if (objType !== typeName) {
    throw new TypeError(
      message || `${obj} is of type "${objType}" (expected: "${typeName}")`
    );
  }
  return obj;
}

/**
 * Processes an uncaught exception on the global level
 *
 * Sends the error to Sentry if Sentry SDK is configured.
 * It is expected that the program is terminated soon after
 * this function is called.
 *
 * @param e Error (exception) object to handle
 */
export function handleGlobalError(e: any): void {
  if (!(e instanceof ConfigurationError)) {
    captureException(e);
  }
  logger.error(e);
  process.exitCode = 1;
}
