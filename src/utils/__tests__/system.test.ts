import * as fs from 'fs';
import * as tmp from 'tmp';

import logger from '../../logger';

import {
  calculateChecksum,
  hasExecutable,
  replaceEnvVariable,
  sleepAsync,
  spawnProcess,
} from '../system';

jest.mock('../../logger');

describe('spawnProcess', () => {
  test('resolves on success with standard output', async () => {
    expect.assertions(1);
    const output = await spawnProcess('/bin/echo', ['test']);
    expect(output.trim()).toBe('/bin/echo: test\n/bin/echo:');
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
      await spawnProcess('test', [], { env: { x: 123, password: 456 } });
    } catch (e) {
      expect(e.options.env).toBeUndefined();
    }
  });

  test('does not write to output by default', async () => {
    const mockedLogInfo = logger.info as jest.Mock;

    await spawnProcess('echo', ['-n', 'test-string']);

    expect(mockedLogInfo).toHaveBeenCalledTimes(0);
  });

  test('writes to output if told so', async () => {
    const mockedLogInfo = logger.info as jest.Mock;

    await spawnProcess('echo', ['-n', 'test-string'], {}, true);

    expect(mockedLogInfo).toHaveBeenCalledTimes(1);
    expect(mockedLogInfo.mock.calls[0][0]).toMatch(/test-string/);
  });
});

describe('sleepAsync', () => {
  test('sleeps for at least the given number of ms', async () => {
    const sleepMs = 50;
    const timeStart = new Date().getTime();
    await sleepAsync(sleepMs);
    const timeEnd = new Date().getTime();
    const diff = timeEnd - timeStart;
    expect(diff).toBeGreaterThanOrEqual(sleepMs - 1);
    expect(diff).toBeLessThan(sleepMs * 2);
  });
});

describe('replaceEnvVariable', () => {
  test('replaces a variable', async () => {
    // tslint:disable-next-line:no-invalid-template-strings
    expect(replaceEnvVariable('${ENV_VAR}', { ENV_VAR: '123' })).toBe('123');
  });

  test('does not replace a variable if there is no curly braces', async () => {
    expect(replaceEnvVariable('$ENV_VAR', { ENV_VAR: '123' })).toBe('$ENV_VAR');
  });

  test('replaces a non-existing environment variable with empty string', async () => {
    // tslint:disable-next-line:no-invalid-template-strings
    expect(replaceEnvVariable('${ENV_VAR}', {})).toBe('');
  });
});

describe('calculateChecksum', () => {
  test('replaces a variable', async () => {
    tmp.setGracefulCleanup();
    const tmpFile = tmp.fileSync({ prefix: 'craft-' });
    fs.writeFileSync(tmpFile.name, '\n');

    const checksum = await calculateChecksum(tmpFile.name);
    expect(checksum).toBe(
      '01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b'
    );

    tmpFile.removeCallback();
  });
});

describe('isExecutableInPath', () => {
  test('checks for existing executable', async () => {
    expect(hasExecutable('npm')).toBe(true);
  });

  test('checks for non-existing executable', async () => {
    expect(hasExecutable('not-existing-executable')).toBe(false);
  });

  test('checks for existing executable using absolute path', async () => {
    expect(hasExecutable('/bin/bash')).toBe(true);
  });

  test('checks for non-existing executable using absolute path', async () => {
    expect(hasExecutable('/bin/non-existing-binary')).toBe(false);
  });

  test('checks for existing executable using relative path', async () => {
    expect(hasExecutable('../../../../../../../../../bin/ls')).toBe(true);
  });

  test('checks for non-existing executable using relative path', async () => {
    expect(hasExecutable('./bin/non-existing-binary')).toBe(false);
  });
});
