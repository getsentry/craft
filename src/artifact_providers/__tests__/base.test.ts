import { parseFilterOptions, RawFilterOptions } from '../base';

describe('parseFilterOptions', () => {
  test('empty object', () => {
    const rawFilters: RawFilterOptions = {};
    const parsedFilters = parseFilterOptions(rawFilters);
    expect(parsedFilters).not.toHaveProperty('includeNames');
    expect(parsedFilters).not.toHaveProperty('excludeNames');
  });

  test.each([
    [undefined, undefined],
    [undefined, '/exclude/'],
    [undefined, /exclude/],
    ['/include/', undefined],
    [/include/, undefined],
    ['/include/', '/exclude/'],
    ['/include/', /exclude/],
    [/include/, '/exclude/'],
    [/include/, /exclude/],
  ])(
    'undefined, string and regexp properties',
    (includeNames, excludeNames) => {
      const rawFilters: RawFilterOptions = {
        includeNames: includeNames,
        excludeNames: excludeNames,
      };
      const parsedFilters = parseFilterOptions(rawFilters);

      expect(parsedFilters.includeNames).toStrictEqual(
        includeNames && /include/
      );

      expect(parsedFilters.excludeNames).toStrictEqual(
        excludeNames && /exclude/
      );
    }
  );
});
