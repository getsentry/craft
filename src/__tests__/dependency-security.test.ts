import { createRequire } from 'node:module';
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
