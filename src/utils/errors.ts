import { logger } from '../logger';
import { isDryRun } from './helpers';
import { captureException } from '@sentry/node';

/**
 * Custom error class that describes client configuration errors
 */
export class ConfigurationError extends Error {
  // We have to do the following because of: https://github.com/Microsoft/TypeScript/issues/13965
  // Otherwise we cannot use instanceof later to catch a given type
  /** Error prototype */
  public __proto__: Error;

  public constructor(message?: string) {
    const trueProto = new.target.prototype;
    super(message);

    this.__proto__ = trueProto;
  }
}

/**
 * Writes an error or message to "error" log if in dry-mode, throws an error
 * otherwise
 *
 * @param error Error object or error message
 * @param errorLogger Optional logger to use
 */
export function reportError(
  error: Error | string,
  errorLogger: {
    error: (...message: string[]) => void;
    [key: string]: any;
  } = logger
): void {
  if (!isDryRun()) {
    // wrap the error in an Error object if it isn't already one
    const errorObj = error instanceof Error ? error : new Error(error);
    throw errorObj;
  } else {
    // conversely, convert the error to a string if it isn't already one
    const errorStr = typeof error === 'string' ? error : String(error);
    errorLogger.error(`[dry-run] ${errorStr}`);
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
    | 'bigint'
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
      message ||
        `${String(obj)} is of type "${objType}" (expected: "${typeName}")`
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
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function handleGlobalError(e: any): void {
  if (!(e instanceof ConfigurationError)) {
    captureException(e);
  }
  logger.error(e);
  process.exitCode = 1;
}
