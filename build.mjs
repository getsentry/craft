import { chmod } from 'fs/promises';
import esbuild from 'esbuild';
import { sentryEsbuildPlugin } from '@sentry/esbuild-plugin';

const plugins = [];

// Only add Sentry plugin if auth token is available (production builds on master)
if (process.env.SENTRY_AUTH_TOKEN) {
  plugins.push(
    sentryEsbuildPlugin({
      org: 'sentry',
      project: 'craft',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        filesToDeleteAfterUpload: ['dist/**/*.map'],
      },
    })
  );
} else {
  console.log('[build] SENTRY_AUTH_TOKEN not found, skipping source map upload');
}

await esbuild.build({
  entryPoints: ['src/index.ts'],
  sourcemap: true,
  bundle: true,
  platform: 'node',
  target: 'node22',
  inject: ['./src/utils/import-meta-url.js'],
  define: {
    'import.meta.url': 'import_meta_url',
    'process.env.NODE_ENV': JSON.stringify('production'),
    ...(process.env.CRAFT_BUILD_SHA && {
      'process.env.CRAFT_BUILD_SHA': JSON.stringify(process.env.CRAFT_BUILD_SHA),
    }),
  },
  outfile: 'dist/craft',
  plugins,
});

// Make the output file executable
await chmod('dist/craft', 0o755);
