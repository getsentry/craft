/**
 * Tests for AI summary functionality using GitHub Models API
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock child_process for gh auth token
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue('mock-github-token\n'),
}));

// Mock the AI SDK
let mockGenerateTextResponse = 'Enhanced changelog with new features and bug fixes.';
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

// Import after mocking
import {
  summarizeSection,
  summarizeItems,
  isAiSummaryAvailable,
  resetPipeline,
  DEFAULT_KICK_IN_THRESHOLD,
  DEFAULT_AI_MODEL,
  getModelInfo,
  type AiSummariesConfig,
} from '../utils/ai-summary';

describe('ai-summary', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    shouldGenerateFail = false;
    mockGenerateTextResponse = 'Enhanced changelog with new features and bug fixes.';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constants', () => {
    test('DEFAULT_KICK_IN_THRESHOLD is 5', () => {
      expect(DEFAULT_KICK_IN_THRESHOLD).toBe(5);
    });

    test('DEFAULT_AI_MODEL uses GPT-4o-mini', () => {
      expect(DEFAULT_AI_MODEL).toBe('openai/gpt-4o-mini');
    });
  });

  describe('getModelInfo', () => {
    test('returns default model when no config', () => {
      expect(getModelInfo()).toBe('openai/gpt-4o-mini');
    });

    test('returns custom model from config', () => {
      const config: AiSummariesConfig = { model: 'meta/meta-llama-3.1-8b-instruct' };
      expect(getModelInfo(config)).toBe('meta/meta-llama-3.1-8b-instruct');
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
      expect(result).toBe('Enhanced changelog with new features and bug fixes.');
    });

    test('respects custom kickInThreshold', async () => {
      const items = ['A', 'B', 'C']; // 3 items
      const config: AiSummariesConfig = { kickInThreshold: 2 };
      const result = await summarizeItems(items, config);
      expect(result).toBe('Enhanced changelog with new features and bug fixes.');
    });

    test('returns null when enabled is false', async () => {
      const items = ['A', 'B', 'C', 'D', 'E', 'F'];
      const config: AiSummariesConfig = { enabled: false };
      const result = await summarizeItems(items, config);
      expect(result).toBeNull();
    });

    test('returns null when API fails', async () => {
      shouldGenerateFail = true;
      const items = ['A', 'B', 'C', 'D', 'E', 'F'];
      const result = await summarizeItems(items);
      expect(result).toBeNull();
    });

    test('returns null when no GitHub token', async () => {
      // Clear env and mock gh CLI to fail
      delete process.env.GITHUB_TOKEN;
      const childProcess = await import('child_process');
      vi.mocked(childProcess.execSync).mockImplementationOnce(() => {
        throw new Error('gh not found');
      });

      const items = ['A', 'B', 'C', 'D', 'E', 'F'];
      const result = await summarizeItems(items);
      expect(result).toBeNull();
    });

    test('uses GITHUB_TOKEN from env', async () => {
      process.env.GITHUB_TOKEN = 'env-token';
      const items = ['A', 'B', 'C', 'D', 'E', 'F'];
      const result = await summarizeItems(items);
      expect(result).toBe('Enhanced changelog with new features and bug fixes.');
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
      expect(result).toBe('Enhanced changelog with new features and bug fixes.');
    });
  });

  describe('isAiSummaryAvailable', () => {
    test('returns true when GITHUB_TOKEN is set', async () => {
      process.env.GITHUB_TOKEN = 'test-token';
      const result = await isAiSummaryAvailable();
      expect(result).toBe(true);
    });

    test('returns true when gh CLI provides token', async () => {
      delete process.env.GITHUB_TOKEN;
      const result = await isAiSummaryAvailable();
      expect(result).toBe(true);
    });

    test('returns false when no token available', async () => {
      delete process.env.GITHUB_TOKEN;
      const childProcess = await import('child_process');
      vi.mocked(childProcess.execSync).mockImplementationOnce(() => {
        throw new Error('gh not found');
      });
      const result = await isAiSummaryAvailable();
      expect(result).toBe(false);
    });
  });

  describe('resetPipeline', () => {
    test('does not throw', () => {
      expect(() => resetPipeline()).not.toThrow();
    });
  });
});
