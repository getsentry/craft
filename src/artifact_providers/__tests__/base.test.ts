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
    [undefined, new RegExp('exclude')],
    ['/include/', undefined],
    [new RegExp('include'), undefined],
    ['/include/', '/exclude/'],
    ['/include/', new RegExp('exclude')],
    [new RegExp('include'), '/exclude/'],
    [new RegExp('include'), new RegExp('exclude')],
  ])(
    'undefined, string and regexp properties',
    (includeNames, excludeNames) => {
      const rawFilters: RawFilterOptions = {
        includeNames: includeNames,
        excludeNames: excludeNames,
      };
      const parsedFilters = parseFilterOptions(rawFilters);

      if (includeNames) {
        expect(parsedFilters.includeNames).toStrictEqual(
          typeof includeNames === 'string'
            ? new RegExp(includeNames.slice(1, -1))
            : includeNames
        );
      } else {
        expect(parsedFilters.includeNames).not.toBeDefined();
      }

      if (excludeNames) {
        expect(parsedFilters.excludeNames).toStrictEqual(
          typeof excludeNames === 'string'
            ? new RegExp(excludeNames.slice(1, -1))
            : excludeNames
        );
      } else {
        expect(parsedFilters.excludeNames).not.toBeDefined();
      }
    }
  );
});
