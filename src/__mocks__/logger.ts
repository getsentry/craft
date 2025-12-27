import { vi } from 'vitest';

export const logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  withScope: vi.fn().mockReturnThis(),
};
