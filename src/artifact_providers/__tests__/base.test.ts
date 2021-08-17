import { stringToRegexp } from '../../utils/filters';
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
    [undefined, '/onlyExclude/'],
    ['/onlyInclude/', undefined],
    ['/include/', '/exclude/'],
  ])('undefined and string properties', (includeNames, excludeNames) => {
    const rawFilters: RawFilterOptions = {
      includeNames: includeNames,
      excludeNames: excludeNames,
    };
    const parsedFilters = parseFilterOptions(rawFilters);

    if (includeNames) {
      expect(parsedFilters.includeNames).toStrictEqual(
        stringToRegexp(includeNames)
      );
    } else {
      expect(parsedFilters.includeNames).not.toBeDefined();
    }
    if (excludeNames) {
      expect(parsedFilters.excludeNames).toStrictEqual(
        stringToRegexp(excludeNames)
      );
    } else {
      expect(parsedFilters.excludeNames).not.toBeDefined();
    }
  });

  test.each([
    [undefined, undefined],
    [undefined, new RegExp('onlyExclude')],
    [new RegExp('onlyInclude'), undefined],
    [new RegExp('include'), new RegExp('exclude')],
  ])('undefined and regex properties', (includeNames, excludeNames) => {
    const rawFilters: RawFilterOptions = {
      includeNames: includeNames,
      excludeNames: excludeNames,
    };
    const parsedFilters = parseFilterOptions(rawFilters);

    if (includeNames) {
      expect(parsedFilters.includeNames).toStrictEqual(includeNames);
    } else {
      expect(parsedFilters.includeNames).not.toBeDefined();
    }
    if (excludeNames) {
      expect(parsedFilters.excludeNames).toStrictEqual(excludeNames);
    } else {
      expect(parsedFilters.excludeNames).not.toBeDefined();
    }
  });

  test('string and regex properties', () => {
    const strIncNames: RawFilterOptions = {
      includeNames: '/string/',
      excludeNames: new RegExp('regexp'),
    };
    const parsedStrInc = parseFilterOptions(strIncNames);
    expect(parsedStrInc.includeNames).toStrictEqual(stringToRegexp('/string/'));
    expect(parsedStrInc.excludeNames).toStrictEqual(new RegExp('regexp'));

    const rgxIncNames: RawFilterOptions = {
      includeNames: new RegExp('regexp'),
      excludeNames: '/string/',
    };
    const parsedRgxInc = parseFilterOptions(rgxIncNames);
    expect(parsedRgxInc.includeNames).toStrictEqual(new RegExp('regexp'));
    expect(parsedRgxInc.excludeNames).toStrictEqual(stringToRegexp('/string/'));
  });
});
