import { setTimeout, clearTimeout } from 'node:timers';
import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.env.CRAFT_COPILOT_SDK_DIR;
const sdk = createRequire(join(root, 'package.json'))('@github/copilot-sdk');
const { CopilotClient, RuntimeConnection } = sdk;
const directory = await mkdtemp(join(tmpdir(), 'craft-runtime-smoke-'));
const client = new CopilotClient({
  connection: RuntimeConnection.forStdio(),
  mode: 'empty',
  baseDirectory: directory,
  workingDirectory: directory,
  useLoggedInUser: false,
  logLevel: 'none',
  // No credentials or inherited instruction files. The only model endpoint is
  // the loopback fixture below; this does not prove live Copilot access.
  env: Object.fromEntries(
    ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']
      .flatMap(name => (process.env[name] ? [[name, process.env[name]]] : []))
      .concat([
        ['HOME', directory],
        ['USERPROFILE', directory],
      ]),
  ),
});
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: { summary: { type: 'string' } },
};
let requests = 0;
let fixtureError;
let pendingRequest;
let pendingClosed;
const server = createServer(async (request, response) => {
  try {
    let body = '';
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body);
    requests++;
    assert.equal(data.model, 'fixture-model');
    assert.deepEqual(data.tools ?? [], []);
    const format = request.url.endsWith('/responses')
      ? data.text.format
      : data.response_format.json_schema;
    assert.deepEqual(format.schema, schema);
    assert.equal(format.strict, true);
    if (pendingRequest) {
      response.once('close', pendingClosed);
      pendingRequest();
      return; // Cancellation must terminate this unfinished model request.
    }
    const text = JSON.stringify({ summary: 'Fixture summary' });
    if (request.url === '/v1/responses') {
      assert.equal(data.store, false);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'resp_fixture',
          object: 'response',
          created_at: 1,
          status: 'completed',
          model: 'fixture-model',
          output: [
            {
              id: 'msg_fixture',
              type: 'message',
              status: 'completed',
              role: 'assistant',
              content: [{ type: 'output_text', text, annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
      );
    } else {
      assert.equal(request.url, '/v1/chat/completions');
      if (data.stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const [delta, finish_reason] of [
          [{ role: 'assistant', content: text }, null],
          [{}, 'stop'],
        ])
          response.write(
            `data: ${JSON.stringify({
              id: 'fixture',
              object: 'chat.completion.chunk',
              model: 'fixture-model',
              choices: [{ index: 0, delta, finish_reason }],
            })}\n\n`,
          );
        response.end('data: [DONE]\n\n');
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'fixture',
            object: 'chat.completion',
            model: 'fixture-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: text },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      }
    }
  } catch (error) {
    fixtureError = error;
    response.writeHead(400);
    response.end();
  }
});
const timeout = setTimeout(() => {
  process.exitCode = 1;
  void client.forceStop();
  server.closeAllConnections();
}, 30000);
// Bound startup/cleanup hangs as well as the SDK's per-session deadlines.
const hardTimeout = setTimeout(() => process.exit(1), 45000);
try {
  assert.deepEqual(Object.keys(sdk).sort(), [
    'CopilotClient',
    'RuntimeConnection',
  ]);
  assert.deepEqual(Object.keys(RuntimeConnection), ['forStdio']);
  assert.deepEqual(await readdir(join(root, 'node_modules')), ['@github']);
  const sdkFiles = await readdir(
    join(root, 'node_modules/@github/copilot-sdk'),
  );
  assert.ok(sdkFiles.includes('index.cjs'));
  assert.ok(
    sdkFiles.every(name =>
      ['package.json', 'index.cjs', 'index.cjs.LEGAL.txt'].includes(name),
    ),
  );
  const packages = await readdir(join(root, 'node_modules/@github'));
  const native = packages.filter(
    name => name.startsWith('copilot-') && name !== 'copilot-sdk',
  );
  assert.equal(native.length, 1);
  assert.equal(packages.length, 2);
  assert.deepEqual(
    (await readdir(join(root, 'node_modules/@github', native[0]))).sort(),
    ['package.json', 'prebuilds'],
  );
  assert.equal(
    (await readdir(join(root, 'node_modules/@github', native[0], 'prebuilds')))
      .length,
    1,
  );
  assert.match(
    await readFile(join(root, 'licenses/@github__copilot-sdk/LICENSE'), 'utf8'),
    /Copyright GitHub, Inc\./,
  );
  assert.ok(
    (await readdir(join(root, 'licenses/vscode-jsonrpc'))).some(name =>
      /^license/i.test(name),
    ),
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  await client.start();
  const result = await client.ping('craft-runtime-smoke');
  assert.equal(result.message, 'pong: craft-runtime-smoke');
  assert.equal((await client.getAuthStatus()).isAuthenticated, false);
  const sessionConfig = wireApi => ({
    model: 'fixture-model',
    modelCapabilities: {
      supports: { vision: false, reasoningEffort: false },
      limits: { max_context_window_tokens: 32768, max_output_tokens: 8192 },
    },
    provider: {
      type: 'openai',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      wireApi,
    },
    availableTools: [],
    excludedTools: ['builtin:*', 'mcp:*', 'custom:*'],
    systemMessage: { mode: 'replace', content: 'Summarize fixture data only.' },
    enableConfigDiscovery: false,
    enableSessionStore: false,
    infiniteSessions: { enabled: false },
    onPermissionRequest: async () => ({ kind: 'reject', feedback: 'No tools' }),
  });
  for (const wireApi of ['completions', 'responses']) {
    const session = await client.createSession(sessionConfig(wireApi));
    const result = await session.sendAndWait(
      { prompt: 'Return the fixture summary.', responseSchema: schema },
      10000,
    );
    assert.ifError(fixtureError);
    assert.deepEqual(JSON.parse(result.data.content), {
      summary: 'Fixture summary',
    });
    await session.disconnect();
  }
  assert.equal(requests, 2);
  const received = new Promise(resolve => {
    pendingRequest = resolve;
  });
  const closed = new Promise(resolve => {
    pendingClosed = resolve;
  });
  const session = await client.createSession(sessionConfig('responses'));
  const pending = session.sendAndWait(
    { prompt: 'Cancel this request.', responseSchema: schema },
    10000,
  );
  // Attach the rejection handler immediately: forceStop closes the connection.
  const failed = assert.rejects(pending);
  await received;
  await client.forceStop();
  await closed;
  await failed;
  assert.ifError(fixtureError);
  assert.equal(requests, 3);
  console.log(
    `Trimmed runtime startup, structured sessions, and cancellation passed: ${process.platform}/${process.arch} (loopback model fixture; no live Copilot inference)`,
  );
} catch {
  console.log(JSON.stringify({ runtimeProbeFailed: true }));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  try {
    await client.forceStop();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
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
  clearTimeout(hardTimeout);
}
