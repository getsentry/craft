import { reportError } from './errors';

/**
 * Asynchronously calls the predicate on every element of the array and filters
 * for all elements where the predicate resolves to true.
 *
 * @param array An array to filter
 * @param predicate A predicate function that resolves to a boolean
 * @param thisArg Optional argument passed as this to the predicate
 * @returns The filtered array
 * @async
 */
export async function filterAsync<T>(
  array: T[],
  predicate: (arg: T) => boolean | Promise<boolean>,
  thisArg?: unknown
): Promise<T[]> {
  const verdicts = await Promise.all(array.map(predicate, thisArg));
  return array.filter((_element, index) => verdicts[index]);
}

/**
 * Asynchronously calls the iteratee on each element of the array one element at
 * a time. This results in a chain of asynchronous actions that resolves once
 * the last item action has completed. In contrast, `Promise.all` executes each
 * promise simultaneously.
 *
 * The iteratee is invoked as with `Array.forEach`: It receives the current
 * element, index and the array. This is bound to `thisArg` if present.
 *
 * @param array An array to iterate over
 * @param iteratee An action function that receives the element
 * @param thisArg  Optional argument passed as this to the action
 * @returns Resolves when the last action has completed
 * @async
 */
export async function forEachChained<T>(
  array: T[],
  iteratee: (x: T) => any,
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  thisArg?: any
): Promise<void> {
  return array.reduce(
    async (prev, ...args: [T]) =>
      // catching errors after each .then() lets us report them and keep going
      // if in dry-run mode (in regular mode, reportError() just re-throws)
      prev.then(() => iteratee.apply(thisArg, args)).catch(reportError),
    Promise.resolve()
  );
}

/**
 * Sleep for the provided number of milliseconds
 *
 * @param ms Milliseconds to sleep
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Standard error extender from @mhio/exception
class ExtendedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    this.message = message;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}

class RetryError extends ExtendedError {
  constructor(message: string, error: Error) {
    super(message);
    const messageLines = (this.message.match(/\r?\n/g) || []).length + 1;
    const stackList = (this.stack || '')
      .split(/\r?\n/)
      .slice(0, messageLines + 1);
    if (error.stack) {
      stackList.push(error.stack);
    }
    this.stack = stackList.join('\n');
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  onRetry?: (err: Error) => Promise<boolean>
): Promise<T> {
  if (!onRetry) {
    onRetry = () => Promise.resolve(true);
  }
  let error,
    tries = 0;
  while (maxRetries > tries) {
    try {
      return await fn();
    } catch (err) {
      error = err;
      tries += 1;
      try {
        const shouldBreak = !(await onRetry(error));
        if (shouldBreak) {
          break;
        }
      } catch (onRetryErr) {
        error = onRetryErr;
        break;
      }
    }
  }
  if (tries >= maxRetries) {
    throw new RetryError(`Max retries reached: ${maxRetries}`, error);
  } else {
    throw new RetryError('Cancelled retry', error);
  }
}
