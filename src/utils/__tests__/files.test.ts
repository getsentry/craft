import { existsSync, rmdirSync } from 'fs';
import { join, resolve } from 'path';

import { listFiles, withTempDir } from '../files';

describe('listFiles', () => {
  const testDir = resolve(__dirname, '../__fixtures__/listFiles');
  const testFiles = ['a', 'b'].map(f => join(testDir, f));

  test('returns only files', async () => {
    expect.assertions(1);
    const files = await listFiles(testDir);
    expect(files).toEqual(testFiles);
  });
});

describe('withTempDir', () => {
  async function testDirectories(
    callback: (arg: any) => any,
    cleanupEnabled = true,
  ): Promise<any> {
    let directory = '';
    try {
      await withTempDir(dir => {
        directory = dir;
        expect(existsSync(directory)).toBeTruthy();
        return callback(directory);
      }, cleanupEnabled);
    } finally {
      if (cleanupEnabled) {
        // We intentionally do not block on the clean up operation
        // so wait ~100ms before checking
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(existsSync(directory)).toBeFalsy();
      } else {
        expect(existsSync(directory)).toBeTruthy();
      }
    }
  }

  test('creates and removes synchronously', async () => {
    expect.assertions(2);
    await testDirectories(() => true);
  });

  test('creates and removes on error', async () => {
    try {
      expect.assertions(3);
      await testDirectories(() => {
        throw new Error('fail');
      });
    } catch (e) {
      expect(e.message).toBe('fail');
    }
  });

  test('creates and does not remove if cleanup flag is specified', async () => {
    expect.assertions(2);
    let tempDir = '';
    await testDirectories(arg => {
      tempDir = arg;
    }, false);
    // Cleanup
    rmdirSync(tempDir);
  });

  test('creates and removes on Promise resolution', async () => {
    expect.assertions(2);
    await testDirectories(() => Promise.resolve('success'));
  });

  test('creates and removes on Promise rejection', async () => {
    try {
      expect.assertions(3);
      await testDirectories(() => Promise.reject(new Error('fail')));
    } catch (e) {
      expect(e.message).toBe('fail');
    }
  });

  test('returns the callback return value synchronously', async () => {
    expect.assertions(1);
    const result = await withTempDir(() => 'result');
    expect(result).toBe('result');
  });

  test('returns the callback return value asynchronously', async () => {
    expect.assertions(1);
    const result = await withTempDir(() => Promise.resolve('result'));
    expect(result).toBe('result');
  });
});
