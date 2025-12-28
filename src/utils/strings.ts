import * as mustache from 'mustache';
import * as util from 'util';

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
export function sanitizeObject(obj: Record<string, any>): any {
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
export function renderTemplateSafe(
  template: string,
  context: Record<string, any>
): string {
  return mustache.render(template, sanitizeObject(context));
}

/**
 * Formats file size as kilobytes/megabytes
 *
 * @param size Size to format
 */
export function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  const kilobytes = size / 1024.0;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} kB`;
  } else {
    const megabytes = kilobytes / 1024.0;
    return `${megabytes.toFixed(2)} MB`;
  }
}

/**
 * Serializes the given object in a readable way
 *
 * @param obj Object to print out
 */
 
export function formatJson(obj: any): string {
  const result = JSON.stringify(obj, null, 4);
  if (obj instanceof Error && result === '{}') {
    // Error that doesn't implement toJSON()
    return util.format(obj);
  } else {
    return result;
  }
}
