/* eslint-env jest */

import { getVersion, parseVersion } from '../version';

test('extracts a basic SemVer versions', () => {
  expect(getVersion('1.0.0')).toBe('1.0.0');
});

test('extracts a SemVer version with leading "v"', () => {
  expect(getVersion('v1.0.0')).toBe('1.0.0');
});

test('extracts a SemVer version from text', () => {
  expect(getVersion('1.0.0 (foobar)')).toBe('1.0.0');
});

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
