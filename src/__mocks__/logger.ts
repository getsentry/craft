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
  pause: vi.fn(),
  resume: vi.fn(),
};

export const LogLevel = {
  Fatal: 0,
  Error: 0,
  Warn: 1,
  Log: 2,
  Info: 3,
  Success: 3,
  Debug: 4,
  Trace: 5,
  Silent: -Infinity,
  Verbose: Infinity,
};

export const setLevel = vi.fn();
