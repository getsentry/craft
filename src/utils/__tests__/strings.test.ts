import { vi, type Mock, type MockInstance, type Mocked, type MockedFunction } from 'vitest';
import {
  renderTemplateSafe,
  sanitizeObject,
  formatSize,
  formatJson,
} from '../strings';

describe('sanitizeObject', () => {
  test('processes empty object', () => {
    expect(sanitizeObject({})).toEqual({});
  });

  test('throws an error if given non-object', () => {
    function expectRaisesError(value: any): void {
      try {
        sanitizeObject(value);
        throw new Error(`Should fail for canonical name: ${value}`);
      } catch (e) {
        expect(e.message).toMatch(/cannot normalize/i);
      }
    }
    expectRaisesError(123);
    expectRaisesError('a');
    expectRaisesError(null);
  });

  test('processes simple objects without changes', () => {
    expect(sanitizeObject({ 1: 2 })).toEqual({ 1: 2 });
  });

  test('processes nested objects without changes', () => {
    expect(sanitizeObject({ 1: { a: { 3: true } }, 2: 'b' })).toEqual({
      1: { a: { 3: true } },
      2: 'b',
    });
  });

  test('ignores function values', () => {
    expect(sanitizeObject({ f: () => true })).toEqual({});
  });

  test('replaces null with undefined', () => {
    expect(sanitizeObject({ 1: null })).toEqual({ 1: undefined });
  });

  test('normalizes keys with dots', () => {
    expect(sanitizeObject({ '1.2.3': 3 })).toEqual({
      '1.2.3': 3,
      '1__2__3': 3,
    });
  });
});

describe('renderTemplateSafe', () => {
  test('renders basic template', () => {
    expect(renderTemplateSafe('x{{ var }}', { var: 123 })).toBe('x123');
  });

  test('renders nested values', () => {
    expect(renderTemplateSafe('x{{ var.d }}', { var: { d: 123 } })).toBe(
      'x123'
    );
  });

  test('renders nested values with dotted keys', () => {
    expect(renderTemplateSafe('x{{ var.d__1 }}', { var: { 'd.1': 123 } })).toBe(
      'x123'
    );
  });

  test('does not render globals', () => {
    expect(renderTemplateSafe('{{ process }}', {})).toBe('');
  });
});

describe('formatSize', () => {
  test('formats byte sizes', () => {
    expect(formatSize(123)).toBe('123 B');
  });
  test('formats kilobyte sizes', () => {
    expect(formatSize(125952)).toBe('123.0 kB');
  });
  test('formats megabyte sizes', () => {
    expect(formatSize(1289748)).toBe('1.23 MB');
  });
});

describe('formatJson', () => {
  test('formats an integer', () => {
    expect(formatJson(123)).toBe('123');
  });
  test('formats an object', () => {
    expect(formatJson({ int: 123, str: 'hello', array: [2, 3, 4] })).toBe(
      `{
    "int": 123,
    "str": "hello",
    "array": [
        2,
        3,
        4
    ]
}`
    );
  });
  test('serializes an error', () => {
    const errorStr = formatJson(Error('oops'));
    expect(errorStr).toContain('Error: oops');
    // Stack trace format varies between environments
    expect(errorStr).toMatch(/at\s+/);
  });
});
