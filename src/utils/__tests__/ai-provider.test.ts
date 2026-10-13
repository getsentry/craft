import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSummaryProvider } from '../ai-provider';
import { AiSummaryConfigSchema } from '../../schemas/project_config';
import { setGlobals } from '../helpers';
import { summarizeChangelog } from '../ai-summary';
import { access } from 'node:fs/promises';

const sdk = vi.hoisted(() => ({
  clients: [] as any[],
  sessions: [] as any[],
  options: [] as any[],
  start: vi.fn(),
  listModels: vi.fn(),
  send: vi.fn(),
  forceStop: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock('@github/copilot-sdk', () => ({
  RuntimeConnection: { forStdio: () => ({ kind: 'stdio' }) },
  CopilotClient: class {
    constructor(options: any) {
      sdk.options.push(options);
      sdk.clients.push(this);
    }
    start = sdk.start;
    listModels = sdk.listModels;
    forceStop = sdk.forceStop;
    async createSession(options: any) {
      sdk.sessions.push(options);
      return {
        sessionId: 'sample',
        sendAndWait: sdk.send,
        disconnect: sdk.disconnect,
        abort: vi.fn(),
      };
    }
  },
}));
const config = () =>
  AiSummaryConfigSchema.parse({ enabled: true, kickInThreshold: 0 });
const request = {
  input: '{"level":"scope","nodes":[]}',
  system: 'Summarize provided data only.',
  schema: { type: 'object' },
  signal: new AbortController().signal,
};

describe('AI summary providers', () => {
  beforeEach(() => {
    sdk.clients.length = 0;
    sdk.sessions.length = 0;
    sdk.options.length = 0;
    sdk.start.mockReset().mockResolvedValue(undefined);
    sdk.listModels
      .mockReset()
      .mockResolvedValue([{ id: 'gpt-6-luna', policy: { state: 'enabled' } }]);
    sdk.send
      .mockReset()
      .mockResolvedValue({ data: { content: '{"summaries":[]}' } });
    sdk.forceStop.mockReset().mockResolvedValue(undefined);
    sdk.disconnect.mockReset().mockResolvedValue(undefined);
    vi.stubEnv('GITHUB_TOKEN', 'workflow-token');
    vi.stubEnv('COPILOT_GITHUB_TOKEN', '');
    vi.stubEnv('CRAFT_COPILOT_SDK_DIR', '');
    vi.stubEnv('CRAFT_AI_API_KEY', '');
    setGlobals({ 'dry-run': false });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setGlobals({ 'dry-run': false });
  });

  it('defaults to Copilot with the installation token in runtime env, without an API key', async () => {
    const provider = createSummaryProvider(config());
    try {
      expect(await provider.request(request)).toEqual({ summaries: [] });
      expect(sdk.options[0]).toMatchObject({
        connection: { kind: 'stdio' },
        useLoggedInUser: false,
        mode: 'empty',
        env: { COPILOT_GITHUB_TOKEN: 'workflow-token' },
      });
      expect(sdk.options[0]).not.toHaveProperty('gitHubToken');
      expect(sdk.options[0].env).not.toHaveProperty('CRAFT_AI_API_KEY');
      expect(sdk.options[0].env).not.toHaveProperty('GITHUB_TOKEN');
      expect(sdk.options[0].env).not.toHaveProperty('NODE_OPTIONS');
      expect(sdk.sessions[0]).toMatchObject({
        model: 'gpt-6-luna',
        availableTools: [],
        enableConfigDiscovery: false,
        infiniteSessions: { enabled: false },
        modelCapabilities: { limits: { max_output_tokens: 8192 } },
      });
      expect(await sdk.sessions[0].onPermissionRequest({})).toMatchObject({
        kind: 'reject',
      });
      expect(await sdk.sessions[0].hooks.onPreToolUse({})).toMatchObject({
        permissionDecision: 'deny',
      });
      expect(sdk.send.mock.calls[0][0]).toMatchObject({
        prompt: request.input,
        responseSchema: request.schema,
      });
    } finally {
      await provider.close();
    }
    expect(sdk.forceStop).toHaveBeenCalled();
  });

  it('uses the separately wired Copilot token instead of a release bot token', async () => {
    vi.stubEnv('COPILOT_GITHUB_TOKEN', 'built-in-actions-token');
    const provider = createSummaryProvider(config());
    try {
      await provider.request(request);
      expect(sdk.options[0].env.COPILOT_GITHUB_TOKEN).toBe(
        'built-in-actions-token',
      );
    } finally {
      await provider.close();
    }
  });

  it('isolates concurrent requests in fresh sessions while sharing one runtime', async () => {
    const provider = createSummaryProvider(config());
    try {
      await Promise.all([
        provider.request(request),
        provider.request(request),
        provider.request(request),
      ]);
      expect(sdk.clients).toHaveLength(1);
      expect(sdk.sessions).toHaveLength(3);
      expect(sdk.disconnect).toHaveBeenCalledTimes(3);
    } finally {
      await provider.close();
    }
  });

  it('validates and reduces real hierarchy data through default Copilot without an API key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    sdk.send.mockImplementation(async ({ prompt }) => {
      const input = JSON.parse(prompt);
      return {
        data: {
          content: JSON.stringify({
            summaries: input.nodes.map((node: any) => ({
              id: node.id,
              summary: `Summary of ${node.title}`,
              importantChanges: [],
            })),
          }),
        },
      };
    });
    const result = await summarizeChangelog(
      [
        {
          id: 'features',
          title: 'Features',
          groups: [
            { id: 'cli', title: 'CLI', scope: 'cli', items: ['Add command'] },
          ],
        },
        {
          id: 'fixes',
          title: 'Fixes',
          groups: [
            { id: 'api', title: 'API', scope: 'api', items: ['Fix endpoint'] },
          ],
        },
      ],
      config(),
    );
    expect(result).toMatchObject({
      scopes: {},
      categories: {},
      release: [{ id: 'features' }, { id: 'fixes' }],
    });
    expect(sdk.send).toHaveBeenCalledTimes(3);
    expect(
      sdk.send.mock.calls.map(([message]) => JSON.parse(message.prompt).level),
    ).toEqual(['scope', 'category', 'release']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips the Copilot SDK entirely when disabled or during dry runs', async () => {
    const categories = [
      {
        id: 'features',
        title: 'Features',
        groups: [{ id: 'cli', title: 'CLI', items: ['Add command'] }],
      },
    ];
    expect(
      await summarizeChangelog(categories, { ...config(), enabled: false }),
    ).toBeNull();
    setGlobals({ 'dry-run': true });
    expect(await summarizeChangelog(categories, config())).toBeNull();
    expect(sdk.clients).toHaveLength(0);
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it.each([[[]], [[{ id: 'gpt-6-luna', policy: { state: 'disabled' } }]]])(
    'rejects unavailable org models without switching to OpenRouter (%j)',
    async models => {
      sdk.listModels.mockResolvedValue(models);
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      vi.stubEnv('CRAFT_AI_API_KEY', 'alternative-key');
      const provider = createSummaryProvider(config());
      try {
        await expect(provider.request(request)).rejects.toThrow();
        expect(sdk.send).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        await provider.close();
      }
    },
  );

  it('aborts and force-stops runtime work rather than merely timing out the wait', async () => {
    sdk.send.mockImplementation(() => new Promise(() => {}));
    const provider = createSummaryProvider(config());
    const controller = new AbortController();
    const result = provider.request({ ...request, signal: controller.signal });
    const rejected = expect(result).rejects.toThrow();
    await vi.waitFor(() => expect(sdk.send).toHaveBeenCalled());
    controller.abort();
    await rejected;
    await provider.close();
    expect(sdk.forceStop).toHaveBeenCalled();
  });

  it('stops a runtime that finishes starting after cancellation and cleans its directory', async () => {
    let started!: () => void;
    sdk.start.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          started = resolve;
        }),
    );
    const provider = createSummaryProvider(config());
    const controller = new AbortController();
    const result = provider.request({ ...request, signal: controller.signal });
    const rejected = expect(result).rejects.toThrow();
    await vi.waitFor(() => expect(sdk.start).toHaveBeenCalled());
    controller.abort();
    await rejected;
    await provider.close();
    const stopped = sdk.forceStop.mock.calls.length;
    started();
    await vi.waitFor(() =>
      expect(sdk.forceStop.mock.calls.length).toBeGreaterThan(stopped),
    );
    await expect(access(sdk.options[0].baseDirectory)).rejects.toThrow();
    expect(sdk.listModels).not.toHaveBeenCalled();
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it('rejects empty or malformed Copilot output', async () => {
    sdk.send.mockResolvedValue({ data: { content: 'not JSON' } });
    const provider = createSummaryProvider(config());
    try {
      await expect(provider.request(request)).rejects.toThrow();
    } finally {
      await provider.close();
    }
  });

  it('requires explicit OpenRouter selection and its environment key', async () => {
    const provider = createSummaryProvider(
      AiSummaryConfigSchema.parse({ enabled: true, provider: 'openrouter' }),
    );
    try {
      await expect(provider.request(request)).rejects.toThrow();
      expect(sdk.clients).toHaveLength(0);
    } finally {
      await provider.close();
    }
    vi.stubEnv('CRAFT_AI_API_KEY', 'alternative-key');
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          { finish_reason: 'stop', message: { content: '{"summaries":[]}' } },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const alternative = createSummaryProvider(
      AiSummaryConfigSchema.parse({ enabled: true, provider: 'openrouter' }),
    );
    try {
      expect(await alternative.request(request)).toEqual({ summaries: [] });
      expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe(
        'openai/gpt-6-luna',
      );
      expect(sdk.clients).toHaveLength(0);
    } finally {
      await alternative.close();
    }
  });
});
