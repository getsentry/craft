import { chmod, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
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
        assets: ['dist/craft.js', 'dist/craft.js.map'],
        filesToDeleteAfterUpload: ['dist/**/*.map'],
      },
    })
  );
} else {
  console.log('[build] SENTRY_AUTH_TOKEN not found, skipping source map upload');
}

// Build to .js file first so Sentry plugin can properly handle source maps
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
  outfile: 'dist/craft.js',
  plugins,
});

// Helper to check if file exists
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Post-build processing with race condition handling for parallel test builds
// Another parallel build may have already processed the file, so all operations
// must gracefully handle ENOENT errors
try {
  // Add shebang if not present
  const content = await readFile('dist/craft.js', 'utf-8');
  const hasShebang = content.startsWith('#!');
  if (!hasShebang) {
    await writeFile('dist/craft.js', '#!/usr/bin/env node\n' + content);
  }

  // Rename to final executable name
  await rename('dist/craft.js', 'dist/craft');
} catch (err) {
  // ENOENT means another parallel build already processed the file
  if (err.code !== 'ENOENT') {
    throw err;
  }
}

// Ensure permissions are set (idempotent)
if (await exists('dist/craft')) {
  await chmod('dist/craft', 0o755);
}

// Clean up source map if it wasn't deleted by Sentry plugin
try {
  await unlink('dist/craft.js.map');
} catch {
  // Source map already deleted by Sentry plugin or doesn't exist
}
