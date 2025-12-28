import { vi, type Mock, type MockInstance, type Mocked, type MockedFunction } from 'vitest';
import { clearObjectProperties } from '../objects';

describe('clearObjectProperties', () => {
  test('clears enumerable properties', () => {
    const obj = { a: 1, test: 'hello', f: () => 0, o: { 1: 2 } };

    expect(clearObjectProperties(obj)).toEqual({});
    expect(obj).toEqual({});
  });
});
