import * as fs from 'fs';

import { logger } from '../../logger';
import { withTempDir, withTempFile } from '../files';

import {
  calculateChecksum,
  extractZipArchive,
  hasExecutable,
  HashAlgorithm,
  HashOutputFormat,
  replaceEnvVariable,
  spawnProcess,
} from '../system';

jest.mock('../../logger');

describe('spawnProcess', () => {
  test('resolves on success with standard output', async () => {
    expect.assertions(1);
    const stdout =
      (await spawnProcess(process.execPath, ['-p', '"test"'])) || '';
    expect(stdout.toString()).toBe('test\n');
  });

  test('rejects on non-zero exit code', async () => {
    try {
      expect.assertions(2);
      await spawnProcess('test', ['']);
    } catch (e) {
      expect(e.code).toBe(1);
      expect(e.message).toMatch(/code 1/);
    }
  });

  test('rejects on error', async () => {
    try {
      expect.assertions(1);
      await spawnProcess('this_command_does_not_exist');
    } catch (e) {
      expect(e.message).toMatch(/ENOENT/);
    }
  });

  test('attaches args on error', async () => {
    try {
      expect.assertions(1);
      await spawnProcess('test', ['x', 'y']);
    } catch (e) {
      expect(e.args).toEqual(['x', 'y']);
    }
  });

  test('attaches options on error', async () => {
    try {
      expect.assertions(1);
      await spawnProcess('test', [], { cwd: '/tmp/' });
    } catch (e) {
      expect(e.options.cwd).toEqual('/tmp/');
    }
  });

  test('strips env from options on error', async () => {
    try {
      expect.assertions(1);
      await spawnProcess('test', [], { env: { x: '123', password: '456' } });
    } catch (e) {
      expect(e.options.env).toBeUndefined();
    }
  });

  test('does not write to output by default', async () => {
    const mockedLogInfo = logger.info as jest.Mock;

    await spawnProcess(process.execPath, ['-p', '"test-string"']);

    expect(mockedLogInfo).toHaveBeenCalledTimes(0);
  });

  test('writes to output if told so', async () => {
    const mockedLogInfo = logger.info as jest.Mock;

    await spawnProcess(
      process.execPath,
      ['-e', 'process.stdout.write("test-string")'],
      {},
      { showStdout: true }
    );

    expect(mockedLogInfo).toHaveBeenCalledTimes(1);
    expect(mockedLogInfo.mock.calls[0][0]).toMatch(/test-string/);
  });
});

describe('replaceEnvVariable', () => {
  test('replaces a variable', async () => {
    expect(replaceEnvVariable('${ENV_VAR}', { ENV_VAR: '123' })).toBe('123');
  });

  test('does not replace a variable if there is no curly braces', async () => {
    expect(replaceEnvVariable('$ENV_VAR', { ENV_VAR: '123' })).toBe('$ENV_VAR');
  });

  test('replaces a non-existing environment variable with empty string', async () => {
    expect(replaceEnvVariable('${ENV_VAR}', {})).toBe('');
  });
});

describe('calculateChecksum', () => {
  test('Default checksum on a basic file', async () => {
    expect.assertions(1);

    await withTempFile(async tmpFilePath => {
      fs.writeFileSync(tmpFilePath, '\n');

      const checksum = await calculateChecksum(tmpFilePath);
      expect(checksum).toBe(
        '01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b'
      );
    });
  });

  test('Base64-formatted checksum on a basic file', async () => {
    expect.assertions(1);

    await withTempFile(async tmpFilePath => {
      fs.writeFileSync(tmpFilePath, '\n');

      const checksum = await calculateChecksum(tmpFilePath, {
        format: HashOutputFormat.Base64,
      });
      expect(checksum).toBe('AbpHGcgLb+kRsJGnwFEktk7uzpZOCcBY74+YBdrKVGs=');
    });
  });

  test('Base64-formatted checksum with custom algorithm on a basic file', async () => {
    expect.assertions(1);

    await withTempFile(async tmpFilePath => {
      fs.writeFileSync(tmpFilePath, '\n');

      const checksum = await calculateChecksum(tmpFilePath, {
        algorithm: HashAlgorithm.SHA384,
        format: HashOutputFormat.Base64,
      });
      expect(checksum).toBe(
        '7GZOiJ7WwbJ2PKz3iZ2Vt/NHNz65guUjQZ/uo6o2LYkbO/Al8pImelhUBJCReJw+'
      );
    });
  });
});

describe('isExecutableInPath', () => {
  test('checks for existing executable', () => {
    expect(hasExecutable('node')).toBe(true);
  });

  test('checks for non-existing executable', () => {
    expect(hasExecutable('not-existing-executable')).toBe(false);
  });

  test('checks for existing executable using absolute path', () => {
    expect(hasExecutable(`${process.cwd()}/node_modules/.bin/jest`)).toBe(true);
  });

  test('checks for non-existing executable using absolute path', () => {
    expect(hasExecutable('/dev/null/non-existing-binary')).toBe(false);
  });

  test('checks for existing executable using relative path', () => {
    expect(hasExecutable('./node_modules/.bin/jest')).toBe(true);
  });

  test('checks for non-existing executable using relative path', () => {
    expect(hasExecutable('./bin/non-existing-binary')).toBe(false);
  });
});

describe('extractZipArchive', () => {
    // zip with `t.txt` and `5000` iterations of `f'{string.ascii_letters}\n'}`
    test('it can extract a larger zip', async () => {
        await withTempDir(async tmpdir => {
            const zip = `${tmpdir}/out.zip`;

            const zipf = await fs.promises.open(zip, 'w');
            await zipf.writeFile(Buffer.from([80, 75, 3, 4, 10, 0, 0, 0, 0, 0, 99, 150, 109, 88, 220, 199, 60, 159, 40, 11, 4, 0, 40, 11, 4, 0, 5, 0, 28, 0, 116, 46, 116, 120, 116, 85, 84, 9, 0, 3, 153, 245, 241, 101, 140, 245, 241, 101, 117, 120, 11, 0, 1, 4, 0, 0, 0, 0, 4, 0, 0, 0, 0]));
            for (let i = 0; i < 5000; i += 1) {
                await zipf.writeFile('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ\n');
            }
            await zipf.writeFile(Buffer.from([80, 75, 1, 2, 30, 3, 10, 0, 0, 0, 0, 0, 99, 150, 109, 88, 220, 199, 60, 159, 40, 11, 4, 0, 40, 11, 4, 0, 5, 0, 24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 164, 129, 0, 0, 0, 0, 116, 46, 116, 120, 116, 85, 84, 5, 0, 3, 153, 245, 241, 101, 117, 120, 11, 0, 1, 4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 80, 75, 5, 6, 0, 0, 0, 0, 1, 0, 1, 0, 75, 0, 0, 0, 103, 11, 4, 0, 0, 0]));
            await zipf.close();

            await extractZipArchive(zip, `${tmpdir}/out`);

            // should not have corrupted our file
            const checksum = await calculateChecksum(`${tmpdir}/out/t.txt`);
            expect(checksum).toBe('7687e11d941faf48d4cf1692c2473a599ad0d7030e1e5c639a31b2f59cd646ba');
        });
    });
});
