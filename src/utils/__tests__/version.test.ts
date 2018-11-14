/* eslint-env jest */

import {
  getVersion,
  isPreviewRelease,
  isValidVersion,
  parseVersion,
  SemVer,
  versionGreaterOrEqualThan,
} from '../version';

describe('getVersion', () => {
  test('extracts a basic SemVer versions', () => {
    expect(getVersion('1.0.0')).toBe('1.0.0');
  });

  test('extracts a SemVer version with leading "v"', () => {
    expect(getVersion('v1.0.0')).toBe('1.0.0');
  });

  test('extracts a SemVer version from text', () => {
    expect(getVersion('1.0.0 (foobar)')).toBe('1.0.0');
  });
});

describe('isValidVersion', () => {
  test('accepts valid version', () => {
    expect(isValidVersion('1.2.3')).toBe(true);
  });

  test('accepts valid pre-release version', () => {
    expect(isValidVersion('1.2.3-beta')).toBe(true);
  });

  test('accepts valid Python-style version', () => {
    expect(isValidVersion('1.2.3rc1')).toBe(true);
  });

  test('does not accept leading "v"', () => {
    expect(isValidVersion('v1.2.3')).toBe(false);
  });
});

describe('parseVersion', () => {
  test('parses a full SemVer version', () => {
    expect(parseVersion('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    });
  });

  test('parses a SemVer with leading "v"', () => {
    expect(parseVersion('v1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    });
  });

  test('parses a pre-release SemVer', () => {
    expect(parseVersion('v1.2.3-beta')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      pre: 'beta',
    });
  });

  test('parses a complicated pre-release SemVer', () => {
    expect(parseVersion('v1.2.3-beta.1')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      pre: 'beta.1',
    });
  });

  test('parses a SemVer with build metadata', () => {
    expect(parseVersion('v1.2.3+linux')).toEqual({
      build: 'linux',
      major: 1,
      minor: 2,
      patch: 3,
    });
  });

  test('parses a pre-release SemVer with build metadata', () => {
    expect(parseVersion('v1.2.3-beta+linux')).toEqual({
      build: 'linux',
      major: 1,
      minor: 2,
      patch: 3,
      pre: 'beta',
    });
  });

  test('parses a Python-style version', () => {
    expect(parseVersion('v11.22.33rc1')).toEqual({
      major: 11,
      minor: 22,
      patch: 33,
      pre: 'rc1',
    });
  });

  test('does not parse an invalid version', () => {
    expect(parseVersion('v1.2')).toBeNull();
  });
});

describe('isPreviewRelease', () => {
  test('accepts semver preview release', () => {
    expect(isPreviewRelease('2.3.4-preview1')).toBe(true);
  });

  test('accepts Python-style preview release', () => {
    expect(isPreviewRelease('2.3.4rc0')).toBe(true);
  });

  test('does not accept non-preview release', () => {
    expect(isPreviewRelease('2.3.4')).toBe(false);
  });

  test('does not accept non-release strings', () => {
    expect(isPreviewRelease('4-preview')).toBe(false);
  });
});

describe('versionGreaterOrEqualThan', () => {
  function semVerFactory(
    major: number,
    minor: number,
    patch: number,
    pre?: string,
    build?: string
  ): SemVer {
    return { major, minor, patch, pre, build };
  }

  test('compares different patch versions', () => {
    const v1 = semVerFactory(1, 2, 3);
    const v2 = semVerFactory(1, 2, 2);
    expect(versionGreaterOrEqualThan(v1, v2)).toBe(true);
    expect(versionGreaterOrEqualThan(v2, v1)).toBe(false);
  });

  test('compares different major versions', () => {
    const v1 = semVerFactory(2, 0, 0);
    const v2 = semVerFactory(3, 0, 0);
    expect(versionGreaterOrEqualThan(v1, v2)).toBe(false);
    expect(versionGreaterOrEqualThan(v2, v1)).toBe(true);
  });

  test('compares different major versions', () => {
    const v1 = semVerFactory(3, 1, 0);
    const v2 = semVerFactory(3, 0, 1);
    expect(versionGreaterOrEqualThan(v1, v2)).toBe(true);
    expect(versionGreaterOrEqualThan(v2, v1)).toBe(false);
  });

  test('equals true for equal versions', () => {
    const v1 = semVerFactory(0, 1, 2);
    const v2 = semVerFactory(0, 1, 2);
    expect(versionGreaterOrEqualThan(v1, v2)).toBe(true);
  });

  test('prefers versions with pre-release parts', () => {
    const v1 = semVerFactory(0, 1, 2, 'rc0');
    const v2 = semVerFactory(0, 1, 2);
    expect(versionGreaterOrEqualThan(v1, v2)).toBe(false);
    expect(versionGreaterOrEqualThan(v2, v1)).toBe(true);
  });

  test('throws an exception if there are build parts', () => {
    const v1 = semVerFactory(0, 1, 2, undefined, 'build123');
    const v2 = semVerFactory(0, 1, 2);
    expect(() => versionGreaterOrEqualThan(v1, v2)).toThrowError();
    expect(() => versionGreaterOrEqualThan(v2, v1)).toThrowError();
  });
});
