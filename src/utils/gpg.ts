import { tmpdir } from 'os';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { spawnProcess } from './system';

export async function importGPGKey(privateKey: string): Promise<void> {
  const PRIVATE_KEY_FILE = path.join(tmpdir(), 'private-key.asc');

  await fsPromises.writeFile(PRIVATE_KEY_FILE, privateKey);
  await spawnProcess(`gpg`, ['--batch', '--import', PRIVATE_KEY_FILE]);
  await fsPromises.unlink(PRIVATE_KEY_FILE);
}
