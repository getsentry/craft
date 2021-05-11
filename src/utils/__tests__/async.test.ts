import { setGlobals } from '../../utils/helpers';
import { filterAsync, forEachChained } from '../async';
import { logger } from '../../logger';

jest.mock('../../logger');

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
      setGlobals({ 'dry-run': false, 'log-level': 'Info', "no-input": true });
    });

    it('blows up the first time sync iteratee errors (non-dry-run mode)', async () => {
      await regularModeExpectCheck(syncIteratee);
    });

    it('blows up the first time async iteratee errors (non-dry-run mode)', async () => {
      await regularModeExpectCheck(asyncIteratee);
    });

    it('logs error but keeps going if in dry-run mode - sync iteratee', async () => {
      setGlobals({ 'dry-run': true, 'log-level': 'Info', "no-input": true });
      await dryrunModeExpectCheck(syncIteratee);
    });

    it('logs error but keeps going if in dry-run mode - async iteratee', async () => {
      setGlobals({ 'dry-run': true, 'log-level': 'Info', "no-input": true });
      await dryrunModeExpectCheck(asyncIteratee);
    });
  }); // end describe('sync and async iteratees in regular and dry-run mode')
});
