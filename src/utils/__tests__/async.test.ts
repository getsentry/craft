import { setGlobals } from '../../utils/helpers';
import { filterAsync, forEachChained, withRetry, sleep } from '../async';
import { logger } from '../../logger';

jest.mock('../../logger');

import { retrySpawnProcess } from '../async';
import { spawnProcess } from '../system';

jest.mock('../system', () => {
  const original = jest.requireActual('../system');
  return {
    ...original,
    spawnProcess: jest.fn(original.spawnProcess),
  };
});

describe('retrySpawnProcess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolves before max retries', async () => {
    const res = await retrySpawnProcess('ls', [], undefined, undefined, {
      maxRetries: 1,
    });
    expect(res).toBeInstanceOf(Buffer);
  });

  test('hits max retries and exits', async () => {
    const numRetries = 3;
    const delay = 0.01;
    const expFactor = 2;
    let startTime = -1;

    try {
      startTime = new Date().getTime();
      await retrySpawnProcess(
        'thisCommandDoesntExist', // command
        [], // args
        undefined, // spawnoptions
        undefined, // spawn process options
        {
          // retry options
          maxRetries: numRetries,
          retryDelay: delay,
          retryExpFactor: expFactor,
        }
      );
    } catch (error) {
      const endTime = new Date().getTime();

      let delayThreshold = 0;
      let retriesLeft = numRetries;
      let currentDelay = delay;
      while (retriesLeft > 0) {
        delayThreshold += currentDelay;
        currentDelay *= expFactor;
        retriesLeft--;
      }
      // Parsing seconds to miliseconds may be more accurate than
      // the other way around
      delayThreshold *= 1000;
      expect(endTime - startTime).toBeGreaterThanOrEqual(delayThreshold);
      expect(error.message).toMatch(`Max retries reached: ${numRetries}`);
      expect(spawnProcess).toHaveBeenCalledTimes(numRetries);
    }
  });
});

describe('filterAsync', () => {
  test('filters with sync predicate', async () => {
    expect.assertions(1);
    const filtered = await filterAsync([1, 2, 3, 4], i => i > 2);
    expect(filtered).toEqual([3, 4]);
  });

  test('filters with async predicate', async () => {
    expect.assertions(1);

    const predicate = (i: number) =>
      new Promise<boolean>(resolve =>
        setTimeout(() => resolve(i > 2), i * 100)
      );
    const filtered = await filterAsync([1, 2, 3, 4], predicate);
    expect(filtered).toEqual([3, 4]);
  });

  test('passes filter arguments to the predicate', async () => {
    expect.assertions(1);

    const arr = [1];
    const predicate = jest.fn();

    await filterAsync(arr, predicate);
    expect(predicate).toHaveBeenCalledWith(1, 0, arr);
  });

  test('passes this to the predicate', async () => {
    expect.assertions(1);

    const that = { key: 'value' };
    await filterAsync(
      [1],
      function predicate(): any {
        expect(this).toBe(that);
      },
      that
    );
  });
});

describe('forEachChained', () => {
  test('invokes synchronous actions', async () => {
    expect.assertions(1);

    const fun = jest.fn();
    const arr = ['a', 'b', 'c'];
    await forEachChained(arr, fun);

    expect(fun.mock.calls).toEqual([
      ['a', 0, arr],
      ['b', 1, arr],
      ['c', 2, arr],
    ]);
  });

  test('invokes asynchronous actions sequentially', async () => {
    expect.assertions(1);

    const fun = jest.fn();
    const arr = [500, 300, 100];

    fun.mockImplementation(
      timeout => new Promise(resolve => setTimeout(resolve, timeout))
    );

    await forEachChained(arr, fun);
    expect(fun.mock.calls).toEqual([
      [500, 0, arr],
      [300, 1, arr],
      [100, 2, arr],
    ]);
  });

  test('passes this to the action', async () => {
    expect.assertions(1);

    const that = { '1': 2 };
    await forEachChained(
      [1],
      function action(): void {
        expect(this).toBe(that);
      },
      that
    );
  });

  describe('sync and async iteratees in regular and dry-run mode', () => {
    const arr = ['first', 'second', 'third', 'fourth'];

    function syncIteratee(arrEntry: string): string {
      logger.debug(`Processing array entry \`${arrEntry}\``);

      if (arrEntry === 'second' || arrEntry === 'fourth') {
        throw new Error('drat');
      } else {
        return 'yay!';
      }
    }

    function asyncIteratee(arrEntry: string): Promise<string> {
      logger.debug(`Processing array entry \`${arrEntry}\``);

      if (arrEntry === 'second' || arrEntry === 'fourth') {
        return Promise.reject(new Error('drat'));
      } else {
        return Promise.resolve('yay!');
      }
    }

    async function regularModeExpectCheck(
      iteratee: (entry: string) => string | Promise<string>
    ): Promise<void> {
      expect.assertions(3);

      // check that the error does actually get thrown, the first time it hits a
      // problematic entry
      await expect(forEachChained(arr, iteratee)).rejects.toThrowError('drat');
      expect(logger.debug).toHaveBeenCalledWith(
        'Processing array entry `second`'
      );

      // we didn't get this far
      expect(logger.debug).not.toHaveBeenCalledWith(
        'Processing array entry `third`'
      );
    }

    async function dryrunModeExpectCheck(
      iteratee: (entry: string) => string | Promise<string>
    ): Promise<void> {
      expect.assertions(3);

      // check that it logs the error rather than throws it
      await expect(forEachChained(arr, iteratee)).resolves.not.toThrowError();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('drat')
      );

      // check that it's gotten all the way through the array
      expect(logger.debug).toHaveBeenCalledWith(
        'Processing array entry `fourth`'
      );
    }

    beforeEach(() => {
      setGlobals({ 'dry-run': false, 'log-level': 'Info', 'no-input': true });
    });

    it('blows up the first time sync iteratee errors (non-dry-run mode)', async () => {
      await regularModeExpectCheck(syncIteratee);
    });

    it('blows up the first time async iteratee errors (non-dry-run mode)', async () => {
      await regularModeExpectCheck(asyncIteratee);
    });

    it('logs error but keeps going if in dry-run mode - sync iteratee', async () => {
      setGlobals({ 'dry-run': true, 'log-level': 'Info', 'no-input': true });
      await dryrunModeExpectCheck(syncIteratee);
    });

    it('logs error but keeps going if in dry-run mode - async iteratee', async () => {
      setGlobals({ 'dry-run': true, 'log-level': 'Info', 'no-input': true });
      await dryrunModeExpectCheck(asyncIteratee);
    });
  });
});

describe('sleepAsync', () => {
  test('sleeps for at least the given number of ms', async () => {
    const sleepMs = 50;
    const timeStart = new Date().getTime();
    await sleep(sleepMs);
    const timeEnd = new Date().getTime();
    const diff = timeEnd - timeStart;
    expect(diff).toBeGreaterThanOrEqual(sleepMs - 1);
    expect(diff).toBeLessThan(sleepMs * 2);
  });
});

describe('withRetry', () => {
  test('fails after max retries', async () => {
    const fn = () => {
      throw new Error('I always fail');
    };
    await expect(withRetry(fn)).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Max retries reached: 3"`
    );
  });

  test('passes on second try', async () => {
    let counter = 0;
    const fn = async () => {
      counter += 1;
      if (counter % 2) {
        throw new Error('I fail on odd numbers');
      }
      return 'success';
    };
    await expect(withRetry(fn)).resolves.toBe('success');
  });

  test('fails when onRetry returns false', async () => {
    let counter = 0;
    const fn = async () => {
      counter += 1;
      if (counter % 2) {
        throw new Error('I fail on odd numbers');
      }
      return 'success';
    };
    await expect(
      withRetry(fn, 5, () => Promise.resolve(false))
    ).rejects.toThrowErrorMatchingInlineSnapshot(`"Cancelled retry"`);
  });

  test('fails when onRetry throws', async () => {
    let counter = 0;
    const fn = async () => {
      counter += 1;
      if (counter % 2) {
        throw new Error('I fail on odd numbers');
      }
      return 'success';
    };
    await expect(
      withRetry(fn, 5, () => Promise.reject(new Error('no retries')))
    ).rejects.toThrowErrorMatchingInlineSnapshot(`"Cancelled retry"`);
  });
});
