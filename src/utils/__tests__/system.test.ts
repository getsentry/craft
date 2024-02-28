import * as fs from 'fs';

import { logger } from '../../logger';
import { scan, withTempDir, withTempFile } from '../files';

import {
  calculateChecksum,
  extractZipArchive,
  hasExecutable,
  HashAlgorithm,
  HashOutputFormat,
  replaceEnvVariable,
  spawnProcess,
} from '../system';
import { relative, resolve } from 'path';

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
  const testZipPath = resolve(__dirname, '../__fixtures__/test.zip');

  test('extracts a zip archive', async () => {
    await withTempDir(async tmpDir => {
      await extractZipArchive(testZipPath, tmpDir);
      const files = (await scan(tmpDir)).map(file => relative(tmpDir, file));
      expect(files).toStrictEqual(['Sentry.zip']);

      const innerFilePath = resolve(tmpDir, files[0])
      expect(fs.statSync(innerFilePath).size).toBe(1409323);
    });
  });

  // This is a regression test for a bug in the original implementation based on
  // unzipper when running on a new NodeJS v20.
  // Extraction of the root archive would succeed but actually the contents
  // of the nested archive would be compromised. Following attempt to
  // extract the inner archive would yield: "ERROR  invalid distance code"
  test('extracts archive contained in another achive', async () => {
    await withTempDir(async tmpDir => {
      await extractZipArchive(testZipPath, tmpDir);

      const innerZipPath = resolve(tmpDir, 'Sentry.zip')
      const innerDir = resolve(tmpDir, 'Sentry')
      fs.mkdirSync(innerDir)

      await extractZipArchive(innerZipPath, innerDir);
      const files = (await scan(innerDir))
        .map(file => relative(innerDir, file).replace(/\\/g, '/'))
        .sort();
      expect(files).toStrictEqual([
        "Sentry.psd1",
        "Sentry.psm1",
        "assemblies-loader.ps1",
        "lib/.gitignore",
        "lib/net462/Microsoft.Bcl.AsyncInterfaces.dll",
        "lib/net462/Microsoft.Bcl.AsyncInterfaces.license",
        "lib/net462/Microsoft.Bcl.AsyncInterfaces.version",
        "lib/net462/Sentry.dll",
        "lib/net462/Sentry.license",
        "lib/net462/Sentry.version",
        "lib/net462/System.Buffers.dll",
        "lib/net462/System.Buffers.license",
        "lib/net462/System.Buffers.version",
        "lib/net462/System.Collections.Immutable.dll",
        "lib/net462/System.Collections.Immutable.license",
        "lib/net462/System.Collections.Immutable.version",
        "lib/net462/System.Memory.dll",
        "lib/net462/System.Memory.license",
        "lib/net462/System.Memory.version",
        "lib/net462/System.Numerics.Vectors.dll",
        "lib/net462/System.Numerics.Vectors.license",
        "lib/net462/System.Numerics.Vectors.version",
        "lib/net462/System.Reflection.Metadata.dll",
        "lib/net462/System.Reflection.Metadata.license",
        "lib/net462/System.Reflection.Metadata.version",
        "lib/net462/System.Runtime.CompilerServices.Unsafe.dll",
        "lib/net462/System.Runtime.CompilerServices.Unsafe.license",
        "lib/net462/System.Runtime.CompilerServices.Unsafe.version",
        "lib/net462/System.Text.Encodings.Web.dll",
        "lib/net462/System.Text.Encodings.Web.license",
        "lib/net462/System.Text.Encodings.Web.version",
        "lib/net462/System.Text.Json.dll",
        "lib/net462/System.Text.Json.license",
        "lib/net462/System.Text.Json.version",
        "lib/net462/System.Threading.Tasks.Extensions.dll",
        "lib/net462/System.Threading.Tasks.Extensions.license",
        "lib/net462/System.Threading.Tasks.Extensions.version",
        "lib/net462/System.ValueTuple.dll",
        "lib/net462/System.ValueTuple.license",
        "lib/net462/System.ValueTuple.version",
        "lib/net6.0/Sentry.dll",
        "lib/net6.0/Sentry.license",
        "lib/net6.0/Sentry.version",
        "lib/net8.0/Sentry.dll",
        "lib/net8.0/Sentry.license",
        "lib/net8.0/Sentry.version",
        "private/DiagnosticLogger.ps1",
        "private/EventUpdater.ps1",
        "private/Get-CurrentOptions.ps1",
        "private/Get-SentryAssembliesDirectory.ps1",
        "private/ScopeIntegration.ps1",
        "private/SentryEventProcessor.cs",
        "private/SentryEventProcessor.ps1",
        "private/StackTraceProcessor.ps1",
        "public/Add-SentryBreadcrumb.ps1",
        "public/Edit-SentryScope.ps1",
        "public/Invoke-WithSentry.ps1",
        "public/Out-Sentry.ps1",
        "public/Start-Sentry.ps1",
        "public/Start-SentryTransaction.ps1",
        "public/Stop-Sentry.ps1",
      ]);
    });
  });
});
