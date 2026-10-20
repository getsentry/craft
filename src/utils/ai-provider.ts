import {
  AiSummaryLlmSchema,
  type AiSummaryConfig,
} from '../schemas/project_config';
import { safeExec } from './dryRun';
import { getAiSummaryOverrides } from './helpers';
import { SummaryFailure } from './ai-summary-error';

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
    if (signal.aborted) throw new SummaryFailure('deadline');
    let llm;
    try {
      llm = resolveAiSummaryLlm(this.config);
    } catch {
      throw new SummaryFailure('configuration');
    }
    const token = process.env[llm.apiKeyEnv]?.trim();
    if (!token || token.length > 16384 || /[\r\n]/.test(token))
      throw new SummaryFailure('credential');
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
        void response.body?.cancel().catch(() => {});
        throw new SummaryFailure('http', undefined, response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new SummaryFailure('response-body');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await abortable(reader.read(), signal);
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_HTTP_RESPONSE_BYTES)
            throw new SummaryFailure('response-size');
          chunks.push(value);
        }
      } catch (error) {
        void reader.cancel().catch(() => {});
        if (error instanceof SummaryFailure) throw error;
        throw new SummaryFailure(signal.aborted ? 'deadline' : 'response-body');
      } finally {
        reader.releaseLock();
      }
      let output;
      try {
        output = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new SummaryFailure('response-json');
      }
      let content: string;
      if (responses) {
        if (
          output?.status !== 'completed' ||
          output.error ||
          output.incomplete_details ||
          !Array.isArray(output.output)
        )
          throw new SummaryFailure('response-envelope');
        const messages = output.output.filter(
          (item: any) => item?.type === 'message',
        );
        if (
          messages.length !== 1 ||
          output.output.some(
            (item: any) => !['message', 'reasoning'].includes(item?.type),
          )
        )
          throw new SummaryFailure('response-envelope');
        const message = messages[0];
        if (
          message.role !== 'assistant' ||
          message.status !== 'completed' ||
          !Array.isArray(message.content) ||
          message.content.length !== 1 ||
          message.content[0]?.type !== 'output_text' ||
          typeof message.content[0].text !== 'string'
        )
          throw new SummaryFailure('response-envelope');
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
          throw new SummaryFailure('response-envelope');
        content = message.content;
      }
      try {
        return JSON.parse(content);
      } catch {
        throw new SummaryFailure('response-json');
      }
    }, 'Generate changelog summaries via configured HTTP endpoint').catch(
      error => {
        if (error instanceof SummaryFailure) throw error;
        throw new SummaryFailure(signal.aborted ? 'deadline' : 'network');
      },
    );
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
