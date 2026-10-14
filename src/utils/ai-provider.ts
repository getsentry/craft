import {
  AiSummaryLlmSchema,
  type AiSummaryConfig,
} from '../schemas/project_config';
import { safeExec } from './dryRun';
import { getAiSummaryOverrides } from './helpers';

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

/** Resolve the connection once through the same path for CLI and Actions. */
export function resolveAiSummaryLlm(config: AiSummaryConfig) {
  const settings = process.env.CRAFT_AI_LLM;
  if (settings && Buffer.byteLength(settings) > 8192)
    throw new Error('AI connection configuration exceeds limit');
  const environment = settings
    ? AiSummaryLlmSchema.partial().parse(JSON.parse(settings))
    : {};
  const defined = (
    values: Record<string, string | undefined>,
    ignoreEmpty = false,
  ) =>
    Object.fromEntries(
      Object.entries(values).filter(
        ([, value]) => value !== undefined && (!ignoreEmpty || value !== ''),
      ),
    );
  return AiSummaryLlmSchema.parse({
    ...config.llm,
    ...defined(
      {
        endpoint: process.env.CRAFT_AI_ENDPOINT,
        model: process.env.CRAFT_AI_MODEL,
        apiKeyEnv: process.env.CRAFT_AI_API_KEY_ENV,
      },
      true,
    ),
    ...environment,
    ...defined(getAiSummaryOverrides()),
  });
}

const MAX_HTTP_RESPONSE_BYTES = 256 * 1024;
class HttpSummaryProvider implements SummaryProvider {
  private controller = new AbortController();
  constructor(private config: AiSummaryConfig) {}

  async request(request: SummaryRequest): Promise<unknown> {
    const signal = AbortSignal.any([request.signal, this.controller.signal]);
    if (signal.aborted) throw new Error('Summary aborted');
    const llm = resolveAiSummaryLlm(this.config);
    const token = process.env[llm.apiKeyEnv]?.trim();
    if (!token || token.length > 16384 || /[\r\n]/.test(token))
      throw new Error('HTTP summaries require an endpoint credential');
    const endpoint = new URL(llm.endpoint);
    const responses = endpoint.pathname
      .replace(/\/+$/, '')
      .endsWith('/responses');
    const format = {
      name: 'changelog_summary',
      strict: true,
      schema: request.schema,
    };
    const messages = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.input },
    ];
    const body = responses
      ? {
          model: llm.model,
          stream: false,
          store: false,
          max_output_tokens: 8192,
          input: messages,
          text: { format: { type: 'json_schema', ...format } },
        }
      : {
          model: llm.model,
          stream: false,
          max_completion_tokens: 8192,
          messages,
          response_format: { type: 'json_schema', json_schema: format },
        };
    const copilot =
      endpoint.hostname === 'api.githubcopilot.com' ||
      endpoint.hostname.endsWith('.githubcopilot.com');
    return safeExec(async () => {
      const response = await fetch(llm.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(copilot
            ? {
                'Copilot-Integration-Id': 'copilot-developer-cli',
                'X-GitHub-Api-Version': '2026-07-01',
              }
            : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`HTTP summary request failed (${response.status})`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty HTTP summary response');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await abortable(reader.read(), signal);
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_HTTP_RESPONSE_BYTES)
            throw new Error('HTTP summary response exceeds limit');
          chunks.push(value);
        }
      } catch {
        await reader.cancel().catch(() => {});
        throw new Error('Invalid HTTP summary response');
      } finally {
        reader.releaseLock();
      }
      let output;
      try {
        output = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new Error('Invalid HTTP summary response');
      }
      let content: string;
      if (responses) {
        if (
          output?.status !== 'completed' ||
          output.error ||
          output.incomplete_details ||
          !Array.isArray(output.output)
        )
          throw new Error('Incomplete HTTP summary response');
        const messages = output.output.filter(
          (item: any) => item?.type === 'message',
        );
        if (
          messages.length !== 1 ||
          output.output.some(
            (item: any) => !['message', 'reasoning'].includes(item?.type),
          )
        )
          throw new Error('Invalid HTTP summary response');
        const message = messages[0];
        if (
          message.role !== 'assistant' ||
          message.status !== 'completed' ||
          !Array.isArray(message.content) ||
          message.content.length !== 1 ||
          message.content[0]?.type !== 'output_text' ||
          typeof message.content[0].text !== 'string'
        )
          throw new Error('Invalid HTTP summary response');
        content = message.content[0].text;
      } else {
        const choice = output?.choices?.[0];
        const message = choice?.message;
        if (
          !Array.isArray(output?.choices) ||
          output.choices.length !== 1 ||
          choice?.finish_reason !== 'stop' ||
          message?.role !== 'assistant' ||
          typeof message.content !== 'string' ||
          message.refusal ||
          message.tool_calls?.length ||
          message.function_call
        )
          throw new Error('Incomplete HTTP summary response');
        content = message.content;
      }
      try {
        return JSON.parse(content);
      } catch {
        throw new Error('Invalid HTTP summary content');
      }
    }, 'Generate changelog summaries via configured HTTP endpoint');
  }
  async close(): Promise<void> {
    this.controller.abort();
  }
}

export function createSummaryProvider(
  config: AiSummaryConfig,
): SummaryProvider {
  return new HttpSummaryProvider(config);
}
