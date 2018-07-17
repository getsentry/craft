import { sleepAsync, spawnProcess } from '../system';

describe('spawn', () => {
  test('resolves on success', async () => {
    expect.assertions(1);
    await spawnProcess('test', ['1']);
    expect(true).toBe(true);
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
      expect(e.options).toEqual({ cwd: '/tmp/' });
    }
  });

  test('strip env from options on error', async () => {
    try {
      expect.assertions(1);
      await spawnProcess('test', [], { env: { x: 123, password: 456 } });
    } catch (e) {
      expect(e.options.env).toBeUndefined();
    }
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
