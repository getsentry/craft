import { logger } from '../logger';

/**
 * Default threshold for AI summarization.
 * Sections with more items than this will be summarized.
 */
export const DEFAULT_KICK_IN_THRESHOLD = 5;

/**
 * Default model for summarization via GitHub Models API.
 */
export const DEFAULT_AI_MODEL = 'openai/gpt-4o-mini';

/**
 * Configuration options for AI summarization.
 * Maps to the `aiSummaries` config block in .craft.yml
 */
export interface AiSummariesConfig {
  /**
   * Enable AI-powered summaries. Default: true
   */
  enabled?: boolean;

  /**
   * Number of items before AI summarization kicks in. Default: 5
   */
  kickInThreshold?: number;

  /**
   * GitHub Models model name (e.g., "openai/gpt-4o-mini", "meta/meta-llama-3.1-8b-instruct")
   * Default: openai/gpt-4o-mini
   */
  model?: string;
}

/**
 * Gets the GitHub token for API authentication.
 * Tries GITHUB_TOKEN env var first, then falls back to `gh auth token`.
 */
async function getGitHubToken(): Promise<string | null> {
  // Check environment variable first
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  // Try gh CLI
  try {
    const { execSync } = await import('child_process');
    const token = execSync('gh auth token', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Summarizes a list of changelog items into a concise description.
 * Uses GitHub Models API for high-quality summarization.
 *
 * @param items - Array of changelog item descriptions
 * @param config - Optional AI summaries configuration
 * @returns Condensed summary, or null if below threshold or disabled
 */
export async function summarizeItems(
  items: string[],
  config?: AiSummariesConfig
): Promise<string | null> {
  // Check if enabled (default: true)
  if (config?.enabled === false) {
    return null;
  }

  const threshold = config?.kickInThreshold ?? DEFAULT_KICK_IN_THRESHOLD;

  // Don't summarize if at or below threshold
  if (!items || items.length <= threshold) {
    return null;
  }

  const token = await getGitHubToken();
  if (!token) {
    logger.warn(
      'No GitHub token found. Set GITHUB_TOKEN or run `gh auth login`.'
    );
    return null;
  }

  try {
    const { generateText } = await import('ai');
    const { githubModels } = await import('@github/models');

    const modelName = config?.model ?? DEFAULT_AI_MODEL;
    const model = githubModels(modelName, { apiKey: token });

    const itemsList = items.map((item, i) => `${i + 1}. ${item}`).join('\n');
    const inputWordCount = items.join(' ').split(/\s+/).length;
    const targetWords = Math.max(15, Math.floor(inputWordCount * 0.4));

    const { text } = await generateText({
      model,
      prompt: `Summarize these ${items.length} changelog items into ONE sentence of approximately ${targetWords} words. Group related changes and focus on key themes. Do not list each item - synthesize them.

Items:
${itemsList}

Summary (${targetWords} words max):`,
      maxTokens: 60,
      temperature: 0.3,
    });

    const summary = text.trim();
    return summary || null;
  } catch (error: any) {
    logger.warn('AI summarization failed:', error?.message || error);
    if (error?.cause) {
      logger.debug('Cause:', error.cause);
    }
    return null;
  }
}

/**
 * Legacy function for backwards compatibility.
 */
export async function summarizeSection(
  text: string,
  config?: AiSummariesConfig
): Promise<string | null> {
  if (!text || text.trim().length < 50) {
    return null;
  }

  const items = text
    .split('\n')
    .map(line => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);

  return summarizeItems(items, config);
}

/**
 * Checks if AI summarization is available (GitHub token exists).
 */
export async function isAiSummaryAvailable(): Promise<boolean> {
  const token = await getGitHubToken();
  return !!token;
}

/**
 * Resets the pipeline (no-op for API-based approach, kept for compatibility).
 */
export function resetPipeline(): void {
  // No-op for API-based approach
}

/**
 * Gets info about the configured model.
 */
export function getModelInfo(config?: AiSummariesConfig): string {
  return config?.model ?? DEFAULT_AI_MODEL;
}
