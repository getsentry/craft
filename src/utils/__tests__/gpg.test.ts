import { vi, describe, test, expect, beforeEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import { importGPGKey } from '../gpg';
import { spawnProcess } from '../system';

vi.mock('../system');

vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      writeFile: vi.fn(() => Promise.resolve()),
      unlink: vi.fn(() => Promise.resolve()),
      mkdtemp: vi.fn(() => Promise.resolve('/tmp/should-not-be-created')),
      rm: vi.fn(() => Promise.resolve()),
    },
  };
});

describe('importGPGKey', () => {
  const KEY = 'very_private_key_like_for_real_really_private';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('passes the key to gpg via stdin and never touches the filesystem', async () => {
    await importGPGKey(KEY);

    // gpg is spawned with --batch --import, no file path argument.
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(spawnProcess).toHaveBeenCalledWith(
      'gpg',
      ['--batch', '--import'],
      {},
      { stdin: KEY },
    );
  });

  test('does not write or unlink any file', async () => {
    await importGPGKey(KEY);

    // The old implementation wrote the key to `tmpdir()/private-key.asc`
    // and then unlinked it. Neither must happen in the new version.
    expect(fsPromises.writeFile).not.toHaveBeenCalled();
    expect(fsPromises.unlink).not.toHaveBeenCalled();
  });

  test('key is not embedded in argv (not visible in process list)', async () => {
    await importGPGKey(KEY);

    const [, args] = (spawnProcess as any).mock.calls[0];
    // Argv should contain only the static gpg flags; the key must only
    // travel through stdin.
    for (const arg of args as string[]) {
      expect(arg).not.toContain(KEY);
    }
  });
});
