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
 * Returns true if the string contains glob wildcard characters (* or ?)
 * that are not inside a regex string (i.e., not wrapped in slashes).
 */
function hasGlobChars(str: string): boolean {
  return /[*?]/.test(str);
}

/**
 * Converts a glob pattern string to a regex string.
 *
 * Glob characters:
 *   * → .* (match zero or more characters)
 *   ? → .  (match exactly one character)
 *
 * All other regex-special characters are escaped.
 *
 * @param pattern Glob pattern string
 * @returns Regex source string (without anchors)
 */
export function globToRegex(pattern: string): string {
  let result = '';
  for (const char of pattern) {
    if (char === '*') {
      result += '.*';
    } else if (char === '?') {
      result += '.';
    } else {
      result += escapeRegex(char);
    }
  }
  return result;
}

/**
 * Converts a pattern string to a RegExp.
 *
 * Supports three formats:
 * 1. Regex string wrapped in slashes (e.g., /^foo.*$/): parsed as RegExp
 * 2. Glob pattern with * or ? (e.g., sentry-*): converted to regex
 * 3. Plain string (e.g., craft-binary): exact match
 */
export function patternToRegexp(pattern: string): RegExp {
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    return stringToRegexp(pattern);
  }
  if (hasGlobChars(pattern)) {
    return new RegExp(`^${globToRegex(pattern)}$`);
  }
  return new RegExp(`^${escapeRegex(pattern)}$`);
}
