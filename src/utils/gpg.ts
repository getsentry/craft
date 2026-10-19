import { spawnProcess } from './system';

/**
 * Imports a GPG private key into the local keyring.
 *
 * The key is piped to `gpg --batch --import` via stdin — it is NEVER
 * written to disk. This avoids the previous TOCTOU / information
 * disclosure hazards of writing the key to a predictable path in
 * `tmpdir()`:
 *
 *   - Co-resident processes on shared runners could read the key
 *     between `writeFile` and `unlink` (typical `/tmp` is mode 1777).
 *   - A symlink planted at `/tmp/private-key.asc` before `writeFile`
 *     would redirect the write to an attacker-chosen destination.
 *   - An unexpected crash between `writeFile` and `unlink` would
 *     leave the key on disk indefinitely.
 *
 * @param privateKey ASCII-armored GPG private key contents.
 */
export async function importGPGKey(privateKey: string): Promise<void> {
  await spawnProcess('gpg', ['--batch', '--import'], {}, { stdin: privateKey });
}
