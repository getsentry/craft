/**
 * Tests for AI summary functionality
 * - GitHub Models API (primary, abstractive summarization)
 * - Local Hugging Face model (fallback, extractive summarization)
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock child_process for gh auth token
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue('mock-github-token\n'),
}));

// Mock the AI SDK
let mockGenerateTextResponse =
  'Enhanced changelog with new features and improvements.';
let shouldGenerateFail = false;

vi.mock('ai', () => ({
  generateText: vi.fn().mockImplementation(() => {
    if (shouldGenerateFail) {
      return Promise.reject(new Error('API error'));
    }
    return Promise.resolve({ text: mockGenerateTextResponse });
  }),
}));

vi.mock('@github/models', () => ({
  githubModels: vi.fn().mockReturnValue({ modelId: 'mock-model' }),
}));

// Mock Hugging Face transformers for local fallback
let mockLocalSummary =
  'Add support for custom entries. Make release workflow reusable.';
let shouldLocalFail = false;

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockImplementation(() => {
    if (shouldLocalFail) {
      return Promise.reject(new Error('Local model error'));
    }
    return Promise.resolve(async () => [{ summary_text: mockLocalSummary }]);
  }),
}));

// Import after mocking
import {
  summarizeSection,
  summarizeItems,
  isAiSummaryAvailable,
  resetPipeline,
  DEFAULT_KICK_IN_THRESHOLD,
  DEFAULT_AI_MODEL,
  LOCAL_FALLBACK_MODEL,
  getModelInfo,
  type AiSummariesConfig,
} from '../utils/ai-summary';

describe('ai-summary', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    shouldGenerateFail = false;
    shouldLocalFail = false;
    mockGenerateTextResponse =
      'Enhanced changelog with new features and improvements.';
    mockLocalSummary =
      'Add support for custom entries. Make release workflow reusable.';
    resetPipeline();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constants', () => {
    test('DEFAULT_KICK_IN_THRESHOLD is 5', () => {
      expect(DEFAULT_KICK_IN_THRESHOLD).toBe(5);
    });

    test('DEFAULT_AI_MODEL uses Ministral-3b', () => {
      expect(DEFAULT_AI_MODEL).toBe('mistral-ai/ministral-3b');
    });

    test('LOCAL_FALLBACK_MODEL uses Falconsai', () => {
      expect(LOCAL_FALLBACK_MODEL).toBe('Falconsai/text_summarization');
    });
  });

  describe('getModelInfo', () => {
    test('returns default model when no config', () => {
      expect(getModelInfo()).toBe('mistral-ai/ministral-3b');
    });

    test('returns custom model from config', () => {
      const config: AiSummariesConfig = { model: 'openai/gpt-4o-mini' };
      expect(getModelInfo(config)).toBe('openai/gpt-4o-mini');
    });
  });

  describe('summarizeItems', () => {
    test('returns null for empty array', async () => {
      const result = await summarizeItems([]);
      expect(result).toBeNull();
    });

    test('returns null for items at threshold', async () => {
      const items = ['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5'];
      expect(items.length).toBe(DEFAULT_KICK_IN_THRESHOLD);
      const result = await summarizeItems(items);
      expect(result).toBeNull();
    });

    test('returns summary for items above threshold', async () => {
      const items = ['A', 'B', 'C', 'D', 'E', 'F']; // 6 items > threshold
      const result = await summarizeItems(items);
      expect(result).toBe(
        'Enhanced changelog with new features and improvements.',
      );
    });

    test('respects custom kickInThreshold', async () => {
      const items = ['A', 'B', 'C']; // 3 items
      const config: AiSummariesConfig = { kickInThreshold: 2 };
      const result = await summarizeItems(items, config);
      expect(result).toBe(
        'Enhanced changelog with new features and improvements.',
      );
    });

    test('returns null when enabled is false', async () => {
      const items = ['A', 'B', 'C', 'D', 'E', 'F'];
      const config: AiSummariesConfig = { enabled: false };
      const result = await summarizeItems(items, config);
      expect(result).toBeNull();
    });

    test('falls back to local model when GitHub API fails', async () => {
      shouldGenerateFail = true;
      const items = ['A', 'B', 'C', 'D', 'E', 'F'];
      const result = await summarizeItems(items);
      expect(result).toBe(mockLocalSummary);
    });

    test('falls back to local model when no GitHub token', async () => {
      delete process.env.GITHUB_TOKEN;
      const childProcess = await import('child_process');
      vi.mocked(childProcess.execSync).mockImplementationOnce(() => {
        throw new Error('gh not found');
      });

      const items = ['A', 'B', 'C', 'D', 'E', 'F'];
      const result = await summarizeItems(items);
      expect(result).toBe(mockLocalSummary);
    });

    test('uses local model when explicitly configured', async () => {
      const items = ['A', 'B', 'C', 'D', 'E', 'F'];
      const config: AiSummariesConfig = {
        model: 'local:Falconsai/text_summarization',
      };
      const result = await summarizeItems(items, config);
      expect(result).toBe(mockLocalSummary);
    });

    test('returns null when both API and local fail', async () => {
      shouldGenerateFail = true;
      shouldLocalFail = true;
      const items = ['A', 'B', 'C', 'D', 'E', 'F'];
      const result = await summarizeItems(items);
      expect(result).toBeNull();
    });

    test('uses GITHUB_TOKEN from env', async () => {
      process.env.GITHUB_TOKEN = 'env-token';
      const items = ['A', 'B', 'C', 'D', 'E', 'F'];
      const result = await summarizeItems(items);
      expect(result).toBe(
        'Enhanced changelog with new features and improvements.',
      );
    });
  });

  describe('summarizeSection (legacy)', () => {
    test('returns null for empty text', async () => {
      const result = await summarizeSection('');
      expect(result).toBeNull();
    });

    test('returns null for very short text', async () => {
      const result = await summarizeSection('Short');
      expect(result).toBeNull();
    });

    test('extracts items from bullet points', async () => {
      const text = `
        - Item 1
        - Item 2
        - Item 3
        - Item 4
        - Item 5
        - Item 6
      `;
      const result = await summarizeSection(text);
      expect(result).toBe(
        'Enhanced changelog with new features and improvements.',
      );
    });
  });

  describe('isAiSummaryAvailable', () => {
    test('returns true (always available with local fallback)', async () => {
      const result = await isAiSummaryAvailable();
      expect(result).toBe(true);
    });
  });

  describe('resetPipeline', () => {
    test('does not throw', () => {
      expect(() => resetPipeline()).not.toThrow();
    });
  });
});
