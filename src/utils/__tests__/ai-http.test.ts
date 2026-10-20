import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createSummaryProvider } from '../ai-provider';
import { AiSummaryConfigSchema } from '../../schemas/project_config';
import { summarizeChangelog } from '../ai-summary';
import { setGlobals } from '../helpers';
import { logger } from '../../logger';

const endpoint = 'https://ai.example.com/v1/chat/completions';
const config = () =>
  AiSummaryConfigSchema.parse({
    minItems: 0,
    llm: { apiKeyEnv: 'AI_SUMMARY_TOKEN' },
  });
const request = {
  input: '{"level":"scope","nodes":[]}',
  system: 'Summarize only provided changes.',
  schema: { type: 'object' },
  signal: new AbortController().signal,
};
const completion = (content = '{"summaries":[]}') =>
  Response.json({
    choices: [
      { finish_reason: 'stop', message: { role: 'assistant', content } },
    ],
  });
beforeEach(() => {
  setGlobals({ 'dry-run': false });
  vi.stubEnv('GITHUB_ACTIONS', 'false');
  vi.stubEnv('GITHUB_TOKEN', 'source-only-token');
  vi.stubEnv('CRAFT_AI_LLM', '');
  vi.stubEnv('CRAFT_AI_ENDPOINT', endpoint);
  vi.stubEnv('CRAFT_AI_MODEL', '');
  vi.stubEnv('CRAFT_AI_API_KEY_ENV', '');
  vi.stubEnv('AI_SUMMARY_TOKEN', 'provider-token');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setGlobals({ 'dry-run': false });
});

test.each(['false', 'true'])(
  'uses explicit HTTP configuration in CLI/Actions (%s)',
  async actions => {
    vi.stubEnv('GITHUB_ACTIONS', actions);
    const fetch = vi.fn().mockResolvedValue(completion());
    vi.stubGlobal('fetch', fetch);
    const provider = createSummaryProvider(config());
    expect(await provider.request(request)).toEqual({ summaries: [] });
    await provider.close();
    expect(fetch.mock.calls[0][0]).toBe(endpoint);
    const options = fetch.mock.calls[0][1];
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer provider-token',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(options.body)).toMatchObject({
      model: 'gpt-5.4-nano',
      stream: false,
      max_completion_tokens: 8192,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.input },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { strict: true, schema: request.schema },
      },
    });
  },
);

test('CLI overrides select model, endpoint and a named token environment variable', async () => {
  const fetch = vi.fn().mockResolvedValue(completion());
  vi.stubGlobal('fetch', fetch);
  vi.stubEnv('TEAM_MODEL_TOKEN', 'team-token');
  setGlobals({
    'ai-endpoint': 'https://gateway.example.com/chat',
    'ai-api-key-env': 'TEAM_MODEL_TOKEN',
    'ai-model': 'custom-luna',
  });
  const provider = createSummaryProvider(config());
  await provider.request(request);
  await provider.close();
  expect(fetch.mock.calls[0][0]).toBe('https://gateway.example.com/chat');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
    'Bearer team-token',
  );
  expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('custom-luna');
});

test('reads endpoint and token-env from project configuration', async () => {
  vi.stubEnv('CRAFT_AI_ENDPOINT', '');
  vi.stubEnv('TEAM_MODEL_TOKEN', 'team-token');
  const fetch = vi.fn().mockResolvedValue(completion());
  vi.stubGlobal('fetch', fetch);
  const provider = createSummaryProvider(
    AiSummaryConfigSchema.parse({
      llm: { endpoint, apiKeyEnv: 'TEAM_MODEL_TOKEN', model: 'custom-luna' },
    }),
  );
  await provider.request(request);
  await provider.close();
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
    'Bearer team-token',
  );
});

test.each(['endpoint', 'api-key-env'])(
  'missing credentials with %s settings never makes a request',
  async part => {
    vi.stubEnv('CRAFT_AI_ENDPOINT', part === 'endpoint' ? endpoint : '');
    vi.stubEnv('AI_SUMMARY_TOKEN', '');
    vi.stubEnv(
      'CRAFT_AI_API_KEY_ENV',
      part === 'api-key-env' ? 'MISSING_KEY' : '',
    );
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const provider = createSummaryProvider(config());
    await expect(provider.request(request)).rejects.toThrow();
    await provider.close();
    expect(fetch).not.toHaveBeenCalled();
  },
);

test('missing default GitHub credential makes no inference request', async () => {
  vi.stubEnv('CRAFT_AI_ENDPOINT', '');
  vi.stubEnv('AI_SUMMARY_TOKEN', '');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubEnv('GITHUB_TOKEN', '');
  const provider = createSummaryProvider(AiSummaryConfigSchema.parse({}));
  await expect(provider.request(request)).rejects.toThrow();
  await provider.close();
  expect(fetch).not.toHaveBeenCalled();
});

test.each([401, 429, 500])(
  'HTTP %s fails without provider switching or response-body diagnostics',
  async status => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('provider-token sensitive diagnostic', { status }),
      );
    vi.stubGlobal('fetch', fetch);
    const provider = createSummaryProvider(config());
    await expect(provider.request(request)).rejects.toThrow(
      `HTTP summary request failed (${status})`,
    );
    await provider.close();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test.each([
  {
    choices: [
      {
        finish_reason: 'length',
        message: { role: 'assistant', content: '{}' },
      },
    ],
  },
  {
    choices: [
      {
        finish_reason: 'stop',
        message: { role: 'assistant', content: '{}', refusal: 'refused' },
      },
    ],
  },
  {
    choices: [
      {
        finish_reason: 'stop',
        message: { role: 'assistant', content: '{}', tool_calls: [{}] },
      },
    ],
  },
  { choices: [] },
])(
  'rejects incomplete, refused or tool-bearing responses (%j)',
  async output => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(output)));
    const provider = createSummaryProvider(config());
    await expect(provider.request(request)).rejects.toThrow();
    await provider.close();
  },
);

test.each(['not JSON', 'x'.repeat(300 * 1024)])(
  'rejects malformed/oversized response bodies',
  async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const provider = createSummaryProvider(config());
    await expect(provider.request(request)).rejects.toThrow();
    await provider.close();
  },
);

test.each([
  'http://external.example.com/chat',
  'https://user:password@ai.example.com/chat',
  'file:///tmp/model',
])('rejects unsafe endpoint %s before sending a token', async url => {
  vi.stubEnv('CRAFT_AI_ENDPOINT', url);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const provider = createSummaryProvider(config());
  await expect(provider.request(request)).rejects.toThrow();
  await provider.close();
  expect(fetch).not.toHaveBeenCalled();
});

test('cancellation aborts an in-flight HTTP request and close prevents more requests', async () => {
  let signal!: AbortSignal;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        }),
      );
    }),
  );
  const provider = createSummaryProvider(config());
  const controller = new AbortController();
  const result = provider.request({ ...request, signal: controller.signal });
  const rejected = expect(result).rejects.toThrow();
  await vi.waitFor(() => expect(signal).toBeDefined());
  controller.abort();
  await rejected;
  expect(signal.aborted).toBe(true);
  await provider.close();
  await expect(provider.request(request)).rejects.toThrow();
});

test('HTTP generation preserves original-output fallback for invalid summary coverage', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion()));
  expect(
    await summarizeChangelog(
      [
        {
          id: 'features',
          title: 'Features',
          groups: [{ id: 'cli', title: 'CLI', items: ['Add command'] }],
        },
      ],
      config(),
    ),
  ).toBeNull();
});

test('disabled summaries and dry runs make no HTTP or Copilot calls', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const categories = [
    {
      id: 'features',
      title: 'Features',
      groups: [{ id: 'cli', title: 'CLI', items: ['Add command'] }],
    },
  ];
  expect(await summarizeChangelog(categories, false)).toBeNull();
  setGlobals({ 'dry-run': true });
  expect(await summarizeChangelog(categories, config())).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

const responsesResult = (content = '{"summaries":[]}') => ({
  status: 'completed',
  output: [
    {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: content }],
    },
  ],
});

test.each(['false', 'true'])(
  'default connection uses Copilot Responses and GITHUB_TOKEN in CLI/Actions (%s)',
  async actions => {
    vi.stubEnv('GITHUB_ACTIONS', actions);
    vi.stubEnv('CRAFT_AI_ENDPOINT', '');
    const fetch = vi.fn().mockResolvedValue(Response.json(responsesResult()));
    vi.stubGlobal('fetch', fetch);
    const provider = createSummaryProvider(AiSummaryConfigSchema.parse({}));
    expect(await provider.request(request)).toEqual({ summaries: [] });
    await provider.close();
    expect(fetch.mock.calls[0][0]).toBe(
      'https://api.githubcopilot.com/responses',
    );
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      'Copilot-Integration-Id': 'copilot-developer-cli',
      'X-GitHub-Api-Version': '2026-07-01',
      Authorization: 'Bearer source-only-token',
    });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: 'gpt-5.4-nano',
      stream: false,
      store: false,
      max_output_tokens: 8192,
      input: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.input },
      ],
      text: {
        format: { type: 'json_schema', strict: true, schema: request.schema },
      },
    });
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('messages');
  },
);

test('custom endpoints do not receive Copilot-only headers', async () => {
  const fetch = vi.fn().mockResolvedValue(completion());
  vi.stubGlobal('fetch', fetch);
  const provider = createSummaryProvider(config());
  await provider.request(request);
  await provider.close();
  expect(fetch.mock.calls[0][1].headers).not.toHaveProperty(
    'Copilot-Integration-Id',
  );
  expect(fetch.mock.calls[0][1].headers).not.toHaveProperty(
    'X-GitHub-Api-Version',
  );
});

test('structured Action settings override file settings; CLI overrides Action environment', async () => {
  vi.stubEnv('CRAFT_AI_ENDPOINT', '');
  vi.stubEnv(
    'CRAFT_AI_LLM',
    JSON.stringify({
      endpoint: 'https://action.example/v1/responses',
      model: 'action-model',
      apiKeyEnv: 'TEAM_KEY',
    }),
  );
  vi.stubEnv('TEAM_KEY', 'team-key');
  const fetch = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(Response.json(responsesResult())),
    );
  vi.stubGlobal('fetch', fetch);
  const provider = createSummaryProvider(
    AiSummaryConfigSchema.parse({
      llm: { endpoint: 'https://file.example/responses', model: 'file-model' },
    }),
  );
  await provider.request(request);
  await provider.close();
  expect(fetch.mock.calls[0][0]).toBe('https://action.example/v1/responses');
  expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('action-model');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer team-key');
  setGlobals({
    'ai-endpoint': 'https://cli.example/responses',
    'ai-model': 'cli-model',
    'ai-api-key-env': 'AI_SUMMARY_TOKEN',
  });
  const overridden = createSummaryProvider(config());
  await overridden.request(request);
  await overridden.close();
  expect(fetch.mock.calls[1][0]).toBe('https://cli.example/responses');
  expect(JSON.parse(fetch.mock.calls[1][1].body).model).toBe('cli-model');
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe(
    'Bearer provider-token',
  );
});

test.each([
  'not-json',
  'null',
  '[]',
  '{"apiKey":"secret"}',
  '{"api":"responses"}',
  '{"apiKeyEnv":"bad-name"}',
])('invalid structured connection %s makes no request', async value => {
  vi.stubEnv('CRAFT_AI_LLM', value);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const provider = createSummaryProvider(config());
  await expect(provider.request(request)).rejects.toThrow();
  await provider.close();
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  { status: 'incomplete', output: [] },
  { status: 'completed', output: [{ type: 'function_call' }] },
  {
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'refusal', refusal: 'no' }],
      },
    ],
  },
  { ...responsesResult(), error: { message: 'error' } },
  { ...responsesResult(), incomplete_details: { reason: 'max_output_tokens' } },
  { status: 'completed', output: null },
  {
    status: 'completed',
    output: [...responsesResult().output, ...responsesResult().output],
  },
])(
  'rejects incomplete/refused/tool-bearing Responses output (%j)',
  async output => {
    vi.stubEnv('CRAFT_AI_ENDPOINT', 'https://model.example/v1/responses');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(output)));
    const provider = createSummaryProvider(config());
    await expect(provider.request(request)).rejects.toThrow();
    await provider.close();
  },
);

test('Responses reasoning metadata is accepted without exposing reasoning as summary prose', async () => {
  vi.stubEnv('CRAFT_AI_ENDPOINT', 'https://model.example/v1/responses');
  const output = responsesResult();
  output.output.unshift({ type: 'reasoning', summary: [] } as any);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(output)));
  const provider = createSummaryProvider(config());
  expect(await provider.request(request)).toEqual({ summaries: [] });
  await provider.close();
});

test.each(['ai-endpoint', 'ai-model', 'ai-api-key-env'])(
  'explicit empty CLI setting %s is rejected rather than defaulted',
  async key => {
    setGlobals({ [key]: '' });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const provider = createSummaryProvider(config());
    await expect(provider.request(request)).rejects.toThrow();
    await provider.close();
    expect(fetch).not.toHaveBeenCalled();
  },
);

test.each(['http', 'coverage', 'schema', 'network'])(
  'fallback reports a sanitized stage and %s failure reason',
  async failure => {
    const sensitive =
      'provider-token private-source https://secret.invalid/?key=credential';
    const fetch = vi.fn();
    if (failure === 'http')
      fetch.mockResolvedValue(new Response(sensitive, { status: 403 }));
    else if (failure === 'network')
      fetch.mockRejectedValue(new Error(sensitive));
    else
      fetch.mockResolvedValue(
        completion(
          failure === 'schema' ? JSON.stringify({ sensitive }) : undefined,
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    expect(
      await summarizeChangelog(
        [
          {
            id: 'features',
            title: 'Features',
            groups: [{ id: 'cli', title: 'CLI', items: [sensitive] }],
          },
        ],
        config(),
      ),
    ).toBeNull();
    const log = warn.mock.calls.flat().join(' ');
    expect(log).toContain('keeping original entries');
    expect(log).toContain('stage=scope');
    expect(log).toContain(
      `reason=${failure === 'coverage' ? 'coverage' : failure === 'schema' ? 'response-schema' : failure}`,
    );
    if (failure === 'http') expect(log).toContain('HTTP 403');
    for (const value of sensitive.split(' ')) expect(log).not.toContain(value);
  },
);

test.each([
  ['child-id', ['cli:item:0:part:0']],
  ['short-id', ['cli']],
  ['unknown-id', ['private-source-token']],
  ['duplicate-id', ['cli/r0/b0', 'cli/r0/b0']],
])(
  'classifies %s coverage failures without logging returned IDs',
  async (reason, ids) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        completion(
          JSON.stringify({
            summaries: ids.map(id => ({
              id,
              summary: 'Digest.',
              importantChanges: [],
            })),
          }),
        ),
      ),
    );
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    expect(
      await summarizeChangelog(
        [
          {
            id: 'features',
            title: 'Features',
            groups: [{ id: 'cli', title: 'CLI', items: ['Add command'] }],
          },
        ],
        config(),
      ),
    ).toBeNull();
    const log = warn.mock.calls.flat().join(' ');
    expect(log).toContain(`reason=coverage-${reason}`);
    expect(log).not.toContain('private-source-token');
    expect(log).not.toContain('cli/');
  },
);
