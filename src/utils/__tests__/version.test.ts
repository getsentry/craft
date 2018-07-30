/* eslint-env jest */

import { getVersion, isValidVersion, parseVersion } from '../version';

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
