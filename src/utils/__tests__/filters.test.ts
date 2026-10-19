import {
  stringToRegexp,
  escapeRegex,
  patternToRegexp,
  globToRegex,
} from '../filters';

describe('stringToRegexp', () => {
  test('converts string without special characters', () => {
    expect(stringToRegexp('/simple/')).toEqual(/simple/);
  });

  test('converts string with special characters', () => {
    expect(stringToRegexp('/sim.le\\d+/')).toEqual(/sim.le\d+/);
  });

  test('uses regexp modifiers', () => {
    expect(stringToRegexp('/[!?]{2}\\w+/gi')).toEqual(/[!?]{2}\w+/gi);
  });

  test('is not confused by multiple slashes', () => {
    expect(stringToRegexp('/file1/file2/i')).toEqual(/file1\/file2/i);
  });

  test('is source of regex what we think', () => {
    expect(stringToRegexp('/none/').source).toEqual('none');
  });

  test('raises an error if the value is not surrounded by slashes', () => {
    expect.assertions(1);
    try {
      stringToRegexp('no-slashes');
    } catch (e) {
      expect(e.message).toMatch(/invalid regexp/i);
    }
  });
});

describe('escapeRegex', () => {
  test('escapes special regex characters', () => {
    expect(escapeRegex('hello.world')).toBe('hello\\.world');
    expect(escapeRegex('file[0].txt')).toBe('file\\[0\\]\\.txt');
    expect(escapeRegex('a+b*c?')).toBe('a\\+b\\*c\\?');
    expect(escapeRegex('(foo|bar)')).toBe('\\(foo\\|bar\\)');
    expect(escapeRegex('$100')).toBe('\\$100');
    expect(escapeRegex('^start')).toBe('\\^start');
  });

  test('leaves normal characters unchanged', () => {
    expect(escapeRegex('hello-world')).toBe('hello-world');
    expect(escapeRegex('foo_bar')).toBe('foo_bar');
  });
});

describe('globToRegex', () => {
  test('converts * to .*', () => {
    expect(globToRegex('sentry-*')).toBe('sentry-.*');
  });

  test('converts ? to .', () => {
    expect(globToRegex('build-?.zip')).toBe('build-.\\.zip');
  });

  test('escapes special regex characters', () => {
    expect(globToRegex('output.tar.gz')).toBe('output\\.tar\\.gz');
  });

  test('handles multiple globs', () => {
    expect(globToRegex('*-build-*')).toBe('.*-build-.*');
  });

  test('handles mixed * and ?', () => {
    expect(globToRegex('build-?-*.zip')).toBe('build-.-.*\\.zip');
  });

  test('leaves plain alphanumeric strings unchanged', () => {
    expect(globToRegex('simple')).toBe('simple');
  });
});

describe('patternToRegexp', () => {
  test('converts regex string to RegExp', () => {
    const result = patternToRegexp('/^build-.*$/');
    expect(result).toBeInstanceOf(RegExp);
    expect(result.test('build-linux')).toBe(true);
    expect(result.test('build-macos')).toBe(true);
    expect(result.test('test-linux')).toBe(false);
  });

  test('converts regex string with modifiers', () => {
    const result = patternToRegexp('/BUILD/i');
    expect(result.test('build')).toBe(true);
    expect(result.test('BUILD')).toBe(true);
  });

  test('converts exact string to exact match RegExp', () => {
    const result = patternToRegexp('build');
    expect(result.test('build')).toBe(true);
    expect(result.test('build-linux')).toBe(false);
    expect(result.test('mybuild')).toBe(false);
  });

  test('escapes special characters in exact match', () => {
    const result = patternToRegexp('output.tar.gz');
    expect(result.test('output.tar.gz')).toBe(true);
    expect(result.test('outputXtarXgz')).toBe(false);
  });

  test('converts glob pattern with * to matching RegExp', () => {
    const result = patternToRegexp('sentry-*');
    expect(result).toBeInstanceOf(RegExp);
    expect(result.test('sentry-linux-x64')).toBe(true);
    expect(result.test('sentry-darwin-arm64')).toBe(true);
    expect(result.test('sentry-')).toBe(true);
    expect(result.test('other-thing')).toBe(false);
    expect(result.test('my-sentry-linux')).toBe(false);
  });

  test('converts glob pattern with ? to matching RegExp', () => {
    const result = patternToRegexp('build-?.zip');
    expect(result.test('build-a.zip')).toBe(true);
    expect(result.test('build-1.zip')).toBe(true);
    expect(result.test('build-ab.zip')).toBe(false);
    expect(result.test('build-.zip')).toBe(false);
  });

  test('converts glob pattern with * preserving other special chars', () => {
    const result = patternToRegexp('output.*.tar.gz');
    expect(result.test('output.v2.tar.gz')).toBe(true);
    expect(result.test('output.release.tar.gz')).toBe(true);
    expect(result.test('outputXv2XtarXgz')).toBe(false);
  });

  test('converts glob pattern *.tgz to match any .tgz file', () => {
    const result = patternToRegexp('*.tgz');
    expect(result.test('package-1.0.0.tgz')).toBe(true);
    expect(result.test('my-lib.tgz')).toBe(true);
    expect(result.test('package-1.0.0.zip')).toBe(false);
  });

  test('glob * does not match across nothing when anchored', () => {
    const result = patternToRegexp('prefix-*-suffix');
    expect(result.test('prefix--suffix')).toBe(true);
    expect(result.test('prefix-middle-suffix')).toBe(true);
    expect(result.test('prefix-suffix')).toBe(false);
  });
});
