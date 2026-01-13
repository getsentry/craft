/**
 * Converts the given string to a regular expression object
 *
 * The passed string should be in the form of a JS regular expression, i.e.
 * surrounded with slashes and with optional modifiers after the closing slash.
 * Examples:
 *    "/\\w+[123]/"
 *    "/hello/i"
 *
 * Invalid arguments:
 *    "hithere"     // No slashes
 *    "/craft/xyz"  // Invalid modifiers
 *
 * @param str String to convert
 * @returns Regular expression object that was created from the string
 */
export function stringToRegexp(str: string): RegExp {
  const firstSlash = str.indexOf('/');
  const lastSlash = str.lastIndexOf('/');
  if (firstSlash !== 0 || lastSlash < 2) {
    throw new TypeError(`Invalid RegExp string specified: ${str}`);
  }
  const regexpString = str.slice(1, lastSlash);
  const regexpModifiers = str.slice(lastSlash + 1);
  return new RegExp(regexpString, regexpModifiers);
}

/**
 * Escapes special regex characters in a string for use in RegExp
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts a pattern string to a RegExp.
 * If wrapped in slashes (e.g., /^foo.*$/), parses as regex.
 * Otherwise, creates an exact match pattern.
 */
export function patternToRegexp(pattern: string): RegExp {
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    return stringToRegexp(pattern);
  }
  return new RegExp(`^${escapeRegex(pattern)}$`);
}
