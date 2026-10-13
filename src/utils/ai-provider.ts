import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CopilotClient, CopilotSession } from '@github/copilot-sdk';
import { z } from 'zod';
import type { AiSummaryConfig } from '../schemas/project_config';
import { safeExec } from './dryRun';

export interface SummaryRequest {
  input: string;
  system: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
}
export interface SummaryProvider {
  request(request: SummaryRequest): Promise<unknown>;
  close(): Promise<void>;
}

const completionSchema = z.object({
  error: z.null().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.literal('stop'),
        message: z.object({
          content: z.string(),
          refusal: z.null().optional(),
        }),
      }),
    )
    .min(1),
});

class OpenRouterProvider implements SummaryProvider {
  constructor(private model: string) {}
  async request(request: SummaryRequest): Promise<unknown> {
    const key = process.env.CRAFT_AI_API_KEY?.trim();
    if (!key) throw new Error('CRAFT_AI_API_KEY is required for OpenRouter');
    const response = await safeExec(
      () =>
        fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          redirect: 'error',
          signal: request.signal,
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            stream: false,
            max_tokens: 8192,
            reasoning: { effort: 'none' },
            provider: { require_parameters: true },
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.input },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'changelog_digests',
                strict: true,
                schema: request.schema,
              },
            },
          }),
        }),
      'Generate changelog summaries via OpenRouter',
    );
    if (!response?.ok) throw new Error('Provider unavailable');
    const completion = completionSchema.parse(await response.json());
    return JSON.parse(completion.choices[0].message.content);
  }
  async close(): Promise<void> {}
}

/** Standalone action binaries load the pinned SDK installed beside the action. */
async function loadSdk(): Promise<typeof import('@github/copilot-sdk')> {
  const directory = process.env.CRAFT_COPILOT_SDK_DIR;
  if (directory)
    return createRequire(join(directory, 'package.json'))(
      '@github/copilot-sdk',
    );
  return import('@github/copilot-sdk');
}

/** Only runtime prerequisites and Actions identity metadata reach the child. */
function runtimeEnvironment(token: string): Record<string, string> {
  const env: Record<string, string> = { COPILOT_GITHUB_TOKEN: token };
  for (const name of [
    'PATH',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'ComSpec',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'NODE_EXTRA_CA_CERTS',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'GITHUB_ACTIONS',
    'GITHUB_REPOSITORY',
    'GITHUB_SERVER_URL',
    'GITHUB_API_URL',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_ATTEMPT',
  ])
    if (process.env[name] !== undefined) env[name] = process.env[name]!;
  return env;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(new Error('Summary aborted'));
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new Error('Summary aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

class CopilotProvider implements SummaryProvider {
  private client?: CopilotClient;
  private starting?: Promise<CopilotClient>;
  private directory?: string;
  private closing = false;
  constructor(private model: string) {}

  private async initialize(): Promise<CopilotClient> {
    const token =
      process.env.COPILOT_GITHUB_TOKEN?.trim() ||
      process.env.GITHUB_TOKEN?.trim();
    if (!token) throw new Error('Copilot requires a GitHub token');
    const sdk = await loadSdk();
    if (this.closing) throw new Error('Summary aborted');
    this.directory = await safeExec(
      () => mkdtemp(join(tmpdir(), 'craft-copilot-')),
      'Create isolated Copilot runtime directory',
    );
    if (!this.directory) throw new Error('Summary aborted');
    if (this.closing) {
      await safeExec(
        () => rm(this.directory!, { recursive: true, force: true }),
        'Remove cancelled Copilot runtime directory',
      );
      throw new Error('Summary aborted');
    }
    this.client = new sdk.CopilotClient({
      connection: sdk.RuntimeConnection.forStdio(),
      mode: 'empty',
      env: runtimeEnvironment(token),
      useLoggedInUser: false,
      baseDirectory: this.directory,
      workingDirectory: this.directory,
      logLevel: 'error',
    });
    await this.client.start();
    if (this.closing) {
      // start() resolves its bundled executable asynchronously. Cancellation
      // can stop an as-yet-unspawned child; kill any child spawned afterwards.
      await this.close();
      throw new Error('Summary aborted');
    }
    const models = await this.client.listModels();
    if (
      !models.some(
        model => model.id === this.model && model.policy?.state !== 'disabled',
      )
    )
      throw new Error('Requested model unavailable under organization policy');
    if (this.closing) {
      await this.close();
      throw new Error('Summary aborted');
    }
    return this.client;
  }

  async request(request: SummaryRequest): Promise<unknown> {
    if (this.closing || request.signal.aborted)
      throw new Error('Summary aborted');
    const abort = () => {
      this.closing = true;
      void this.client?.forceStop().catch(() => {});
    };
    request.signal.addEventListener('abort', abort, { once: true });
    let session: CopilotSession | undefined;
    try {
      return await safeExec(async () => {
        this.starting ??= this.initialize();
        const client = await abortable(this.starting, request.signal);
        if (this.closing) throw new Error('Summary aborted');
        session = await abortable(
          client.createSession({
            model: this.model,
            allowedModels: [this.model],
            clientName: 'sentry-craft',
            modelCapabilities: { limits: { max_output_tokens: 8192 } },
            availableTools: [],
            excludedTools: ['builtin:*', 'mcp:*', 'custom:*'],
            systemMessage: { mode: 'replace', content: request.system },
            workingDirectory: this.directory,
            enableConfigDiscovery: false,
            infiniteSessions: { enabled: false },
            enableSessionStore: false,
            onPermissionRequest: async () => ({
              kind: 'reject',
              feedback: 'Tools are disabled for changelog summarization.',
            }),
            hooks: {
              onPreToolUse: async () => ({ permissionDecision: 'deny' }),
              onErrorOccurred: async () => ({ errorHandling: 'abort' }),
            },
          }),
          request.signal,
        );
        if (this.closing) throw new Error('Summary aborted');
        // The SDK emits strict json_schema. Its timeout only stops waiting;
        // our AbortSignal also force-stops the runtime to cancel actual work.
        const message = await abortable(
          session.sendAndWait(
            { prompt: request.input, responseSchema: request.schema },
            30000,
          ),
          request.signal,
        );
        if (!message?.data.content) throw new Error('Empty Copilot completion');
        return JSON.parse(message.data.content);
      }, 'Generate changelog summaries via GitHub Copilot');
    } finally {
      request.signal.removeEventListener('abort', abort);
      if (session && !this.closing)
        await abortable(session.disconnect(), request.signal);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.client?.forceStop().catch(() => {});
    // A pending initializer checks closing before starting or using a runtime.
    if (this.directory)
      await safeExec(
        () => rm(this.directory!, { recursive: true, force: true }),
        'Remove isolated Copilot runtime directory',
      ).catch(() => {});
  }
}

export function createSummaryProvider(
  config: AiSummaryConfig,
): SummaryProvider {
  return config.provider === 'openrouter'
    ? new OpenRouterProvider(config.model)
    : new CopilotProvider(config.model);
}
