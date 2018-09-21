import * as mustache from 'mustache';

/**
 * Sanitizes object attributes
 *
 * Non-object and non-scalar values are recursively removed. Additionally,
 * keys that contain dots are duplicated, and dots are replaced with double
 * underscores.
 *
 * @param obj Object to normalize
 * @returns Normalized object
 */
export function sanitizeObject(obj: any): any {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error(`Cannot normalize value: ${obj}`);
  }

  const result: { [_: string]: any } = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const valueType = typeof value;
    let newValue;

    // Allowed value types
    if (['boolean', 'string', 'number', 'undefined'].indexOf(valueType) > -1) {
      newValue = value;
    } else if (value === null) {
      newValue = undefined;
    } else if (valueType === 'object') {
      newValue = sanitizeObject(value);
    } else {
      continue;
    }
    result[key] = newValue;
    const normalizedKey = key.replace(/\./g, '__');
    if (key !== normalizedKey) {
      result[normalizedKey] = newValue;
    }
  }
  return result;
}

/**
 * Renders the given template in a safe way
 *
 * No expressions or logic is allowed, only values and attribute access (via
 * dots) are allowed. Under the hood, Mustache templates are used.
 *
 * @param template Mustache template
 * @param context Template data
 * @returns Rendered template
 */
export function renderTemplateSafe(template: string, context: any): string {
  return mustache.render(template, sanitizeObject(context));
}
