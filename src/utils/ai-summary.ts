import { logger } from '../logger';

/**
 * Default threshold for AI summarization.
 * Sections with more items than this will be summarized.
 */
export const DEFAULT_KICK_IN_THRESHOLD = 5;

/**
 * Default model for summarization via GitHub Models API.
 * Ministral-3b provides the best compression (71%) while being fast.
 */
export const DEFAULT_AI_MODEL = 'openai/gpt-4o-mini';

/**
 * Local fallback model when no GitHub token is available.
 * Falconsai provides extractive summarization (~48% compression).
 */
export const LOCAL_FALLBACK_MODEL = 'Falconsai/text_summarization';

/**
 * Top-level summary configuration options.
 * - "always" or true: Always generate top-level summary
 * - "never" or false: Never generate top-level summary
 * - "threshold": Only generate if total items exceed kickInThreshold
 */
export type TopLevelSummaryOption =
  | 'always'
  | 'never'
  | 'threshold'
  | boolean;

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
   * Model to use for summarization.
   * - GitHub Models: "mistral-ai/ministral-3b", "openai/gpt-4o-mini", etc.
   * - Local: "local:Falconsai/text_summarization"
   * Default: openai/gpt-4o-mini (requires GITHUB_TOKEN)
   */
  model?: string;

  /**
   * Top-level overall summary configuration.
   * - "always" or true: Always generate top-level summary
   * - "never" or false: Never generate top-level summary
   * - "threshold": Only generate if total items exceed kickInThreshold
   * Default: "threshold"
   */
  topLevel?: TopLevelSummaryOption;
}

// Cached local summarizer pipeline
let localSummarizer: any = null;

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
 * Summarizes using GitHub Models API (abstractive, high quality).
 */
async function summarizeWithGitHubModels(
  items: string[],
  modelName: string,
  token: string
): Promise<string | null> {
  const { generateText } = await import('ai');
  const { githubModels } = await import('@github/models');

  const model = githubModels(modelName, { apiKey: token });

  const itemsList = items.map((item, i) => `${i + 1}. ${item}`).join('\n');
  const inputWordCount = items.join(' ').split(/\s+/).length;
  const targetWords = Math.max(15, Math.floor(inputWordCount * 0.4));

  const { text } = await generateText({
    model,
    prompt: `Summarize these ${items.length} changelog items into ONE neutral, factual sentence of approximately ${targetWords} words. Group related changes by theme. Be informative, not promotional - avoid words like "enhanced", "improved", "significant", or "powerful". Simply state what changed.

Items:
${itemsList}

Summary (${targetWords} words max, neutral tone):`,
    maxTokens: 60,
    temperature: 0.3,
  });

  return text.trim() || null;
}

/**
 * Summarizes using local Hugging Face model (extractive, no token needed).
 */
async function summarizeWithLocalModel(
  items: string[],
  modelName: string
): Promise<string | null> {
  // Lazy load the pipeline
  if (!localSummarizer) {
    logger.info(`Loading local AI model: ${modelName}`);
    logger.info('First run may take a minute to download (~60MB)...');

    const { pipeline } = await import('@huggingface/transformers');
    localSummarizer = await pipeline('summarization', modelName);
  }

  const text = items.join('. ') + '.';
  const result = await localSummarizer(text, {
    max_length: 60,
    min_length: 15,
  });

  return result[0]?.summary_text?.trim() || null;
}

/**
 * Summarizes a list of changelog items into a concise description.
 *
 * Uses GitHub Models API by default for high-quality abstractive summarization.
 * Falls back to local Hugging Face model if no GitHub token is available.
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

  const requestedModel = config?.model ?? DEFAULT_AI_MODEL;

  // Check if explicitly requesting local model
  const isLocalModel = requestedModel.startsWith('local:');
  const modelName = isLocalModel
    ? requestedModel.slice(6)
    : requestedModel;

  try {
    if (isLocalModel) {
      // Use local model explicitly
      logger.debug(`Using local model: ${modelName}`);
      return await summarizeWithLocalModel(items, modelName);
    }

    // Try GitHub Models API first
    const token = await getGitHubToken();

    if (token) {
      logger.debug(`Using GitHub Models: ${modelName}`);
      return await summarizeWithGitHubModels(items, modelName, token);
    }

    // No token - fall back to local model
    logger.debug(
      'No GitHub token found, falling back to local model'
    );
    return await summarizeWithLocalModel(items, LOCAL_FALLBACK_MODEL);
  } catch (error: any) {
    logger.warn('AI summarization failed:', error?.message || error);

    // If GitHub Models failed, try local fallback
    if (!isLocalModel) {
      try {
        logger.debug('Trying local fallback model...');
        return await summarizeWithLocalModel(items, LOCAL_FALLBACK_MODEL);
      } catch (fallbackError: any) {
        logger.warn(
          'Local fallback also failed:',
          fallbackError?.message || fallbackError
        );
      }
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
 * Checks if AI summarization is available.
 * Returns true if GitHub token exists or local model can be used.
 */
export async function isAiSummaryAvailable(): Promise<boolean> {
  // Always available - falls back to local model
  return true;
}

/**
 * Resets the cached pipeline (useful for tests).
 */
export function resetPipeline(): void {
  localSummarizer = null;
}

/**
 * Gets info about the configured model.
 */
export function getModelInfo(config?: AiSummariesConfig): string {
  return config?.model ?? DEFAULT_AI_MODEL;
}

/**
 * Formats a summary with original items in an expandable details block.
 * When a summary is provided, it shows the summary followed by a collapsed
 * details section containing the original items.
 *
 * @param summary - The AI-generated summary (or null if summarization was skipped)
 * @param originalItems - The original changelog items as formatted markdown lines
 * @returns Formatted markdown with optional details block
 */
export function formatSummaryWithDetails(
  summary: string | null,
  originalItems: string[]
): string {
  if (!summary || originalItems.length === 0) {
    // No summary - just return original items as-is
    return originalItems.join('\n');
  }

  // Summary exists - show it with original items in a collapsible details block
  const itemCount = originalItems.length;
  const detailsLabel = `Show ${itemCount} item${itemCount !== 1 ? 's' : ''}`;

  return `${summary}

<details>
<summary>${detailsLabel}</summary>

${originalItems.join('\n')}

</details>`;
}

/**
 * Normalizes the topLevel config value to a consistent format.
 */
function normalizeTopLevel(
  topLevel: TopLevelSummaryOption | undefined
): 'always' | 'never' | 'threshold' {
  if (topLevel === true || topLevel === 'always') {
    return 'always';
  }
  if (topLevel === false || topLevel === 'never') {
    return 'never';
  }
  // Default to 'threshold'
  return 'threshold';
}

/**
 * Checks if a top-level summary should be generated based on config and item count.
 */
export function shouldGenerateTopLevel(
  totalItems: number,
  config?: AiSummariesConfig
): boolean {
  if (config?.enabled === false) {
    return false;
  }

  const topLevel = normalizeTopLevel(config?.topLevel);

  switch (topLevel) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'threshold': {
      const threshold = config?.kickInThreshold ?? DEFAULT_KICK_IN_THRESHOLD;
      return totalItems > threshold;
    }
  }
}

/**
 * Generates a top-level summary for the entire changelog.
 * Creates a single paragraph with up to 5 sentences summarizing all changes.
 *
 * @param sections - Map of section names to their items
 * @param config - Optional AI summaries configuration
 * @returns A paragraph summary, or null if disabled/below threshold
 */
export async function summarizeChangelog(
  sections: Record<string, string[]>,
  config?: AiSummariesConfig
): Promise<string | null> {
  // Check if enabled
  if (config?.enabled === false) {
    return null;
  }

  // Count total items
  const totalItems = Object.values(sections).reduce(
    (sum, items) => sum + items.length,
    0
  );

  // Check if we should generate based on topLevel setting
  if (!shouldGenerateTopLevel(totalItems, config)) {
    return null;
  }

  const requestedModel = config?.model ?? DEFAULT_AI_MODEL;
  const isLocalModel = requestedModel.startsWith('local:');
  const modelName = isLocalModel ? requestedModel.slice(6) : requestedModel;

  // Build a structured summary of all sections
  const sectionSummaries = Object.entries(sections)
    .filter(([_, items]) => items.length > 0)
    .map(([name, items]) => `${name}: ${items.slice(0, 5).join('; ')}${items.length > 5 ? ` (+${items.length - 5} more)` : ''}`)
    .join('\n');

  try {
    if (isLocalModel) {
      // Local model - just summarize the section summaries
      return await summarizeWithLocalModel(
        sectionSummaries.split('\n'),
        modelName
      );
    }

    const token = await getGitHubToken();

    if (token) {
      const { generateText } = await import('ai');
      const { githubModels } = await import('@github/models');

      const model = githubModels(modelName, { apiKey: token });

      const { text } = await generateText({
        model,
        prompt: `Write a brief, neutral summary (1 paragraph, maximum 5 sentences) of this software release. List the main areas of change without promotional language - avoid words like "enhanced", "improved", "significant", "powerful", or "exciting". Simply state what was added, changed, or fixed.

Changelog sections:
${sectionSummaries}

Total changes: ${totalItems} items across ${Object.keys(sections).length} sections.

Summary (neutral, factual tone):`,
        maxTokens: 150,
        temperature: 0.3,
      });

      return text.trim() || null;
    }

    // Fallback to local model
    logger.debug('No GitHub token found, falling back to local model');
    return await summarizeWithLocalModel(
      sectionSummaries.split('\n'),
      LOCAL_FALLBACK_MODEL
    );
  } catch (error: any) {
    logger.warn('Top-level summarization failed:', error?.message || error);

    // If GitHub Models failed and not explicitly using local model, try local fallback
    if (!isLocalModel) {
      try {
        logger.debug('Trying local fallback model for top-level summary...');
        return await summarizeWithLocalModel(
          sectionSummaries.split('\n'),
          LOCAL_FALLBACK_MODEL
        );
      } catch (fallbackError: any) {
        logger.warn(
          'Local fallback also failed:',
          fallbackError?.message || fallbackError
        );
      }
    }

    return null;
  }
}
