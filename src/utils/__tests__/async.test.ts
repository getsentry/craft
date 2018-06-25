describe('filterAsync', () => {
  const { filterAsync } = require('../async');

  test('filters with sync predicate', async () => {
    expect.assertions(1);
    const filtered = await filterAsync([1, 2, 3, 4], i => i > 2);
    expect(filtered).toEqual([3, 4]);
  });

  test('filters with async predicate', async () => {
    expect.assertions(1);

    const predicate = i =>
      new Promise(resolve => setTimeout(() => resolve(i > 2), i * 100));
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
