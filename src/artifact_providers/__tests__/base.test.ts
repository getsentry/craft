import { stringToRegexp } from '../../utils/filters';
import { parseFilterOptions, RawFilterOptions } from '../base';

describe('parseFilterOptions', () => {
  test('empty object', () => {
    const rawFilters: RawFilterOptions = {};
    const parsedFilters = parseFilterOptions(rawFilters);
    expect(parsedFilters).not.toHaveProperty('includeNames');
    expect(parsedFilters).not.toHaveProperty('excludeNames');
  });

  test('undefined properties', () => {
    const rawFilters: RawFilterOptions = {
      includeNames: undefined,
      excludeNames: undefined,
    };
    const parsedFilters = parseFilterOptions(rawFilters);
    expect(parsedFilters).not.toHaveProperty('includeNames');
    expect(parsedFilters).not.toHaveProperty('excludeNames');
  });

  test('string properties', () => {
    const stringFilter = '/testFilter/';
    const rawFilters: RawFilterOptions = {
      includeNames: stringFilter,
    };
    const parsedFilters = parseFilterOptions(rawFilters);
    expect(parsedFilters.includeNames).toStrictEqual(
      stringToRegexp(stringFilter)
    );
  });

  test('regex properties', () => {
    const regexFilter = stringToRegexp('/testFilter/');
    const rawFilters: RawFilterOptions = {
      includeNames: regexFilter,
    };
    const parsedFilters = parseFilterOptions(rawFilters);
    expect(parsedFilters.includeNames).toStrictEqual(regexFilter);
  });
});
