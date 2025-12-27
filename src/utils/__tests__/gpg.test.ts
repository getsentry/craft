import { vi, describe, test, expect } from 'vitest';
import { promises as fsPromises } from 'fs';
import { importGPGKey } from '../gpg';
import { spawnProcess } from '../system';

vi.mock('../system');

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      writeFile: vi.fn(() => Promise.resolve()),
      unlink: vi.fn(),
    },
  };
});

describe('importGPGKey', () => {
  const KEY = 'very_private_key_like_for_real_really_private';
  const PRIVATE_KEY_FILE_MATCHER = expect.stringMatching(/private-key.asc$/);

  test('should write key to temp file', async () => {
    importGPGKey(KEY);
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      PRIVATE_KEY_FILE_MATCHER,
      KEY
    );
  });

  test('should remove file with the key afterwards', async () => {
    importGPGKey(KEY);
    expect(spawnProcess).toHaveBeenCalledWith('gpg', [
      '--batch',
      '--import',
      PRIVATE_KEY_FILE_MATCHER,
    ]);
  });

  test('should call gpg command to load the key', async () => {
    importGPGKey(KEY);
    expect(fsPromises.unlink).toHaveBeenCalledWith(PRIVATE_KEY_FILE_MATCHER);
  });
});
