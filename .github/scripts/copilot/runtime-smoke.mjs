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
const directory = await mkdtemp(join(tmpdir(), 'craft-runtime-smoke-'));
const client = new CopilotClient({
  connection: RuntimeConnection.forStdio(),
  mode: 'empty',
  baseDirectory: directory,
  workingDirectory: directory,
  useLoggedInUser: false,
  // Deliberately omit credentials: this proves native runtime startup only.
  env: Object.fromEntries(
    ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP'].flatMap(
      name => (process.env[name] ? [[name, process.env[name]]] : []),
    ),
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
} finally {
  clearTimeout(timeout);
  await client.forceStop();
  await rm(directory, { recursive: true, force: true });
}
