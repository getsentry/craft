import { renderTemplateSafe, sanitizeObject } from '../strings';

describe('sanitizeObject', () => {
  test('processes empty object', () => {
    expect(sanitizeObject({})).toEqual({});
  });

  test('throws an error if given non-object', () => {
    function expectRaisesError(value: any): void {
      try {
        sanitizeObject(value);
        throw new Error(`Should fail for canonical name: ${name}`);
      } catch (e) {
        expect(e.message).toMatch(/cannot normalize/i);
      }
    }
    expectRaisesError(123);
    expectRaisesError('a');
    expectRaisesError(null); // tslint:disable-line:no-null-keyword
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
    // tslint:disable-next-line:no-null-keyword
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
