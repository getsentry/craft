import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const projectRequire = createRequire(__filename);
const vercelRequire = createRequire(projectRequire.resolve('@vercel/client'));
const microfrontendsRequire = createRequire(
  vercelRequire.resolve('@vercel/microfrontends/config'),
);
const globRequire = createRequire(microfrontendsRequire.resolve('fast-glob'));
const micromatchRequire = createRequire(globRequire.resolve('micromatch'));
const braces = micromatchRequire('braces');
const pluginRequire = createRequire(
  projectRequire.resolve('@sentry/esbuild-plugin'),
);
const unpluginRequire = createRequire(pluginRequire.resolve('unplugin'));
const chokidarRequire = createRequire(unpluginRequire.resolve('chokidar'));
const anymatchRequire = createRequire(chokidarRequire.resolve('anymatch'));
const typescriptEstreeRequire = createRequire(
  createRequire(projectRequire.resolve('typescript-eslint')).resolve(
    '@typescript-eslint/typescript-estree',
  ),
);
const tinyglobbyRequire = createRequire(
  typescriptEstreeRequire.resolve('tinyglobby'),
);

describe('GHSA-vfj7-8cjw-p6xm dependency patch', () => {
  test('protects both runtime globbing and build-time file watching', () => {
    expect(chokidarRequire.resolve('braces')).toBe(
      micromatchRequire.resolve('braces'),
    );
  });

  test.each(['compile', 'expand', 'stringify', 'parse'] as const)(
    '%s rejects deep braces and parentheses before recursive traversal',
    method => {
      for (const [open, close, depth] of [
        ['{', '}', 4000],
        ['(', ')', 4000],
        ['{(', ')}', 2000],
      ] as const) {
        const pattern = open.repeat(depth) + 'a' + close.repeat(depth);
        expect(() => braces[method](pattern)).toThrow(SyntaxError);
      }
    },
  );

  test('keeps normal nesting, ranges, escaped and quoted literals working', () => {
    expect(braces.expand('src/{a,{b,c}}/{1..2}.ts')).toEqual([
      'src/a/1.ts',
      'src/a/2.ts',
      'src/b/1.ts',
      'src/b/2.ts',
      'src/c/1.ts',
      'src/c/2.ts',
    ]);
    expect(braces.compile('{'.repeat(100) + 'x' + '}'.repeat(100))).toBe(
      '{'.repeat(100) + 'x' + '}'.repeat(100),
    );
    expect(braces.expand('"' + '{'.repeat(200) + '"')).toEqual([
      '{'.repeat(200),
    ]);
    expect(braces.expand('[' + '{'.repeat(200) + ']')).toEqual([
      '[' + '{'.repeat(200) + ']',
    ]);
    expect(braces.expand('\\{'.repeat(200))).toEqual(['{'.repeat(200)]);
  });
});

const picomatchRedos = resolve(__dirname, 'fixtures/picomatch-redos.cjs');

describe('GHSA-fc5q-39xc-vjpf dependency patch', () => {
  const picomatchCopies = {
    '4.0.7 (typescript-eslint > tinyglobby)':
      tinyglobbyRequire.resolve('picomatch'),
    '2.3.2 (@sentry/esbuild-plugin > ... > anymatch)':
      anymatchRequire.resolve('picomatch'),
    '2.3.2 (@vercel/client > ... > micromatch)':
      micromatchRequire.resolve('picomatch'),
  };

  test.each(Object.entries(picomatchCopies))(
    'picomatch %s rejects crafted input without backtracking',
    (_name, picomatchPath) => {
      const result = spawnSync(
        process.execPath,
        [picomatchRedos, picomatchPath],
        {
          encoding: 'utf8',
          timeout: 10_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    },
  );

  test.each(Object.entries(picomatchCopies))(
    'picomatch %s keeps extglob matching',
    (_name, picomatchPath) => {
      const picomatch = projectRequire(picomatchPath);
      expect(picomatch.makeRe('+(*a)').source).toBe('^(?:(?=.)(?:[^/]*?a))$');
      expect(picomatch.isMatch('xaa', '+(*a)')).toBe(true);
      expect(picomatch.isMatch('ab', '+(*a)')).toBe(false);
      expect(picomatch.isMatch('a/a', '+(*a)')).toBe(false);
      expect(picomatch.isMatch('abab', '+(a*b)')).toBe(true);
      expect(picomatch.isMatch('x.jsy.js', '+(*.js)')).toBe(true);
      expect(picomatch.isMatch('x.jsy.ts', '+(*.js)')).toBe(false);
      expect(picomatch.isMatch('abab', '+(a|b)')).toBe(true);
      expect(picomatch.isMatch('src/a/src/b/', '+(src/*/)')).toBe(true);
      expect(picomatch.isMatch('foo.ts', '!(*.d).ts')).toBe(true);
      expect(picomatch.isMatch('foo.d.ts', '!(*.d).ts')).toBe(false);
      expect(picomatch.isMatch('src/a/b.ts', 'src/**/*.@(ts|js)')).toBe(true);
    },
  );
});
