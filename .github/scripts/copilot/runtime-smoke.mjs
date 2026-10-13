import { setTimeout, clearTimeout } from 'node:timers';
import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { CopilotClient, RuntimeConnection } = createRequire(
  join(process.env.CRAFT_COPILOT_SDK_DIR, 'package.json'),
)('@github/copilot-sdk');
const checkAccess = process.argv.includes('--check-model-access');
const directory = await mkdtemp(join(tmpdir(), 'craft-runtime-smoke-'));
const client = new CopilotClient({
  connection: RuntimeConnection.forStdio(),
  mode: 'empty',
  baseDirectory: directory,
  workingDirectory: directory,
  useLoggedInUser: false,
  logLevel: 'none',
  // Regular matrix checks omit credentials and prove runtime startup only.
  env: Object.fromEntries(
    [
      'PATH',
      'HOME',
      'USERPROFILE',
      'SystemRoot',
      'TEMP',
      'TMP',
      ...(checkAccess
        ? [
            'COPILOT_GITHUB_TOKEN',
            'GITHUB_ACTIONS',
            'GITHUB_REPOSITORY',
            'GITHUB_SERVER_URL',
            'GITHUB_API_URL',
            'GITHUB_RUN_ID',
            'GITHUB_RUN_ATTEMPT',
          ]
        : []),
    ].flatMap(name => (process.env[name] ? [[name, process.env[name]]] : [])),
  ),
});
const timeout = setTimeout(() => {
  process.exitCode = 1;
  void client.forceStop();
}, 15000);
try {
  await client.start();
  const result = await client.ping('craft-runtime-smoke');
  assert.equal(result.message, 'pong: craft-runtime-smoke');
  console.log(
    `Bundled runtime startup passed: ${process.platform}/${process.arch}`,
  );
  if (checkAccess) {
    const status = await client.getAuthStatus().catch(() => null);
    try {
      const models = await client.listModels();
      const luna = models.find(model => model.id === 'gpt-6-luna');
      console.log(
        JSON.stringify({
          authenticated: status?.isAuthenticated ?? null,
          modelAvailable: Boolean(luna),
          modelEnabled: Boolean(luna && luna.policy?.state !== 'disabled'),
          availableModelCount: models.length,
        }),
      );
    } catch (error) {
      // No raw errors: runtime errors can include credentials or request data.
      const text = String(error.message);
      console.log(
        JSON.stringify({
          authenticated: status?.isAuthenticated ?? null,
          modelListingFailed: true,
          forbidden: /\b403\b|forbidden/i.test(text),
          unauthorized: /\b401\b|unauthorized/i.test(text),
          policyDenied: /policy|not allowed|not enabled/i.test(text),
        }),
      );
    }
  }
} catch {
  console.log(JSON.stringify({ runtimeProbeFailed: true }));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  try {
    await client.forceStop();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 50,
    });
  } catch {
    console.log(JSON.stringify({ runtimeCleanupFailed: true }));
    process.exitCode = 1;
  }
}
