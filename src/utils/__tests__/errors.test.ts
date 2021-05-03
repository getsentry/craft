import { coerceType } from '../errors';

describe('coerceType', () => {
  test('asserts a string correctly', async () => {
    expect(coerceType('test', 'string')).toBe('test');
  });

  test('asserts a number correctly', async () => {
    expect(coerceType(123, 'number')).toBe(123);
  });

  test('throws an error if the type is incorrect', async () => {
    expect(() => coerceType(123, 'function')).toThrowError(TypeError);
  });

  test('throws an error with a custom message', async () => {
    const customMsg = 'custom message';
    expect(() => coerceType({}, 'number', customMsg)).toThrowError(customMsg);
  });
});
