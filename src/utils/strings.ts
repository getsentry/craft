import * as mustache from 'mustache';

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

export function renderTemplateSafe(template: string, context: any): string {
  return mustache.render(template, sanitizeObject(context));
}
