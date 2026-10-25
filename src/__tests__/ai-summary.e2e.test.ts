// Standalone CLI E2E: only source metadata and model HTTP are fixtures.
import { test } from 'vitest';
import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  copyFile,
  cp,
  mkdir,
  symlink,
  chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';

test('standalone CLI and Action settings preserve summaries, originals and fallback', async () => {
  const root = resolve(__dirname, '../..');
  const directory = await mkdtemp(join(tmpdir(), 'craft http cli '));
  const binary = join(directory, 'craft');
  const execute = promisify(execFile);
  let calls = 0;
  let mode: 'valid' | 'repair-once' | 'invalid' | 'http-error' = 'valid';
  const levels: string[] = [];
  const prose = {
    scope: 'Fixture scoped implementation details.',
    category: 'Fixture category outcome.',
    release: 'Fixture release overview.',
  };
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, 'Bearer fixture-token');
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      assert.equal(body.model, 'fixture-model');
      calls++;
      if (mode === 'http-error') {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'Fixture unavailable' }));
        return;
      }
      const responses = request.url?.endsWith('/responses');
      const messages = responses ? body.input : body.messages;
      assert.ok(messages[0].content.includes('Concise and friendly.'));
      const input = JSON.parse(messages[1].content);
      assert.ok(input.level in prose);
      levels.push(input.level);
      const summaries = input.nodes.map(
        (node: { id: string; parts: { id: string }[] }) => ({
          id: node.id,
          ...(input.level === 'release'
            ? { coveredPartIds: node.parts.map(part => part.id) }
            : {}),
          summary: prose[input.level as keyof typeof prose],
          importantChanges: [],
        }),
      );
      response.writeHead(200, { 'content-type': 'application/json' });
      const invalid = mode === 'invalid' || mode === 'repair-once';
      if (mode === 'repair-once') mode = 'valid';
      const text = JSON.stringify({
        summaries: invalid
          ? {}
          : Object.fromEntries(
              summaries.map(({ id, ...digest }: any) => [id, digest]),
            ),
      });
      response.end(
        JSON.stringify(
          responses
            ? {
                status: 'completed',
                output: [
                  {
                    type: 'message',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'output_text', text }],
                  },
                ],
              }
            : {
                choices: [
                  {
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: text },
                  },
                ],
              },
        ),
      );
    } catch {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Fixture request failed' }));
    }
  });
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  try {
    // Build in a private directory so concurrent E2E builds cannot overwrite this binary.
    const buildDir = join(directory, 'build');
    await mkdir(buildDir);
    for (const source of ['src', 'skills'])
      await cp(join(root, source), join(buildDir, source), { recursive: true });
    for (const file of ['build.mjs', 'package.json'])
      await copyFile(join(root, file), join(buildDir, file));
    await symlink(
      join(root, 'node_modules'),
      join(buildDir, 'node_modules'),
      'junction',
    );
    await execute(process.execPath, ['build.mjs'], {
      cwd: buildDir,
      env: { ...process.env, SENTRY_AUTH_TOKEN: '' },
      timeout: 60000,
    });
    await copyFile(join(buildDir, 'dist/craft'), binary);
    await chmod(binary, 0o755);
    assert.ok(
      !(await readFile(binary, 'utf8')).includes('@github/copilot-sdk'),
    );
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const endpoint = `http://127.0.0.1:${address.port}/v1/chat/completions`;
    git('init', '--initial-branch=main');
    git('config', 'user.name', 'Craft fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    const config = `github:\n  owner: getsentry\n  repo: craft\nchangelog:\n  policy: auto\n  aiSummary:\n    minItems: 0\n    style: Concise and friendly.\n    levels: [release, category, scope]\ntargets: []\n`;
    await writeFile(join(directory, '.craft.yml'), config);
    await writeFile(
      join(directory, 'package.json'),
      '{"name":"fixture","version":"1.0.0"}',
    );
    git('add', '.craft.yml', 'package.json');
    git('commit', '-m', 'Initial fixture');
    git('tag', '1.0.0');
    for (const [prefix, scope, title] of [
      ['feat', 'cli', 'Add command'],
      ['fix', 'api', 'Fix endpoint'],
    ])
      for (let i = 1; i <= 6; i++) {
        await writeFile(join(directory, `${scope}-${i}.txt`), `${title} ${i}`);
        git('add', `${scope}-${i}.txt`);
        git('commit', '-m', `${prefix}(${scope}): ${title} ${i}`);
      }
    const hook = join(directory, 'metadata.cjs');
    await writeFile(
      hook,
      `const original = globalThis.fetch;
const modelOrigin = ${JSON.stringify(new URL(endpoint).origin)};
globalThis.fetch = async (input, options = {}) => {
  const url = typeof input === 'string' ? input : input.url || String(input);
  if (url === 'https://api.github.com/graphql') {
    const repository = {};
    for (const match of JSON.parse(options.body).query.matchAll(/C([a-f0-9]{40}):\\s*object/g)) {
      repository['C' + match[1]] = {
        author: { user: { login: 'fixture-author' } },
        associatedPullRequests: { nodes: [] },
      };
    }
    return Response.json({ data: { repository } });
  }
  if (new URL(url).origin === modelOrigin) return original(input, options);
  throw new Error('External HTTP is disabled in the E2E fixture');
};`,
    );
    const env = {
      ...process.env,
      CI: 'true',
      NODE_OPTIONS: '',
      GITHUB_TOKEN: 'source-fixture-token',
      CRAFT_WORKSPACE: '',
      CRAFT_DRY_RUN: 'false',
      DRY_RUN: 'false',
      CRAFT_AI_LLM: '',
      CRAFT_AI_ENDPOINT: endpoint,
      CRAFT_AI_MODEL: 'fixture-model',
      CRAFT_AI_API_KEY_ENV: 'AI_SUMMARY_TOKEN',
      AI_SUMMARY_TOKEN: 'fixture-token',
    };
    const run = async (
      args: string[] = [],
      overrides: Record<string, string> = {},
    ) =>
      JSON.parse(
        (
          await execute(
            process.execPath,
            [
              '--require',
              hook,
              binary,
              'changelog',
              '--since',
              '1.0.0',
              '--format',
              'json',
              '--no-input',
              ...args,
            ],
            {
              cwd: directory,
              env: { ...env, ...overrides },
              timeout: 150000,
              maxBuffer: 1024 * 1024,
            },
          )
        ).stdout,
      );
    const original = await run(['--dry-run']);
    assert.equal(calls, 0);
    const generated = await run();
    assert.equal(calls, 3);
    assert.deepEqual(levels, ['scope', 'category', 'release']);
    assert.equal(generated.bumpType, 'minor');
    assert.equal(original.bumpType, generated.bumpType);
    assert.equal((generated.changelog.match(/<details>/g) || []).length, 2);
    const originals = original.changelog
      .split('\n')
      .filter((line: string) => line.startsWith('- '));
    assert.equal(originals.length, 12);
    for (const entry of originals)
      assert.equal(generated.changelog.split(entry).length, 2);
    assert.equal(generated.totalCommits, original.totalCommits);
    for (const summary of Object.values(prose))
      assert.ok(generated.changelog.includes(summary));
    const overview = generated.changelog.split('### ')[0].trim();
    assert.equal(overview, prose.release);
    assert.ok(!overview.includes('**'));
    assert.ok(!overview.includes(prose.category));
    assert.ok(!overview.includes(prose.scope));

    const beforeRepair = calls;
    mode = 'repair-once';
    const repaired = await run();
    assert.equal(repaired.changelog, generated.changelog);
    assert.equal(calls - beforeRepair, 4);

    const beforeInvalid = calls;
    mode = 'invalid';
    const invalid = await run();
    assert.equal(invalid.changelog, original.changelog);
    assert.equal(invalid.bumpType, original.bumpType);
    assert.equal(calls - beforeInvalid, 2);

    const beforeHttpError = calls;
    mode = 'http-error';
    const unavailable = await run();
    assert.equal(unavailable.changelog, original.changelog);
    assert.equal(unavailable.bumpType, original.bumpType);
    assert.equal(calls - beforeHttpError, 1);
    mode = 'valid';
    const before = calls;
    await run(['--dry-run']);
    assert.equal(calls, before);
    const missing = await run([], { AI_SUMMARY_TOKEN: '' });
    assert.equal(missing.changelog, original.changelog);
    assert.equal(calls, before);
    await writeFile(
      join(directory, '.craft.yml'),
      config.replace(
        / {2}aiSummary:[\s\S]*?targets:/,
        '  aiSummary: false\ntargets:',
      ),
    );
    const disabled = await run();
    assert.equal(disabled.changelog, original.changelog);
    assert.equal(calls, before);
    await writeFile(
      join(directory, '.craft.yml'),
      config.replace('levels: [release, category, scope]', 'levels: []'),
    );
    const release = await run();
    assert.ok(!release.changelog.includes('<details>'));
    assert.equal(release.changelog.split('### ')[0].trim(), overview);
    // Match the structured environment passed by the Action. Actual CLI config
    // resolution and HTTP transport execute; only GitHub metadata/model are fixtures.
    const action = await run([], {
      GITHUB_ACTIONS: 'true',
      CRAFT_AI_ENDPOINT: 'http://127.0.0.1:1/responses',
      CRAFT_AI_MODEL: 'lower-priority-model',
      CRAFT_AI_LLM: JSON.stringify({ endpoint, model: 'fixture-model' }),
    });
    assert.equal(action.changelog, release.changelog);
    const responses = await run([], {
      CRAFT_AI_ENDPOINT: endpoint.replace('/chat/completions', '/responses'),
    });
    assert.equal(responses.changelog, release.changelog);
    const flags = await run(
      [
        '--ai-endpoint',
        endpoint,
        '--ai-model',
        'fixture-model',
        '--ai-api-key-env',
        'AI_SUMMARY_TOKEN',
      ],
      {
        CRAFT_AI_LLM: JSON.stringify({
          endpoint: 'http://127.0.0.1:1/responses',
          model: 'lower-priority-model',
          apiKeyEnv: 'MISSING_KEY',
        }),
      },
    );
    assert.equal(flags.changelog, release.changelog);
    // Project config uses the same nested connection resolver.
    await writeFile(
      join(directory, '.craft.yml'),
      config.replace(
        '    levels: [release, category, scope]',
        `    levels: []\n    llm:\n      endpoint: ${endpoint}\n      model: fixture-model\n      apiKeyEnv: TEAM_MODEL_TOKEN`,
      ),
    );
    const file = await run([], {
      CRAFT_AI_ENDPOINT: '',
      CRAFT_AI_MODEL: '',
      CRAFT_AI_API_KEY_ENV: '',
      TEAM_MODEL_TOKEN: 'fixture-token',
    });
    assert.equal(file.changelog, release.changelog);
    console.log(
      `Standalone CLI and Action custom HTTP sample passed on ${process.platform}/${process.arch}; every entry preserved (fixtures, no live inference).`,
    );
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 50,
    });
  }
}, 180000);
