import process from 'node:process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bootstrap a private, integrity-pinned pnpm distribution. Do not activate it
// globally: caller release scripts must retain their selected Node and pnpm.
const PNPM_VERSION = '10.27.0';
const PNPM_INTEGRITY =
  'ctaZ2haxF5wUup5k3HHJpAmIy9xlwmTLDkidt96RfyDc9NZNhyNiXylpulLUt+KhFwaC2awqXcrqq3MrfhbwSg==';
const SDK_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../copilot-sdk',
);

async function install() {
  const directory = await mkdtemp(
    join(process.env.RUNNER_TEMP || tmpdir(), 'craft-pnpm-'),
  );
  try {
    const response = await fetch(
      `https://registry.npmjs.org/pnpm/-/pnpm-${PNPM_VERSION}.tgz`,
      {
        signal: AbortSignal.timeout(60000),
        redirect: 'error',
      },
    );
    if (!response.ok || !response.body)
      throw new Error('Installer unavailable');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 10 * 1024 * 1024)
        throw new Error('Installer exceeds size bound');
      chunks.push(chunk);
    }
    const archive = Buffer.concat(chunks);
    if (
      createHash('sha512').update(archive).digest('base64') !== PNPM_INTEGRITY
    )
      throw new Error('Installer integrity mismatch');
    const archivePath = join(directory, 'pnpm.tgz');
    await writeFile(archivePath, archive, { mode: 0o600 });
    execFileSync('tar', ['-xzf', archivePath, '-C', directory], {
      timeout: 30000,
    });
    execFileSync(
      process.execPath,
      [
        join(directory, 'package/bin/pnpm.cjs'),
        'install',
        '--dir',
        SDK_DIR,
        '--frozen-lockfile',
        '--ignore-scripts',
      ],
      {
        stdio: 'inherit',
        timeout: 120000,
        env: { ...process.env, CI: 'true' },
      },
    );
    if (process.env.GITHUB_ENV)
      await appendFile(
        process.env.GITHUB_ENV,
        `CRAFT_COPILOT_SDK_DIR=${SDK_DIR}\n`,
      );
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 50,
    });
  }
}

try {
  await install();
} catch {
  console.error(
    '::warning::Copilot runtime installation failed; Craft will retain original changelog output if summaries are unavailable.',
  );
  process.exitCode = 1;
}
