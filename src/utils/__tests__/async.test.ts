import { filterAsync, forEachChained, promiseProps } from '../async';

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

describe('promiseProps', () => {
  test('awaits an empty object', async () => {
    expect.assertions(1);
    const result = await promiseProps({});
    expect(result).toEqual({});
  });

  test('awaits a plain object', async () => {
    expect.assertions(1);
    const result = await promiseProps({ foo: 'foo', bar: 42 });
    expect(result).toEqual({ foo: 'foo', bar: 42 });
  });

  test('awaits an object with promises', async () => {
    expect.assertions(1);
    const result = await promiseProps({
      bar: Promise.resolve(42),
      foo: Promise.resolve('foo'),
    });
    expect(result).toEqual({ foo: 'foo', bar: 42 });
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

    const that = {};
    await forEachChained(
      [1],
      function action(): void {
        expect(this).toBe(that);
      },
      that
    );
  });
});
