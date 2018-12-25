/* eslint-env jest */

import { isNoInput, resetNoInput, setNoInput } from '../noInput';

describe('setNoInput', () => {
  afterEach(() => {
    delete process.env.CRAFT_NO_INPUT;
    resetNoInput();
  });

  test('sets and returns true', () => {
    setNoInput(true);
    expect(isNoInput()).toBe(true);
  });

  test('sets and returns false', () => {
    setNoInput(false);
    expect(isNoInput()).toBe(false);
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
    expect(isNoInput()).toBe(false);
  });

  test('sets noInput to true via env', () => {
    process.env.CRAFT_NO_INPUT = '1';
    resetNoInput();
    expect(isNoInput()).toBe(true);
  });
});
