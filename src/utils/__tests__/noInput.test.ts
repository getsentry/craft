/* eslint-env jest */

import { hasInput } from '../helpers';
import isCI from 'is-ci';

describe('hasInput', () => {
  beforeEach(() => {
    delete process.env.CRAFT_NO_INPUT;
  });

  test('uses negative of isCI value by default', () => {
    expect(hasInput(true)).toBe(!isCI);
  });

  test('sets hasInput to true when env var is 0', () => {
    process.env.CRAFT_NO_INPUT = '0';
    expect(hasInput(true)).toBe(true);
  });

  test('sets hasInput to true when env var is false', () => {
    process.env.CRAFT_NO_INPUT = 'false';
    expect(hasInput(true)).toBe(true);
  });

  test('sets hasInput to false via craft env', () => {
    process.env.CRAFT_NO_INPUT = '1';
    expect(hasInput(true)).toBe(false);
  });
});
