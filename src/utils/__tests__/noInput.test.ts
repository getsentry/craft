/* eslint-env jest */

import { hasInput, hasNoInput, resetNoInput, setNoInput } from '../noInput';

describe('setNoInput', () => {
  afterEach(() => {
    delete process.env.CRAFT_NO_INPUT;
    resetNoInput();
  });

  test('sets and returns true', () => {
    setNoInput(true);
    expect(hasNoInput()).toBe(true);
    expect(hasInput()).toBe(false);
  });

  test('sets and returns false', () => {
    setNoInput(false);
    expect(hasNoInput()).toBe(false);
    expect(hasInput()).toBe(true);
  });
});

describe('resetNoInput', () => {
  afterEach(() => {
    delete process.env.CRAFT_NO_INPUT;
    resetNoInput();
  });

  test('sets noInput to false by default', () => {
    delete process.env.CRAFT_NO_INPUT;
    resetNoInput();
    expect(hasNoInput()).toBe(false);
  });

  test('sets noInput to true via env', () => {
    process.env.CRAFT_NO_INPUT = '1';
    resetNoInput();
    expect(hasNoInput()).toBe(true);
  });
});
