import { vi } from 'vitest';
import * as actualFs from 'fs';

export const existsSync = vi.fn(() => true);

// Re-export everything from the actual fs module
export * from 'fs';
// Override existsSync with our mock
export default {
  ...actualFs,
  existsSync,
};
